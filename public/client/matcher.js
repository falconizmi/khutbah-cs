/**
 * Client-side port of src/match_context.py + src/translate.py postprocess_and_verify.
 * Pure Vanilla JS, ES Module, zero dependencies.
 */

/* ------------------------------------------------------------------ */
/*  CONSTANTS — mirrored from Python                                   */
/* ------------------------------------------------------------------ */

const HIJRI_MONTHS_CS = [
  "muharram", "safar", "rabí´ al-awwal", "rabí´ ath-thání",
  "džumádá al-úlá", "džumádá al-áchira", "radžab", "ša'bán",
  "ramadán", "šawwál", "dhú al-qa'da", "dhú al-hidždža",
];

const MIN_WORDS = 3;
const SCORE_THRESHOLD = 82.0;
const MAX_CANDIDATES = 15;

// Known OCR typos in Tanzil's cs.hrbek.txt
const HRBEK_OCR_FIXES = [
  [/(\b)ca(\b)/g, "$1co$2"],
  [/shromaždují/g, "shromažďují"],
  [/rozdáváni/g, "rozdávání"],
];

// Preceding Czech words indicating generic deity ('إله' = bůh/božstvo), NOT Allah
const GENERIC_DEITY_PRECEDERS = new Set([
  "žádný", "žádného", "žádnému", "žádným",
  "jiný", "jiného", "jinému", "jiným",
  "jeden", "jednoho", "jediný", "jediného",
  "falešný", "falešného", "kromě",
]);

// Capitalized 'Bůh / Boží' in Hrbek → Allah (lowercase = generic deity)
const CS_DEITY_CASES = [
  [/(\p{L}*)Božím(\p{L}*)/gu, "$1Alláhovým$2"],
  [/(\p{L}*)Božích(\p{L}*)/gu, "$1Alláhových$2"],
  [/(\p{L}*)Božími(\p{L}*)/gu, "$1Alláhovými$2"],
  [/(\p{L}*)Božího(\p{L}*)/gu, "$1Alláhova$2"],
  [/(\p{L}*)Božímu(\p{L}*)/gu, "$1Alláhovu$2"],
  [/(\p{L}*)Boží(\p{L}*)/gu, "$1Alláhova$2"],
  [/(\p{L}*)Bohem(\p{L}*)/gu, "$1Alláhem$2"],
  [/(\p{L}*)Bohu(\p{L}*)/gu, "$1Alláhovi$2"],
  [/(\p{L}*)Baha(\p{L}*)/gu, "$1Alláha$2"],
  [/(\p{L}*)Bože(\p{L}*)/gu, "$1Alláhu$2"],
  [/(\p{L}*)Bůh(\p{L}*)/gu, "$1Alláh$2"],
];

// Gender-accurate collocations for possessive 'Boží' before general fallback
const CS_BOZI_COLLOCATIONS = [
  // Noun + Boží → Noun Alláhův (masc animate/inanimate)
  [/([Pp]osel|[Ss]lužebník|[Pp]rorok|[Dd]uch|[Ss]lib|[Zz]ákon|[Tt]rest|[Hh]něv|[Dd]ar|[Dd]ům|[Mm]ěsíc|[Ll]id)\s+Boží/gu, "$1 Alláhův"],
  [/Boží\s+(posel|služebník|prorok|slib|zákon|trest|hněv|dar|dům|měsíc|lid)/gu, "Alláhův $1"],
  // Neuter singular → Alláhovo
  [/([Ss]lovo|[Pp]ísmo|[Jj]méno|[Rr]ozhodnutí|[Pp]řikázání|[Kk]rálovství|[Ss]větlo|[Vv]edení|[Mm]ilosrdenství|[Pp]ožehnání|[Vv]ítězství|[Pp]ověření)\s+Boží/gu, "$1 Alláhovo"],
  [/Boží\s+(slovo|písmo|jméno|rozhodnutí|přikázání|království|světlo|vedení|milosrdenství|požehnání|vítězství|pověření)/gu, "Alláhovo $1"],
  // Genitive/Locative feminine → Alláhově
  [/(cestě|vůle|milosti|pomoci|ochraně|knize|přítomnosti|blízkosti|tváři)\s+Boží/gu, "$1 Alláhově"],
  [/(z\s+vůle|bez\s+vůle|z\s+milosti|od\s+tváře|u\s+tváře)\s+Boží/gu, "$1 Alláhovy"],
  // Accusative feminine → Alláhovu
  [/(cestu|vůli|milost|pomoc|ochranu|knihu|tvář|odměnu)\s+Boží/gu, "$1 Alláhovu"],
  // Plural neuter → Alláhova
  [/(znamení|slova|přikázání|ustanovení)\s+Boží/gu, "$1 Alláhova"],
  // Plural masc animate → Alláhovi
  [/(přátelé|služebníci|poslové|andělé|vojáci)\s+Boží/gu, "$1 Alláhovi"],
];

