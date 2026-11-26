
/**
 * Main application controller.
 * Manages UI state, generation pipeline, tabs, localStorage BYOK key handling, print trigger, and file upload.
 *
 * Security hardening (vs legacy):
 * - All DOM construction via createElement/addEventListener (no innerHTML with dynamic data)
 * - File upload size limit: 1 MB
 * - Error messages sanitized for user display
 * - No inline event handlers
 */

/* ------------------------------------------------------------------ */
/*  GLOBAL STATE                                                       */
/* ------------------------------------------------------------------ */

const State = {
  matcher: null,           // ScriptureAndArchiveMatcher instance (loaded lazily)
  apiKey: "",              // Gemini API key from localStorage or input
  model: "gemini-4-hydrogen",
  dateOverride: "",        // YYYY-MM-DD override for sermon date
  outputVersions: "full+condensed", // full, full+condensed, full+brief, all
  currentStep: -1,         // Progress step index (-1 = idle)
  results: {},             // { full: text, condensed: text, brief: text }
  activeTab: "full",       // Currently visible output tab
  cancelled: false,        // Set to true when user clicks Cancel during translation
  modelUsed: "",           // Actual model that completed the translation (may differ from preferred)
};

/* ------------------------------------------------------------------ */
/*  SECURITY UTILITIES                                                 */
/* ------------------------------------------------------------------ */

/** Sanitize an error message for safe display — strip stack traces and internal details. */
function sanitizeError(err) {
  if (!err) return "An unexpected error occurred.";
  const msg = String(err.message || err);
  // Strip anything after a newline (stack traces, API internals)
  const firstLine = msg.split("\n")[0];
  // Truncate very long messages
  return firstLine.length > 200 ? firstLine.slice(0, 197) + "…" : firstLine;
}

/** Maximum file upload size: 1 MB */
const MAX_UPLOAD_SIZE = 1 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/*  INITIALIZATION                                                     */
/* ------------------------------------------------------------------ */

/** Entry point called by Astro's <script type="module">. */
function init() {
  initApiKey();
  initDateDefaults();
  initFileUpload();
  initControls();
  applyLanguage(getLang());
}

/** Restore API key from localStorage only if it was previously saved (remember checkbox was checked). */
function initApiKey() {
  const saved = localStorage.getItem("khutbah_api_key");
  if (saved) {
    State.apiKey = saved;
    const input = document.getElementById("api-key-input");
    if (input) input.value = saved;
    // Check the remember box since key was persisted before
    const cb = document.getElementById("remember-key");
    if (cb) cb.checked = true;
  }
  updateApiKeyUI();
}

/** Set the Friday date input to next upcoming Friday. */
function initDateDefaults() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 5=Fri
  let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  if (daysUntilFriday === 0 && today.getHours() < 18) {
    daysUntilFriday = 7; // If it's already Friday before Maghrib, use next week
  }
  const nextFriday = new Date(today);
  nextFriday.setDate(today.getDate() + daysUntilFriday);

  const dateInput = document.getElementById("friday-date-input");
  if (dateInput) {
    dateInput.value = nextFriday.toISOString().split("T")[0];
    updateDatePreview();
  }
}

/* ------------------------------------------------------------------ */
/*  API KEY UI                                                         */
/* ------------------------------------------------------------------ */

function updateApiKeyUI() {
  const bar = document.getElementById("api-key-bar");
  if (!bar) return;

  if (State.apiKey && State.apiKey.length >= 10) {
    bar.setAttribute("data-key-ready", "true");
  } else {
    bar.setAttribute("data-key-ready", "false");
  }
}


/** Called when user types/pastes an API key. */
function onApiKeyChange(input) {
  const val = input.value.trim();
  State.apiKey = val;
  updateApiKeyUI();

  // Persist if checkbox is checked
  const remember = document.getElementById("remember-key");
  if (remember && remember.checked && val.length >= 10) {
    localStorage.setItem("khutbah_api_key", val);
  } else if (!val) {
    localStorage.removeItem("khutbah_api_key");
  }
}


