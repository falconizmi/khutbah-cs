/**
 * Main application controller.
 * Manages UI state, generation pipeline, tabs, localStorage BYOK key handling, print trigger, and file upload.
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
};

/* ------------------------------------------------------------------ */
/*  INITIALIZATION                                                     */
/* ------------------------------------------------------------------ */

document.addEventListener("DOMContentLoaded", () => {
  initApiKey();
  initDateDefaults();
  initFileUpload();
  initControls();
  applyLanguage(getLang());
});

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
  const statusLine = document.getElementById("api-key-status");
  if (!bar) return;

  if (State.apiKey && State.apiKey.length >= 10) {
    // Collapsed status mode — accept any key with reasonable length (AIza..., AQ.Ab8..., etc.)
    bar.setAttribute("data-key-ready", "true");
    // Close details panel in collapsed mode so Settings link opens it
    const details = document.getElementById("api-key-details");
    if (details) details.open = false;
    if (statusLine) {
      statusLine.innerHTML = `${t("key_ready")} • Model: <strong>${State.model}</strong> <a href="#" class="settings-link" data-action="toggle-api-key">${t("how_to_get_key")}</a>`;
    }
  } else {
    bar.setAttribute("data-key-ready", "false");
    // Clear stale status content so Settings link disappears when no key
    if (statusLine) statusLine.innerHTML = "";
  }
}

function toggleApiKeyBar() {
  const details = document.getElementById("api-key-details");
  if (details) {
    details.open = !details.open;
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

function forgetApiKey() {
  State.apiKey = "";
  const input = document.getElementById("api-key-input");
  if (input) input.value = "";
  localStorage.removeItem("khutbah_api_key");
  updateApiKeyUI();
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
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById("arabic-input").value = e.target.result;
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

  // Event delegation for settings link (CSP-safe, no inline onclick)
  const statusWrap = document.getElementById("api-key-status-line-wrap");
  if (statusWrap) {
    statusWrap.addEventListener("click", (e) => {
      if (e.target.closest("[data-action='toggle-api-key']")) {
        e.preventDefault();
        toggleApiKeyBar();
      }
    });
  }

  // Remember checkbox: unchecking immediately clears localStorage
  const rememberCb = document.getElementById("remember-key");
  if (rememberCb) {
    rememberCb.addEventListener("change", () => {
      if (!rememberCb.checked) {
        localStorage.removeItem("khutbah_api_key");
      }
    });
  }
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

    // Display results in scripture panel
    const panel = document.getElementById("scripture-results");
    if (panel) {
      let html = `<div class="match-summary">`;
      html += `<span class="badge badge-quran">${qMatches.length} ${t("verses_count")}</span>`;
      html += `<span class="badge badge-hadith">${hMatches.length} ${t("hadiths_count")}</span>`;
      html += `</div>`;

      if (qMatches.length) {
        html += `<details open><summary>Quran Matches (${qMatches.length})</summary>`;
        for (const q of qMatches) {
          const tag = q.isPartial ? "PARTIAL" : "FULL";
          html += `<div class="match-item">`;
          html += `<strong>(${q.ref})</strong> <span class="tag">${tag}</span> score=${q.score}<br>`;
          html += `<em>CS: „${escapeHtml(q.csHrbek.slice(0, 120))}${q.csHrbek.length > 120 ? "…" : ""}"</em></div>`;
        }
        html += `</details>`;
      }

      if (hMatches.length) {
        html += `<details open><summary>Hadith Matches (${hMatches.length})</summary>`;
        for (const h of hMatches) {
          html += `<div class="match-item">`;
          html += `<strong>ID ${h.hadithId}</strong> score=${h.score}<br>`;
          html += `<em>${escapeHtml(h.csText.slice(0, 150))}${h.csText.length > 150 ? "…" : ""}</em></div>`;
        }
        html += `</details>`;
      }

      panel.innerHTML = html;
      document.getElementById("scripture-panel").classList.add("visible");
    }
  } catch (err) {
    console.error("Scripture check failed:", err);
    const panel = document.getElementById("scripture-results");
    if (panel) panel.innerHTML = `<div style="color:var(--secondary);padding:12px;">Error: ${escapeHtml(err.message)}</div>`;
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

/** Full translation pipeline: Pass 1 (translate) → Pass 2 (polish) → condense/brief. */
async function runFullTranslation() {
  const arText = document.getElementById("arabic-input").value.trim();
  if (!arText) return alert(t("arabic_placeholder_en"));
  if (!State.apiKey || State.apiKey.length < 10) {
    return alert("Please enter a valid Gemini API key.");
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

  } catch (err) {
    console.error("Translation failed:", err);
    alert(`Generation failed: ${err.message}`);
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

function buildOutputTabs() {
  const tabBar = document.getElementById("tab-bar");
  if (!tabBar) return;

  const versions = parseVersions(State.outputVersions);
  let html = "";

  // Full tab always present
  const fullWords = wordCount(State.results.full || "");
  const fullMin = Math.max(1, Math.round(fullWords / 125));
  html += `<button class="tab-btn active" data-tab="full" onclick="switchTab('full')">`;
  html += `${t("tab_full")} <span class="badge badge-words">${fullWords} words · ~${fullMin} min</span></button>`;

  if (State.results.condensed) {
    const cWords = wordCount(State.results.condensed);
    const cMin = Math.max(1, Math.round(cWords / 125));
    html += `<button class="tab-btn" data-tab="condensed" onclick="switchTab('condensed')">`;
    html += `${t("tab_condensed")} <span class="badge badge-words">${cWords} words · ~${cMin} min</span></button>`;
  }

  if (State.results.brief) {
    const bWords = wordCount(State.results.brief);
    const bMin = Math.max(1, Math.round(bWords / 125));
    html += `<button class="tab-btn" data-tab="brief" onclick="switchTab('brief')">`;
    html += `${t("tab_brief")} <span class="badge badge-words">${bWords} words · ~${bMin} min</span></button>`;
  }

  tabBar.innerHTML = html;
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

function showScriptureSummary(meta) {
  const panel = document.getElementById("scripture-results");
  if (!panel) return;

  let html = `<div class="match-summary">`;
  html += `<span class="badge badge-quran">${meta.quranMatches.length} ${t("verses_count")}</span>`;
  html += `<span class="badge badge-hadith">${meta.hadithMatches.length} ${t("hadiths_count")}</span>`;
  if (meta.fewShotDates.length) {
    html += `<span class="badge badge-archive">Few-shot: ${meta.fewShotDates.join(", ")}</span>`;
  }
  html += `</div>`;

  panel.innerHTML = html;
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
  alert("Failed to load scripture datasets. Check that data files are accessible.");
}

function updateDatasetIndicator(status) {
  const el = document.getElementById("dataset-indicator");
  if (!el) return;
  el.textContent = `${t("dataset_ready")} (${status.verses.toLocaleString()} ${t("verses_count")}, ${status.hadiths} ${t("hadiths_count")}, ${status.sermons} ${t("sermons_count")})`;
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