// Liturgical formulas that should NOT trigger standalone verse citations
const PROSE_FORMULA_STOPLIST = new Set([
  "بسم الله الرحمن الرحيم",
  "الحمد لله رب العالمين",
  "اشهد ان لا اله الا الله",
  "لا اله الا الله",
  "ان شاء الله تعالي",
  "في الدنيا والاخره",
  "الذين امنوا وعملوا الصالحات",
  "يا ايها الذين امنوا",
  "والله علي كل شيء قدير",
  "ان الله غفور رحيم",
]);

const HADITH_BOILERPLATE_RE = /\b(?:عن|ان|سمعت|قال|يقول|رسول الله|النبي|صلي الله عليه وسلم|رضي الله عنه|رضي الله عنها|رضي الله عنهم|رضي الله عنهما|رواه\s+\S+|متفق عليه|في الصحيحين)\b/g;

// Script leak guard: Arabic, Cyrillic, CJK, Hebrew, Persian/Urdu blocks
const SCRIPT_LEAK_RE = /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u4E00-\u9FFF\u3040-\u30FF]/g;

// AI refusal detector (Czech + English)
const REFUSAL_RE = /(jako\s+jazykový\s+model|nemohu\s+přeložit|as\s+an\s+ai\s+language\s+model|i\s+cannot\s+fulfill)/gi;

// Standalone congregation greeting guard
const AUDIENCE_SALAM_RE = /^\s*(as-?salámu\s+alajkum[^\n]*|mír\s+s\s+vámi\s+a\s+milost[^\n]*)\n+/gim;

const KHUTBAT_HAJAH_REFS = new Set(["33:70", "33:71", "33:70-71", "3:102", "4:1"]);

/* ------------------------------------------------------------------ */
/*  ARABIC NORMALIZATION                                               */
/* ------------------------------------------------------------------ */

function normalizeAr(text) {
  // Strip diacritics & tatweel
  text = text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
  // Keep Arabic letters + spaces only
  text = text.replace(/[^\u0621-\u064A\s]/g, " ");
  // Unify alif variants
  text = text.replace(/[أإآٱ]/g, "ا");
  text = text.replace(/ى/g, "ي");
  text = text.replace(/ة/g, "ه");
  text = text.replace(/ؤ/g, "و");
  text = text.replace(/ئ/g, "ي");
  // Collapse whitespace
  return text.split(/\s+/).join(" ");
}

function bigrams(words) {
  const result = [];
  for (let i = 0; i < words.length - 1; i++) {
    result.push(words[i] + " " + words[i + 1]);
  }
  return result;
}

function stripArConjunction(word) {
  if (word.length >= 3 && ("وفل".indexOf(word[0]) !== -1)) {
    return word.slice(1);
  }
  return word;
}

function cleanHadithCore(normText) {
  // Reset lastIndex for global regex
  HADITH_BOILERPLATE_RE.lastIndex = 0;
  let cleaned = normText.replace(HADITH_BOILERPLATE_RE, " ");
  return cleaned.split(/\s+/).join(" ");
}

/* ------------------------------------------------------------------ */
/*  HRBEK ADAPTER                                                      */
/* ------------------------------------------------------------------ */