/* ------------------------------------------------------------------ */
/*  DATE PREVIEW                                                       */
/* ------------------------------------------------------------------ */

function onDateChange(input) {
  State.dateOverride = input.value;
  updateDatePreview();
}

function updateDatePreview() {
  const preview = document.getElementById("date-preview");
  if (!preview) return;
  const dateInput = document.getElementById("friday-date-input");
  if (dateInput && dateInput.value) {
    // We need a sample Arabic text to extract from — use the textarea content or empty string
    const arText = document.getElementById("arabic-input").value || "";
    preview.textContent = extractOrFormatHeaderDate(arText, State.dateOverride);
  }
}

/* ------------------------------------------------------------------ */
/*  FILE UPLOAD                                                        */
/* ------------------------------------------------------------------ */

function initFileUpload() {
  const textarea = document.getElementById("arabic-input");
  if (!textarea) return;

  // Drag and drop onto textarea
  textarea.addEventListener("dragover", (e) => { e.preventDefault(); textarea.classList.add("drag-over"); });
  textarea.addEventListener("dragleave", () => { textarea.classList.remove("drag-over"); });
  textarea.addEventListener("drop", (e) => {
    e.preventDefault();
    textarea.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".txt")) loadFile(file);
  });

  // Upload button
  const uploadBtn = document.getElementById("upload-btn");
  if (uploadBtn) {
    uploadBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".txt,.text";
      input.onchange = () => { if (input.files[0]) loadFile(input.files[0]); };
      input.click();
    });
  }
}

function loadFile(file) {
  // SECURITY: enforce file size limit
  if (file.size > MAX_UPLOAD_SIZE) {
    alert(t("err_file_too_large"));
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById("arabic-input").value = e.target.result;
  };
  reader.onerror = () => {
    alert(t("err_file_read_failed"));
  };
  reader.readAsText(file, "UTF-8");
}

/* ------------------------------------------------------------------ */
/*  CONTROLS & GENERATION PIPELINE                                     */
/* ------------------------------------------------------------------ */

function initControls() {
  // Scripture check button
  const scriptureBtn = document.getElementById("btn-scripture");
  if (scriptureBtn) scriptureBtn.addEventListener("click", runScriptureCheck);

  // Translate button
  const translateBtn = document.getElementById("btn-translate");
  if (translateBtn) translateBtn.addEventListener("click", runFullTranslation);

  // Model selector
  const modelSelect = document.getElementById("model-select");
  if (modelSelect) {
    modelSelect.value = State.model;
    modelSelect.addEventListener("change", () => {
      State.model = modelSelect.value;
      updateApiKeyUI();
    });
  }

  // Output versions selector
  const verSelect = document.getElementById("versions-select");
  if (verSelect) {
    verSelect.value = State.outputVersions;
    verSelect.addEventListener("change", () => {
      State.outputVersions = verSelect.value;
    });
  }

  // Language switcher buttons
  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.addEventListener("click", () => setLang(btn.getAttribute("data-lang")));
  });


  // Remember checkbox: unchecking immediately clears localStorage
  const rememberCb = document.getElementById("remember-key");
  if (rememberCb) {
    rememberCb.addEventListener("change", () => {
      if (!rememberCb.checked) {
        localStorage.removeItem("khutbah_api_key");
      }
    });
  }

  // Eye button: toggle password visibility
  const eyeBtn = document.getElementById("eye-btn");
  const apiKeyInput = document.getElementById("api-key-input");
  if (eyeBtn && apiKeyInput) {
    eyeBtn.addEventListener("click", () => {
      const isPassword = apiKeyInput.type === "password";
      apiKeyInput.type = isPassword ? "text" : "password";
    });
  }

  // API key input change handler
  if (apiKeyInput) {
    apiKeyInput.addEventListener("input", () => onApiKeyChange(apiKeyInput));
  }

  // Date input change handler
  const dateInput = document.getElementById("friday-date-input");
  if (dateInput) {
    dateInput.addEventListener("change", () => onDateChange(dateInput));
  }

  // Action bar buttons
  const copyBtn = document.getElementById("copy-btn");
  if (copyBtn) copyBtn.addEventListener("click", copyCurrentTab);

  const printBtn = document.getElementById("print-btn");
  if (printBtn) printBtn.addEventListener("click", printCurrentTab);
}

/** Quick scripture match check — no API calls. */
async function runScriptureCheck() {
  const arText = document.getElementById("arabic-input").value.trim();
  if (!arText) return alert(t("arabic_placeholder_en"));

  // Loading state on button
  const btn = document.getElementById("btn-scripture");
  const origLabel = btn?.textContent;
  if (btn) {
    btn.classList.add("loading");
    btn.disabled = true;
  }

  try {
    await ensureMatcherLoaded();

    setProgress(0, t("step_scripture"));

    const qMatches = State.matcher.extractQuranMatches(arText);
    const hMatches = State.matcher.extractHadithMatches(arText, qMatches.map(q => q.arSnippet));

    // Display results in scripture panel — SECURITY: DOM construction instead of innerHTML
    const panel = document.getElementById("scripture-results");
    if (panel) {
      buildScripturePanel(panel, qMatches, hMatches);
      document.getElementById("scripture-panel").classList.add("visible");
    }
  } catch (err) {
    console.error("Scripture check failed:", err);
    const panel = document.getElementById("scripture-results");
    if (panel) {
      // SECURITY: use textContent, not innerHTML with error data
      const msgEl = document.createElement("div");
      msgEl.style.cssText = "color:var(--secondary);padding:12px;";
      msgEl.textContent = "Error: " + sanitizeError(err);
      panel.innerHTML = "";
      panel.appendChild(msgEl);
    }
  } finally {
    // Restore button state
    if (btn) {
      btn.classList.remove("loading");
      btn.textContent = origLabel;
      btn.disabled = false;
    }
    setProgress(-1, "");
  }
}

/** Build scripture results panel using DOM construction only — no innerHTML with data. */
function buildScripturePanel(panel, qMatches, hMatches) {
  panel.innerHTML = "";

  // Summary badges row
  const summaryRow = document.createElement("div");
  summaryRow.className = "match-summary";

  const qBadge = document.createElement("span");
  qBadge.className = "badge badge-quran";
  qBadge.textContent = `${qMatches.length} ${t("verses_count")}`;
  summaryRow.appendChild(qBadge);

  const hBadge = document.createElement("span");
  hBadge.className = "badge badge-hadith";
  hBadge.textContent = `${hMatches.length} ${t("hadiths_count")}`;
  summaryRow.appendChild(hBadge);

  panel.appendChild(summaryRow);

  // Quran matches section
  if (qMatches.length) {
    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `Quran Matches (${qMatches.length})`;
    details.appendChild(summary);

    for (const q of qMatches) {
      const item = document.createElement("div");
      item.className = "match-item";

      const refEl = document.createElement("strong");
      refEl.textContent = `(${q.ref})`;
      item.appendChild(refEl);

      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = q.isPartial ? "PARTIAL" : "FULL";
      item.appendChild(tag);

      const scoreSpan = document.createElement("span");
      scoreSpan.textContent = ` score=${q.score}`;
      item.appendChild(scoreSpan);

      const br = document.createElement("br");
      item.appendChild(br);

      const csText = q.csHrbek.length > 120 ? q.csHrbek.slice(0, 120) + "…" : q.csHrbek;
      const em = document.createElement("em");
      em.textContent = `CS: "${csText}"`;
      item.appendChild(em);

      details.appendChild(item);
    }

    panel.appendChild(details);
  }

  // Hadith matches section
  if (hMatches.length) {
    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `Hadith Matches (${hMatches.length})`;
    details.appendChild(summary);

    for (const h of hMatches) {
      const item = document.createElement("div");
      item.className = "match-item";

      const idEl = document.createElement("strong");
      idEl.textContent = `ID ${h.hadithId}`;
      item.appendChild(idEl);

      const scoreSpan = document.createElement("span");
      scoreSpan.textContent = ` score=${h.score}`;
      item.appendChild(scoreSpan);

      const br = document.createElement("br");
      item.appendChild(br);

      const csText = h.csText.length > 150 ? h.csText.slice(0, 150) + "…" : h.csText;
      const em = document.createElement("em");
      em.textContent = csText;
      item.appendChild(em);

      details.appendChild(item);
    }

    panel.appendChild(details);
  }
}