function adaptHrbekToMosqueCs(text) {
  // OCR fixes first
  for (const [pat, rep] of HRBEK_OCR_FIXES) {
    pat.lastIndex = 0;
    text = text.replace(pat, rep);
  }
  // Collocations before general deity cases
  for (const [pat, rep] of CS_BOZI_COLLOCATIONS) {
    pat.lastIndex = 0;
    text = text.replace(pat, rep);
  }
  // General deity cases — with generic-deity preceding-word guard
  for (const [pat, rep] of CS_DEITY_CASES) {
    pat.lastIndex = 0;
    text = text.replace(pat, (match, p1, p2) => {
      const beforeWords = text.slice(0, text.indexOf(match)).split(/\s+/);
      const prev = beforeWords[beforeWords.length - 1];
      if (!prev) return rep.replace("$1", p1 || "").replace("$2", p2 || "");
      const stripped = prev.replace(/[„"‚\',.;:!?()\[\]]/g, "").toLowerCase();
      if (GENERIC_DEITY_PRECEDERS.has(stripped) && stripped !== "kromě") {
        return match.toLowerCase();
      }
      return rep.replace("$1", p1 || "").replace("$2", p2 || "");
    });
  }
  return text;
}

/* ------------------------------------------------------------------ */
/*  HIJRI DATE                                                         */
/* ------------------------------------------------------------------ */

function gregorianToHijriTabular(gDate) {
  // Try Intl first (Umm al-Qura calendar)
  try {
    const fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
      day: "numeric", month: "numeric", year: "numeric",
    });
    const parts = fmt.formatToParts(gDate);
    const map = {};
    for (const p of parts) map[p.type] = parseInt(p.value, 10);
    if (map.year && map.month && map.day) {
      return [map.year, map.month, map.day];
    }
  } catch (_) { /* fallback below */ }

  // Tabular math fallback (same algorithm as Python stdlib)
  const year = gDate.getFullYear();
  const month = gDate.getMonth() + 1;
  const day = gDate.getDate();

  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jd = day + Math.floor((153 * m + 2) / 5) + 365 * y
    + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;

  let l = jd - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  const j = (Math.floor((10985 - l) / 5316)) * (Math.floor((50 * l) / 17719))
    + (Math.floor(l / 5670)) * (Math.floor((43 * l) / 15238));
  l = l - (Math.floor((30 - j) / 15)) * (Math.floor((17719 * j) / 50))
    - (Math.floor(j / 16)) * (Math.floor((15238 * j) / 43)) + 29;
  const hMonth = Math.floor((24 * l) / 709);
  const hDay = l - Math.floor((709 * hMonth) / 24);
  const hYear = 30 * n + j - 30;

  return [hYear, hMonth, hDay];
}