/** Full translation pipeline: Pass 1 (translate) → Pass 2 (polish) → condense/brief. */
async function runFullTranslation() {
  const arText = document.getElementById("arabic-input").value.trim();
  if (!arText) return alert(t("arabic_placeholder_en"));
  if (!State.apiKey || State.apiKey.length < 10) {
    return alert(t("err_no_api_key"));
  }

  // Loading state on button — spinning indicator
  const btn = document.getElementById("btn-translate");
  const origLabel = btn?.textContent;
  if (btn) {
    btn.classList.add("loading");
    btn.disabled = true;
  }

  await ensureMatcherLoaded();

  // Load prompts
  const [transPrompt, polishPrompt, condensePrompt] = await loadPrompts();

  State.results = {};
  clearOutputTabs();

  try {
    // --- Step 0: Scripture match (offline) ---
    setProgress(0, t("step_scripture"));
    const { payload: userPayload, meta } = await buildTranslationUserPayload(
      arText, State.dateOverride || null, 2, State.matcher
    );

    // Show scripture results briefly
    showScriptureSummary(meta);

    // --- Step 1: Full translation (Pass 1) ---
    setProgress(1, t("step_translation"));
    const outputEl = document.getElementById("sermon-output-card");
    outputEl.textContent = "";

    const transResult = await geminiStream(transPrompt, userPayload, State.apiKey, {
      preferredModel: State.model,
      temperature: 0.2,
      thinkingLevel: "high",
      onChunk: (txt) => { if (outputEl) outputEl.textContent += txt; },
    });

    // Track which model actually completed the translation
    State.modelUsed = transResult.modelUsed || State.model;

    let draftCs = transResult.text;

    // --- Step 2: Polish (Pass 2) ---
    setProgress(2, t("step_polish"));
    const polishInput = `[ORIGINAL ARABIC SERMON]\n${arText}\n\n[CZECH DRAFT TO PROOFREAD]\n${draftCs}`;

    outputEl.textContent += "\n\n[Polishing...]\n";

    const polishResult = await geminiStream(polishPrompt, polishInput, State.apiKey, {
      preferredModel: State.model,
      temperature: 0.1,
      thinkingLevel: "low",
      onChunk: null, // Don't stream polish — replace at end
    });

    let [finalCs, warnings] = postprocessAndVerify(polishResult.text, State.matcher);
    State.results.full = finalCs;
    outputEl.textContent = finalCs;

    // --- Step 3/4: Condensed + Brief if requested ---
    const versions = parseVersions(State.outputVersions);

    if (versions.includes("condensed")) {
      setProgress(3, t("step_condensing"));
      outputEl.textContent += "\n\n[Condensing...]\n";

      const condenseResult = await geminiStream(
        condensePrompt + "\n\n[LENGTH TIER: CONDENSED]\n",
        `[FULL VERIFIED CZECH SERMON TO CONDENSE]\n${finalCs}`,
        State.apiKey,
        { preferredModel: State.model, temperature: 0.2, thinkingLevel: "low" }
      );

      let [condensedCs, condWarnings] = postprocessAndVerify(condenseResult.text, State.matcher);
      State.results.condensed = condensedCs;
    }

    if (versions.includes("brief")) {
      setProgress(3, t("step_condensing"));
      outputEl.textContent += "\n\n[Briefing...]\n";

      const briefResult = await geminiStream(
        condensePrompt + "\n\n[LENGTH TIER: BRIEF]\n",
        `[FULL VERIFIED CZECH SERMON TO CONDENSE]\n${finalCs}`,
        State.apiKey,
        { preferredModel: State.model, temperature: 0.2, thinkingLevel: "low" }
      );

      let [briefCs, briefWarnings] = postprocessAndVerify(briefResult.text, State.matcher);
      State.results.brief = briefCs;
    }

    // --- Step 5: Final QA ---
    setProgress(4, t("step_qa"));
    outputEl.textContent = finalCs; // Restore clean full text

    buildOutputTabs();
    switchTab("full");
    updateModelIndicator();

  } catch (err) {
    console.error("Translation failed:", err);
    // SECURITY: sanitize error message for user display
    alert(`${t("err_generation_failed")} ${sanitizeError(err)}`);
  } finally {
    // Restore button state
    if (btn) {
      btn.classList.remove("loading");
      btn.textContent = origLabel;
      btn.disabled = false;
    }
    setProgress(-1, "");
  }
}

/** Parse output versions selector into array of tier names. */
function parseVersions(val) {
  switch (val) {
    case "all": return ["condensed", "brief"];
    case "full+condensed": return ["condensed"];
    case "full+brief": return ["brief"];
    default: return []; // full only
  }
}

/* ------------------------------------------------------------------ */
/*  OUTPUT TABS                                                        */
/* ------------------------------------------------------------------ */

/** Build output tabs using DOM construction — no innerHTML with dynamic data. */
function buildOutputTabs() {
  const tabBar = document.getElementById("tab-bar");
  if (!tabBar) return;

  tabBar.innerHTML = "";

  const versions = parseVersions(State.outputVersions);

  // Full tab always present
  const fullWords = wordCount(State.results.full || "");
  const fullMin = Math.max(1, Math.round(fullWords / 125));
  const fullBtn = createTabButton("full", t("tab_full"), `${fullWords} words · ~${fullMin} min`, true);
  tabBar.appendChild(fullBtn);

  if (State.results.condensed) {
    const cWords = wordCount(State.results.condensed);
    const cMin = Math.max(1, Math.round(cWords / 125));
    const cBtn = createTabButton("condensed", t("tab_condensed"), `${cWords} words · ~${cMin} min`, false);
    tabBar.appendChild(cBtn);
  }

  if (State.results.brief) {
    const bWords = wordCount(State.results.brief);
    const bMin = Math.max(1, Math.round(bWords / 125));
    const bBtn = createTabButton("brief", t("tab_brief"), `${bWords} words · ~${bMin} min`, false);
    tabBar.appendChild(bBtn);
  }
}

/** Create a tab button with proper event listener — no inline onclick. */
function createTabButton(tabName, label, badgeText, isActive) {
  const btn = document.createElement("button");
  btn.className = "tab-btn" + (isActive ? " active" : "");
  btn.dataset.tab = tabName;

  const labelSpan = document.createTextNode(label + " ");
  btn.appendChild(labelSpan);

  const badge = document.createElement("span");
  badge.className = "badge badge-words";
  badge.textContent = badgeText;
  btn.appendChild(badge);

  // SECURITY: use addEventListener instead of inline onclick
  btn.addEventListener("click", () => switchTab(tabName));

  return btn;
}

function switchTab(tabName) {
  State.activeTab = tabName;

  // Update active button
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  // Show corresponding content
  const outputEl = document.getElementById("sermon-output-card");
  if (outputEl && State.results[tabName]) {
    outputEl.textContent = State.results[tabName];
  }

  // Update action bar filenames
  updateActionFilenames(tabName);
}