function extractOrFormatHeaderDate(arText, overrideDate) {
  let gDate = null;

  if (overrideDate) {
    try {
      const parts = overrideDate.split(/[-\/]/).map(Number);
      gDate = new Date(parts[0], parts[1] - 1, parts[2]);
    } catch (_) {}
  }

  if (!gDate) {
    const m = arText.slice(0, 600).match(/(20\d{2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(\d{1,2})/);
    if (m) {
      try { gDate = new Date(+m[1], +m[2] - 1, +m[3]); } catch (_) {}
    }
  }

  if (!gDate || isNaN(gDate.getTime())) {
    gDate = new Date();
  }

  const [hy, hm, hd] = gregorianToHijriTabular(gDate);
  const monthCs = HIJRI_MONTHS_CS[hm - 1] || "muharram";
  return `${gDate.getDate()}. ${gDate.getMonth() + 1}. ${gDate.getFullYear()} (${hd}. ${monthCs} ${hy} h)`;
}

/* ------------------------------------------------------------------ */
/*  LEVENSHTEIN (pure JS, fast for top-15 candidates)                  */
/* ------------------------------------------------------------------ */

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Use two-row DP for memory efficiency
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function levRatio(a, b) {
  const dist = levenshtein(a, b);
  return (1 - dist / Math.max(a.length, b.length)) * 100;
}

/** Partial ratio: find best alignment window of len(a) inside b. */
function partialRatio(a, b) {
  if (b.length === 0) return 0;
  if (a.length >= b.length) return levRatio(a, b);
  let best = 0;
  const w = a.length;
  for (let i = 0; i <= b.length - w; i++) {
    const r = levRatio(a, b.slice(i, i + w));
    if (r > best) best = r;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/*  SCRIPTURE & ARCHIVE MATCHER                                        */
/* ------------------------------------------------------------------ */

class ScriptureAndArchiveMatcher {
  constructor() {
    this.verses = [];       // [ref, arClean, arOrig, csAdapted]
    this.bigramIndex = {};  // bigram -> Set<verseIdx>
    this.exactIndex = {};   // normalizedVerseText -> verseIdx
    this.stemTrigramIndex = {}; // trigram -> [[idx, pos], ...]
    this.hadiths = [];      // [{id, norm, coreNorm, titleNorm, cs}]
    this.hadithBigrams = {}; // bigram -> Set<hadithIdx>
    this.archive = [];

    this.basmalaNorm = normalizeAr("بسم الله الرحمن الرحيم");
    this.taawudhNorm = normalizeAr("أعوذ بالله من الشيطان الرجيم");
  }

  /** Load all datasets from JSON. Returns a status object. */
  async loadDatasets(quranUrl, hadithUrl, archiveUrl) {
    try {
      const [qData, hData, aData] = await Promise.all([
        fetch(quranUrl).then(r => r.json()),
        fetch(hadithUrl).then(r => r.json()),
        fetch(archiveUrl).then(r => r.json()),
      ]);

      // Build Quran index
      for (const row of qData) {
        const ref = `${row.sura}:${row.aya}`;
        const norm = row.ar_clean || normalizeAr(row.ar);
        const csAdapted = adaptHrbekToMosqueCs(row.cs);
        const idx = this.verses.length;
        this.verses.push([ref, norm, row.ar, csAdapted]);
        if (!this.exactIndex[norm]) this.exactIndex[norm] = idx;

        const vWords = norm.split(/\s+/);
        for (const bg of bigrams(vWords)) {
          if (!this.bigramIndex[bg]) this.bigramIndex[bg] = new Set();
          this.bigramIndex[bg].add(idx);
        }
        const stems = vWords.map(stripArConjunction);
        for (let pos = 0; pos < stems.length - 2; pos++) {
          const tg = `${stems[pos]} ${stems[pos + 1]} ${stems[pos + 2]}`;
          if (!this.stemTrigramIndex[tg]) this.stemTrigramIndex[tg] = [];
          this.stemTrigramIndex[tg].push([idx, pos]);
        }
      }

      // Build Hadith index
      for (const h of hData) {
        const idx = this.hadiths.length;
        const norm = h.ar_clean || normalizeAr(h.ar || "");
        const coreNorm = cleanHadithCore(norm);
        const titleNorm = h.title_ar_clean || normalizeAr(h.title_ar || "");
        this.hadiths.push({
          id: String(h.id ?? idx),
          norm,
          coreNorm,
          titleNorm,
          cs: adaptHrbekToMosqueCs(h.cs || ""),
        });
        const allBgs = new Set([...bigrams(coreNorm.split(/\s+/)), ...bigrams(titleNorm.split(/\s+/))]);
        for (const bg of allBgs) {
          if (!this.hadithBigrams[bg]) this.hadithBigrams[bg] = new Set();
          this.hadithBigrams[bg].add(idx);
        }
      }

      this.archive = aData;

      return {
        verses: this.verses.length,
        hadiths: this.hadiths.length,
        sermons: this.archive.length,
      };
    } catch (err) {
      console.error("Failed to load datasets:", err);
      return null;
    }
  }

  /** Match a single Arabic span against the Quran index. */
  matchQuranSpan(rawSpan, explicitBrackets = true) {
    let norm = normalizeAr(rawSpan);
    // Strip basmala / taawudh prefix
    for (const prefix of [this.taawudhNorm, this.basmalaNorm]) {
      if (norm.startsWith(prefix + " ")) {
        norm = norm.slice(prefix.length + 1).trim();
      }
    }
    if (!norm) return null;

    // Exact match
    if (norm in this.exactIndex) {
      const idx = this.exactIndex[norm];
      const [ref, , , cs] = this.verses[idx];
      return { ref, arSnippet: rawSpan.trim(), csHrbek: cs, isPartial: false, score: 100 };
    }

    const words = norm.split(/\s+/);
    if (words.length < MIN_WORDS) return null;

    // Bigram scoring
    const counts = {};
    for (const bg of bigrams(words)) {
      for (const idx of this.bigramIndex[bg] || []) {
        counts[idx] = (counts[idx] || 0) + 1;
      }
    }
    if (Object.keys(counts).length === 0) return null;

    // Top candidates by bigram count
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, MAX_CANDIDATES);
    let best = null;
    for (const [idxStr, _] of sorted) {
      const idx = +idxStr;
      const [, vNorm] = this.verses[idx];
      const score = partialRatio(norm, vNorm);
      if (!best || score > best[0]) best = [score, idx];
    }

    if (!best || best[0] < SCORE_THRESHOLD) return null;

    let [score, idx] = best;
    let lo = idx, hi = idx;
    let bestFull = levenshtein(norm, this.verses[idx][1]) === 0 ? 100 : partialRatio(norm, this.verses[idx][1]);

    // Greedy multi-verse extension (same sura)
    const baseSura = this.verses[idx][0].split(":")[0];
    let improved = true;
    while (improved) {
      improved = false;
      for (const [nlo, nhi] of [[lo - 1, hi], [lo, hi + 1]]) {
        if (nlo < 0 || nhi >= this.verses.length) continue;
        if (this.verses[nlo][0].split(":")[0] !== baseSura || this.verses[nhi][0].split(":")[0] !== baseSura) continue;
        const joined = this.verses.slice(nlo, nhi + 1).map(v => v[1]).join(" ");
        const s = levRatio(norm, joined);
        if (s > bestFull + 1.5) {
          [bestFull, lo, hi] = [s, nlo, nhi];
          improved = true;
          break;
        }
      }
    }

    const joinedNorm = this.verses.slice(lo, hi + 1).map(v => v[1]).join(" ");
    const contained = norm.length <= joinedNorm.length * 1.2;
    if (!contained && bestFull < 72) return null;

    let isPartial = norm.length < joinedNorm.length * 0.85;
    // For partial matches, enforce stricter thresholds on unbracketed prose
    if (isPartial && !explicitBrackets) {
      const pr = partialRatio(norm, joinedNorm);
      if (pr < 94) return null;
    }

    const firstRef = this.verses[lo][0];
    const lastV = this.verses[hi][0].split(":")[1];
    const ref = lo === hi ? firstRef : `${firstRef}-${lastV}`;
    const csJoined = this.verses.slice(lo, hi + 1).map(v => v[3]).join(" ");

    return {
      ref, arSnippet: rawSpan.trim(), csHrbek: csJoined, isPartial,
      score: Math.round(Math.max(score, bestFull) * 10) / 10,
    };
  }

  /** Extract all Quran matches from Arabic text (3 layers). */
  extractQuranMatches(arText) {
    const matches = [];
    const seenCharSpans = [];

    const overlaps = (s, e) => seenCharSpans.some(([ps, pe]) => !(e <= ps || s >= pe));

    // Layer 1: Explicit Quranic brackets ﴿...﴾ or {...}
    const bracketRe = /﴿([^﴾]{6,1500})﴾|\{([^\}]{6,1500})\}/g;
    let bm;
    while ((bm = bracketRe.exec(arText)) !== null) {
      const spanTxt = bm[1] || bm[2];
      const qm = this.matchQuranSpan(spanTxt, true);
      if (qm) {
        matches.push(qm);
        seenCharSpans.push([bm.index, bm.index + bm[0].length]);
      }
    }

    // Layer 2: Quoted or parenthesized spans
    const honorificRe = /^(?:صلي الله عليه وسلم|رضي الله عنه\w*|عليه السلام|سبحانه وتعالي|عز وجل|تبارك وتعالي|رحمه الله|\d+.*)$/;
    const genericQuoteRe = /«([^»]{10,1500})»|"([^"]{10,1500})"|'([^']{10,1500})'/g;
    let gm;
    while ((gm = genericQuoteRe.exec(arText)) !== null) {
      if (overlaps(gm.index, gm.index + gm[0].length)) continue;
      const spanTxt = gm[1] || gm[2] || gm[3];
      const normS = normalizeAr(spanTxt);
      if (!normS || honorificRe.test(normS) || PROSE_FORMULA_STOPLIST.has(normS)) continue;
      const qm = this.matchQuranSpan(spanTxt, true);
      if (qm && qm.score >= 92 && (!qm.isPartial || normS.split(/\s+/).length >= 4)) {
        matches.push(qm);
        seenCharSpans.push([gm.index, gm.index + gm[0].length]);
      }
    }

    // Layer 3: Seed-and-extend prefix-aware trigram scan
    const segmentRe = /[^\n.\u061B\u061F\u0FD\u0FE\u2E02\u2E03\{\}]{12,800}/g;
    const cueWords = new Set(["قال", "يقول", "لقول", "لقوله", "قوله", "تعالي", "سبحانه", "المولي", "ربنا", "وجل", "القران", "الايه"]);

    let sm;
    while ((sm = segmentRe.exec(arText)) !== null) {
      if (overlaps(sm.index, sm.index + sm[0].length)) continue;
      const segRaw = sm[0];

      // Tokenize with character offsets relative to arText
      const tokMatches = [];
      const wordRe = /\S+/g;
      let wm;
      while ((wm = wordRe.exec(segRaw)) !== null) {
        const nw = normalizeAr(wm[0]);
        if (nw) {
          tokMatches.push([wm[0], nw, sm.index + wm.index, sm.index + wm.index + wm[0].length]);
        }
      }
      if (tokMatches.length < 3) continue;

      const stems = tokMatches.map(t => stripArConjunction(t[1]));
      let i = 0;
      while (i <= tokMatches.length - 3) {
        if (overlaps(tokMatches[i][2], tokMatches[i + 2][3])) { i++; continue; }

        const tg = `${stems[i]} ${stems[i + 1]} ${stems[i + 2]}`;
        const seeds = this.stemTrigramIndex[tg];
        if (!seeds) { i++; continue; }

        let bestHit = null;
        for (const [vIdx, vPos] of seeds) {
          const [, vNorm] = this.verses[vIdx];
          const vWords = vNorm.split(/\s+/);
          if (tokMatches[i + 1][1] !== vWords[vPos + 1] || tokMatches[i + 2][1] !== vWords[vPos + 2]) continue;
          if (tokMatches[i][1] !== vWords[vPos] && stems[i] !== stripArConjunction(vWords[vPos])) continue;

          let sTok = i, eTok = i + 3;
          let vp = vPos + 3;
          while (eTok < tokMatches.length && vp < vWords.length) {
            if (tokMatches[eTok][1] === vWords[vp]) { eTok++; vp++; } else break;
          }

          const wLen = eTok - sTok;
          const vCov = wLen / Math.max(vWords.length, 1);
          if (!bestHit || [wLen, vCov] > [bestHit[0], bestHit[1]]) {
            bestHit = [wLen, vCov, vIdx, sTok, eTok];
          }
        }

        if (bestHit) {
          const [, , vIdx, sTok, eTok] = bestHit;
          const matchedNorm = tokMatches.slice(sTok, eTok).map(t => t[1]).join(" ");

          const prevNorms = new Set(tokMatches.slice(Math.max(0, sTok - 7), sTok).map(t => t[1]));
          const beforeSlice = arText.slice(Math.max(0, tokMatches[sTok][2] - 6), tokMatches[sTok][2]);
          const hasCue = [...prevNorms].some(w => cueWords.has(w)) || beforeSlice.includes(":") || beforeSlice.includes("：");

          const minReq = (hasCue && bestHit[1] >= 0.85) ? 3 : 4;
          if (bestHit[0] >= minReq && !PROSE_FORMULA_STOPLIST.has(matchedNorm)) {
            if (bestHit[0] >= 5 || hasCue || bestHit[1] >= 0.45) {
              const [, , , cs] = this.verses[vIdx];
              const rawSnip = arText.slice(tokMatches[sTok][2], tokMatches[eTok - 1][3]).trim();
              matches.push({
                ref: this.verses[vIdx][0],
                arSnippet: rawSnip,
                csHrbek: cs,
                isPartial: bestHit[1] < 0.85,
                score: 100,
              });
              seenCharSpans.push([tokMatches[sTok][2], tokMatches[eTok - 1][3]]);
              i = eTok;
              continue;
            }
          }
        }
        i++;
      }
    }

    // Deduplicate by ref + normalized snippet
    const unique = [];
    const seenKeys = new Set();
    for (const qm of matches) {
      const key = `${qm.ref}|${stripArConjunction(normalizeAr(qm.arSnippet))}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        unique.push(qm);
      }
    }
    return unique;
  }

  /** Extract Hadith matches from Arabic text. */
  extractHadithMatches(arText, quranRefsSpans) {
    const quranNorms = new Set(quranRefsSpans.map(normalizeAr));
    const candidates = [];

    // Quoted segments
    const quoteRe = /«([^»]{15,1200})»|"([^"]{15,1200})"|'([^']{15,1200})'/g;
    let qm;
    while ((qm = quoteRe.exec(arText)) !== null) {
      candidates.push((qm[1] || qm[2] || qm[3]).trim());
    }

    // Unquoted clauses after Prophetic mentions
    const propheticIntroRe = /(?:رسول\s+الله|النبي|الحبيب|المصطفى)[^\n.؟!﴿﴾]{0,65}?(?:قال|يقول)\s*[:：]?\s*([^\n.؟!﴿﴾]{15,450})/g;
    let pm;
    while ((pm = propheticIntroRe.exec(arText)) !== null) {
      candidates.push(pm[1].trim());
    }

    const found = [];
    const seenIds = new Set();

    for (const rawQ of candidates) {
      const normQ = normalizeAr(rawQ);
      const coreQ = cleanHadithCore(normQ);
      if (coreQ.split(/\s+/).length < 4 || quranNorms.has(normQ)) continue;

      // Bigram scoring against hadith index
      const counts = {};
      for (const bg of bigrams(coreQ.split(/\s+/))) {
        for (const idx of this.hadithBigrams[bg] || []) {
          counts[idx] = (counts[idx] || 0) + 1;
        }
      }
      if (Object.keys(counts).length === 0) continue;

      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      let best = null;
      for (const [idxStr] of sorted) {
        const h = this.hadiths[+idxStr];
        const hCore = h.coreNorm || h.norm;
        if (hCore.split(/\s+/).length < 4) continue;
        const s = partialRatio(coreQ, hCore);
        if (s >= 90 && (!best || s > best[0])) {
          best = [s, h];
        }
      }

      if (best && !seenIds.has(best[1].id)) {
        seenIds.add(best[1].id);
        found.push({
          hadithId: best[1].id,
          arSnippet: rawQ,
          csText: best[1].cs,
          score: Math.round(best[0] * 10) / 10,
        });
      }
    }

    return found;
  }

  /** Retrieve similar sermons from archive by bigram Jaccard + shared verse refs. */
  retrieveSimilarSermons(arText, matchedRefs, topK = 2) {
    const normInput = normalizeAr(arText);
    const inputBgs = new Set(bigrams(normInput.split(/\s+/)));
    const refSuras = new Set(matchedRefs.map(r => r.split(":")[0]));

    const scored = [];
    for (const s of this.archive) {
      const normS = normalizeAr(s.ar);
      // Skip self-match (>92% on first 600 chars)
      if (levRatio(normInput.slice(0, 600), normS.slice(0, 600)) > 92) continue;

      const sBgs = new Set(bigrams(normS.split(/\s+/)));
      const intersection = [...inputBgs].filter(x => sBgs.has(x)).length;
      const union = new Set([...inputBgs, ...sBgs]).size;
      const jaccard = intersection / Math.max(union, 1);

      // Shared verse reference boost
      const citeRefs = [...new Set(s.cs.match(/\((\d{1,3}:\d{1,3})\)/g) || [])].map(r => r.slice(1, -1));
      const exactRefOverlap = new Set(matchedRefs).size + new Set(citeRefs).size
        - new Set([...matchedRefs, ...citeRefs]).size;
      const suraOverlap = new Set(refSuras).size + new Set(citeRefs.map(r => r.split(":")[0])).size
        - new Set([...refSuras, ...citeRefs.map(r => r.split(":")[0])]).size;

      const totalScore = jaccard * 100 + exactRefOverlap * 4 + suraOverlap * 0.8;
      scored.push([totalScore, s]);
    }

    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, topK).map(x => x[1]);
  }
}

/* ------------------------------------------------------------------ */
/*  POSTPROCESS & VERIFY (port of translate.py postprocess_and_verify) */
/* ------------------------------------------------------------------ */

function normCmp(text) {
  // Normalize deity terms for comparison
  text = text.replace(/\b(bůh|boha|bohu|bohem|boží\w*|alláh\w*)\b/gi, "alláh");
  return text.toLowerCase().replace(/\W+/g, " ").trim();
}

function postprocessAndVerify(csText, matcher) {
  const warnings = [];

  // Strip markdown fences
  csText = csText.replace(/^```(?:markdown|md|text)?\s*\n|\n```\s*$/g, "").trim();

  // Refusal detection
  REFUSAL_RE.lastIndex = 0;
  if (REFUSAL_RE.test(csText)) {
    warnings.push("CRITICAL: Output resembles an AI refusal rather than a sermon translation!");
  }

  // Strip audience salam greetings
  AUDIENCE_SALAM_RE.lastIndex = 0;
  csText = csText.replace(AUDIENCE_SALAM_RE, "");

  // Bůh → Alláh adapter
  csText = adaptHrbekToMosqueCs(csText);

  // Script leak guard
  SCRIPT_LEAK_RE.lastIndex = 0;
  const leaks = csText.match(SCRIPT_LEAK_RE);
  if (leaks) {
    warnings.push(`Removed ${leaks.length} stray non-Latin character(s): [${[...new Set(leaks)].join(", ")}]`);
    SCRIPT_LEAK_RE.lastIndex = 0;
    csText = csText.replace(SCRIPT_LEAK_RE, "");
  }

  // Build verse map for Hrbek verification
  const verseMap = {};
  for (const [ref, , , csV] of matcher.verses) {
    const [s, a] = ref.split(":").map(Number);
    verseMap[`${s},${a}`] = csV;
  }

  // Verify cited (Sura:Aya) quotes against canonical Hrbek
  const quoteRe = /„([^"]{8,800})"\s*\((\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\)/g;

  csText = csText.replace(quoteRe, (match, qBody, sStr, a1Str, a2Str) => {
    const s = +sStr, a1 = +a1Str, a2 = +(a2Str || a1);
    const refStr = `${s}:${a1}` + (a2 !== a1 ? `-${a2}` : "");

    if (KHUTBAT_HAJAH_REFS.has(refStr) || !verseMap[`${s},${a1}`]) {
      return match;
    }

    // Build canonical Hrbek text for this verse range
    let hrbekFull = "";
    for (let a = a1; a <= a2; a++) {
      const v = verseMap[`${s},${a}`];
      if (v) hrbekFull += (hrbekFull ? " " : "") + v;
    }
    hrbekFull = hrbekFull.trim();

    const qNorm = normCmp(qBody);
    const hNorm = normCmp(hrbekFull);

    // Check if quote is roughly full-verse length
    const lenRatio = qNorm.length / Math.max(hNorm.length, 1);
    if (lenRatio >= 0.82 && lenRatio <= 1.18) {
      const fullSim = levRatio(qNorm, hNorm);
      if (fullSim < 100 && fullSim >= 65) {
        warnings.push(`Auto-snapped (${refStr}) from ${Math.round(fullSim * 10) / 10}% to 100% canonical Hrbek.`);
        return `„${hrbekFull}" (${refStr})`;
      }
      if (fullSim < 65) {
        warnings.push(`WARNING: Full quote (${refStr}) has low Hrbek similarity (${Math.round(fullSim * 10) / 10}%) — verify verse number!`);
      }
    }

    // Partial clause check
    if (qNorm.length < hNorm.length) {
      let bestSub = 0;
      const w = qNorm.length;
      for (let i = 0; i <= hNorm.length - w; i += Math.max(1, Math.floor(w / 4))) {
        const r = levRatio(qNorm, hNorm.slice(i, i + w));
        if (r > bestSub) bestSub = r;
      }
      if (bestSub < 85) {
        warnings.push(`Review partial quote (${refStr}) [Hrbek clause sim=${Math.round(bestSub * 10) / 10}%].`);
      }
    }

    return match;
  });

  // Balanced Czech quotation marks check
  const openQ = (csText.match(/„/g) || []).length;
  const closeQ = (csText.match(/"/g) || []).length;
  if (openQ !== closeQ) {
    warnings.push(`Unbalanced Czech quotation marks detected: „=${openQ} vs "=${closeQ}`);
  }

  return [csText, warnings];
}

/* ------------------------------------------------------------------ */
/*  BUILD TRANSLATION USER PAYLOAD                                     */
/* ------------------------------------------------------------------ */

async function buildTranslationUserPayload(arText, overrideDate, fewShotK, matcher) {
  const headerDate = extractOrFormatHeaderDate(arText, overrideDate);
  const qMatches = matcher.extractQuranMatches(arText);
  const hMatches = matcher.extractHadithMatches(arText, qMatches.map(q => q.arSnippet));
  const similar = matcher.retrieveSimilarSermons(arText, qMatches.map(q => q.ref), fewShotK);

  const blocks = [`[HEADER_DATE]: ${headerDate}`];

  if (qMatches.length || hMatches.length) {
    const lines = ["[VERIFIED SCRIPTURE MATCHES]"];
    qMatches.forEach((q, i) => {
      const mode = q.isPartial
        ? "PARTIAL SUB-VERSE QUOTED -> Extract ONLY the matching Czech clause from this canonical Hrbek verse"
        : "FULL VERSE QUOTED -> Copy this Czech verse verbatim";
      lines.push(
        `- QURAN #${i + 1} (${q.ref}) [${mode}]:\n` +
        `  Arabic in sermon: ${q.arSnippet}\n` +
        `  Canonical Czech (Hrbek + Alláh): „${q.csHrbek}" (${q.ref})`
      );
    });
    hMatches.forEach((h, j) => {
      lines.push(
        `- HADITH #${j + 1} (HadeethEnc #${h.hadithId}):\n` +
        `  Arabic in sermon: ${h.arSnippet}\n` +
        `  Verified Czech reference: ${h.csText}`
      );
    });
    blocks.push(lines.join("\n"));
  }

  if (similar.length) {
    const exLines = ["[REFERENCE ARCHIVE EXAMPLES (Match this institutional Czech register, vocatives, and flow)]"];
    similar.forEach((s, idx) => {
      exLines.push(`--- EXAMPLE ${idx + 1} (${s.date}) ---\nARABIC:\n${s.ar}\n\nCZECH:\n${s.cs}`);
    });
    blocks.push(exLines.join("\n\n"));
  }

  blocks.push(`[ARABIC KHUTBAH TO TRANSLATE]\n${arText.trim()}`);

  return {
    payload: blocks.join("\n\n========================================\n\n"),
    meta: {
      headerDate,
      quranMatches: qMatches,
      hadithMatches: hMatches,
      fewShotDates: similar.map(s => s.date),
    },
  };
}