function clearOutputTabs() {
  const tabBar = document.getElementById("tab-bar");
  if (tabBar) tabBar.innerHTML = "";
  const outputEl = document.getElementById("sermon-output-card");
  if (outputEl) outputEl.textContent = "";
}

/* ------------------------------------------------------------------ */
/*  ACTION BAR: Copy, Download, Print                                  */
/* ------------------------------------------------------------------ */

function updateActionFilenames(tabName) {
  // Update download links with correct filenames
  const dateStr = State.dateOverride || new Date().toISOString().split("T")[0];
  const txtLink = document.getElementById("download-txt");
  const mdLink = document.getElementById("download-md");
  if (txtLink) {
    txtLink.href = "#";
    txtLink.onclick = () => downloadText(tabName, "txt");
  }
  if (mdLink) {
    mdLink.href = "#";
    mdLink.onclick = () => downloadText(tabName, "md");
  }
}

function copyCurrentTab() {
  const text = State.results[State.activeTab];
  if (!text) return;
  navigator.clipboard.writeText(text).catch(() => {});
}

function downloadText(tabName, ext) {
  const text = State.results[tabName];
  if (!text) return;
  const dateStr = State.dateOverride || new Date().toISOString().split("T")[0];
  const suffix = tabName === "full" ? "" : `_${tabName}`;
  const filename = `khutbah_${dateStr}${suffix}.${ext}`;

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function printCurrentTab() {
  window.print();
}

/* ------------------------------------------------------------------ */
/*  PROGRESS BAR                                                       */
/* ------------------------------------------------------------------ */

function setProgress(stepIndex, label) {
  State.currentStep = stepIndex;
  const bar = document.getElementById("progress-bar");
  if (!bar) return;

  if (stepIndex < 0) {
    bar.classList.remove("visible");
    return;
  }

  bar.classList.add("visible");
  const steps = bar.querySelectorAll(".progress-step");
  steps.forEach((el, i) => {
    el.classList.toggle("active", i === stepIndex);
    el.classList.toggle("done", i < stepIndex);
    if (i === stepIndex && label) {
      el.querySelector(".step-label").textContent = label;
    }
  });
}

/* ------------------------------------------------------------------ */
/*  SCRIPTURE SUMMARY DISPLAY                                          */
/* ------------------------------------------------------------------ */

/** Build scripture summary using DOM construction — no innerHTML with data. */
function showScriptureSummary(meta) {
  const panel = document.getElementById("scripture-results");
  if (!panel) return;

  panel.innerHTML = "";

  const summaryRow = document.createElement("div");
  summaryRow.className = "match-summary";

  const qBadge = document.createElement("span");
  qBadge.className = "badge badge-quran";
  qBadge.textContent = `${meta.quranMatches.length} ${t("verses_count")}`;
  summaryRow.appendChild(qBadge);

  const hBadge = document.createElement("span");
  hBadge.className = "badge badge-hadith";
  hBadge.textContent = `${meta.hadithMatches.length} ${t("hadiths_count")}`;
  summaryRow.appendChild(hBadge);

  if (meta.fewShotDates && meta.fewShotDates.length) {
    const aBadge = document.createElement("span");
    aBadge.className = "badge badge-archive";
    // Format dates nicely: show count + first/last date range
    const dates = meta.fewShotDates;
    if (dates.length === 1) {
      aBadge.textContent = `${t("few_shot_single")}: ${dates[0]}`;
    } else {
      aBadge.textContent = `${dates.length} ${t("few_shot_sermons")} (${dates[0]} – ${dates[dates.length - 1]})`;
    }
    summaryRow.appendChild(aBadge);
  }

  panel.appendChild(summaryRow);
  document.getElementById("scripture-panel").classList.add("visible");
}

/* ------------------------------------------------------------------ */
/*  DATASET LOADING                                                    */
/* ------------------------------------------------------------------ */

async function ensureMatcherLoaded() {
  if (State.matcher) return State.matcher;

  const matcher = new ScriptureAndArchiveMatcher();

  // Try primary path first, then fallback for local dev
  const paths = [
    { q: "./assets/data/quran_cs.json", h: "./assets/data/hadith_cs.json", a: "./assets/data/prague_archive.json" },
    { q: "../data/processed/quran_cs.json", h: "../data/processed/hadith_cs.json", a: "../data/processed/prague_archive.json" },
  ];

  for (const p of paths) {
    try {
      const status = await matcher.loadDatasets(p.q, p.h, p.a);
      if (status) {
        State.matcher = matcher;
        updateDatasetIndicator(status);
        return matcher;
      }
    } catch (_) {}
  }

  console.error("Could not load any dataset path.");
  alert(t("err_dataset_load"));
}

function updateDatasetIndicator(status) {
  const el = document.getElementById("dataset-indicator");
  if (!el) return;
  el.textContent = `${t("dataset_ready")} (${status.verses.toLocaleString()} ${t("verses_count")}, ${status.hadiths} ${t("hadiths_count")}, ${status.sermons} ${t("sermons_count")})`;
  el.classList.add("visible");
}

/** Show which model was actually used (may differ from preferred if fallback occurred). */
function updateModelIndicator() {
  const el = document.getElementById("dataset-indicator");
  if (!el) return;
  const existingText = el.textContent || "";
  el.textContent = `${existingText} · ${t("model_used")}: ${State.modelUsed}`;
  el.classList.add("visible");
}

/* ------------------------------------------------------------------ */
/*  PROMPT LOADING                                                     */
/* ------------------------------------------------------------------ */

async function loadPrompts() {
  const paths = [
    ["./assets/prompts/translation_prompt.md", "./assets/prompts/condense_prompt.md"],
    ["../prompts/translation_prompt.md", "../prompts/condense_prompt.md"],
  ];

  for (const [tp, cp] of paths) {
    try {
      const [tRes, cRes] = await Promise.all([fetch(tp), fetch(cp)]);
      if (tRes.ok && cRes.ok) {
        return [await tRes.text(), POLISH_SYSTEM_PROMPT_JS, await cRes.text()];
      }
    } catch (_) {}
  }

  // Fallback: embedded minimal prompts
  return ["", "", ""];
}

/** Embedded polish prompt (same as Python's POLISH_SYSTEM_PROMPT). */
const POLISH_SYSTEM_PROMPT_JS = `You are a native Czech literary editor proofreading a Czech Friday sermon (khutbah) before it is read aloud in a mosque.

Review the Czech draft against the original Arabic sermon and fix ONLY:
1. Czech spelling, non-existent verb prefixes, diacritic slips, or wrong grammatical case/gender agreement.
2. Awkward or unnatural phrasing so every sentence flows smoothly when spoken aloud from the pulpit.

STRICT LOCKS — DO NOT VIOLATE:
- NEVER alter a single word inside Qur'anic quotes „..." (Surah:Verse) or the opening Khutbat al-Hājah paragraph.
- Keep Alláh / Alláhův (never Bůh / Boží), keep transliterated honorifics, and NEVER add audience greetings.
- Output ONLY the final corrected Czech sermon text, with zero commentary.
- Keep gender-inclusive Czech vocatives ('bratři a sestry', 'muslimové a muslimky') — NEVER revert to masculine-only!`;

/* ------------------------------------------------------------------ */
/*  UTILITIES                                                          */
/* ------------------------------------------------------------------ */

function wordCount(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/** Export init for Astro module loading. */
export { init };
/** Auto-initialize when loaded as <script type="module">. */
if (document.readyState !== "loading") {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init);
}
