# Portions of the Arabic normalization and word-bigram rapidfuzz Quran matcher
# are adapted from MinbarAI (https://github.com/Yacine-DH/MinbarAI):
# Copyright (c) 2026 M. Yacine Dhouafli — Licensed under the MIT License.
# See THIRD_PARTY_NOTICES.md at the repository root for full license text.

"""Offline scripture & style context matcher (0 API calls).

Given a raw Arabic Friday sermon (khutbah):
1. Computes the Czech Gregorian + Islamic Hijri header date string (`[HEADER_DATE]`).
2. Scans explicit Quran brackets (`﴿...﴾`, `{...}`) and unbracketed quotes using a
   diacritic-stripped word-bigram + rapidfuzz index over `quran_cs.json` (6,236 verses),
   adapting Ivan Hrbek's Czech text (`Bůh/Boží` -> `Alláh/Alláhův` across all cases).
3. Scans Prophetic quotes (`«...»`, `"..."`) against `hadith_cs.json` (478 Hadiths).
4. Retrieves the top-K most relevant parallel sermons from `prague_archive.json`
   by shared Quran references and Arabic bigram overlap for few-shot style alignment.
"""

import argparse
import datetime as dt
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

try:
    from rapidfuzz import fuzz
except ImportError as exc:
    raise SystemExit(
        "❌ Missing dependency `rapidfuzz`. Install it with: pip install -r requirements.txt"
    ) from exc

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "processed"
QURAN_FILE = DATA_DIR / "quran_cs.json"
HADITH_FILE = DATA_DIR / "hadith_cs.json"
ARCHIVE_FILE = DATA_DIR / "prague_archive.json"

MIN_WORDS = 3
SCORE_THRESHOLD = 82.0
MAX_CANDIDATES = 15

_DIACRITICS = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
_NON_ARABIC = re.compile(r"[^\u0621-\u064A\s]")

# Known OCR typos in Tanzil's cs.hrbek.txt uncovered during our 70-sermon QA audit
_HRBEK_OCR_FIXES = [
    (re.compile(r"\bca\b"), "co"),
    (re.compile(r"\bshromaždují\b"), "shromažďují"),
    (re.compile(r"\brozdáváni\b"), "rozdávání"),
]

# Preceding Czech words indicating generic deity ('إله' = bůh/božstvo), NOT Allah
_GENERIC_DEITY_PRECEDERS = {
    "žádný", "žádného", "žádnému", "žádným",
    "jiný", "jiného", "jinému", "jiným",
    "jeden", "jednoho", "jediný", "jediného",
    "falešný", "falešného", "kromě",  # note: 'není boha kromě Boha' -> lowercase 'boha' stays!
}

# Capitalized 'Bůh / Boží' in Ivan Hrbek always refers to Allah (lowercase 'bůh/boha/bohy' = generic deity)
_CS_DEITY_CASES = [
    (re.compile(r"\bBožím\b"), "Alláhovým"),
    (re.compile(r"\bBožích\b"), "Alláhových"),
    (re.compile(r"\bBožími\b"), "Alláhovými"),
    (re.compile(r"\bBožího\b"), "Alláhova"),
    (re.compile(r"\bBožímu\b"), "Alláhovu"),
    (re.compile(r"\bBoží\b"), "Alláhova"),  # safe default; note: Hrbek uses 'vůle Boží', 'posel Boží' -> see phrase rules first!
    (re.compile(r"\bBohem\b"), "Alláhem"),
    (re.compile(r"\bBohu\b"), "Alláhovi"),
    (re.compile(r"\bBoha\b"), "Alláha"),
    (re.compile(r"\bBože\b"), "Alláhu"),
    (re.compile(r"\bBůh\b"), "Alláh"),
]

# Gender-accurate collocations in Hrbek for possessive 'Boží' before general fallback
_CS_BOZI_COLLOCATIONS = [
    # Masculine animate/inanimate singular -> Alláhův
    (re.compile(r"\b([Pp]osel|[Ss]lužebník|[Pp]rorok|[Dd]uch|[Ss]lib|[Zz]ákon|[Tt]rest|[Hh]něv|[Dd]ar|[Dd]ům|[Mm]ěsíc|[Ll]id)\s+Boží\b"), r"\1 Alláhův"),
    (re.compile(r"\bBoží\s+(posel|služebník|prorok|slib|zákon|trest|hněv|dar|dům|měsíc|lid)\b"), r"Alláhův \1"),
    # Neuter singular -> Alláhovo
    (re.compile(r"\b([Ss]lovo|[Pp]ísmo|[Jj]méno|[Rr]ozhodnutí|[Пp]řikázání|[Kk]rálovství|[Ss]větlo|[Vv]edení|[Mm]ilosrdenství|[Pp]ožehnání|[Vv]ítězství|[Pp]ověření)\s+Boží\b"), r"\1 Alláhovo"),
    (re.compile(r"\bBoží\s+(slovo|písmo|jméno|rozhodnutí|přikázání|království|světlo|vedení|milosrdenství|požehnání|vítězství|pověření)\b"), r"Alláhovo \1"),
    # Genitive / Locative feminine singular ('na cestě Boží', 'z vůle Boží', 'u tváře Boží') -> Alláhovy / Alláhové
    (re.compile(r"\b(cestě|vůle|milosti|pomoci|ochraně|knize|přítomnosti|blízkosti|tváři)\s+Boží\b"), r"\1 Alláhově"),
    (re.compile(r"\b(z\s+vůle|bez\s+vůle|z\s+milosti|od\s+tváře|u\s+tváře)\s+Boží\b"), r"\1 Alláhovy"),
    # Accusative feminine singular ('cestu Boží', 'milost Boží', 'tvář Boží') -> Alláhovu
    (re.compile(r"\b(cestu|vůli|milost|pomoc|ochranu|knihu|tvář|odměnu)\s+Boží\b"), r"\1 Alláhovu"),
    # Plural ('znamení Boží', 'slova Boží', 'přátelé Boží') -> Alláhova / Alláhovi
    (re.compile(r"\b(znamení|slova|přikázání|ustanovení)\s+Boží\b"), r"\1 Alláhova"),
    (re.compile(r"\b(přátelé|služebníci|poslové|andělé|vojáci)\s+Boží\b"), r"\1 Alláhovi"),
]

HIJRI_MONTHS_CS = [
    "muharram",
    "safar",
    "rabí´ al-awwal",
    "rabí´ ath-thání",
    "džumádá al-úlá",
    "džumádá al-áchira",
    "radžab",
    "ša'bán",
    "ramadán",
    "šawwál",
    "dhú al-qa'da",
    "dhú al-hidždža",
]


def normalize_ar(text: str) -> str:
    """Strip diacritics/tatweel, unify Arabic letter variants, keep Arabic letters only."""
    text = _DIACRITICS.sub("", text)
    text = _NON_ARABIC.sub(" ", text)
    text = re.sub(r"[أإآٱ]", "ا", text)
    text = text.replace("ى", "ي")
    text = text.replace("ة", "ه")
    text = text.replace("ؤ", "و")
    text = text.replace("ئ", "ي")
    return " ".join(text.split())


def _bigrams(words: list[str]) -> list[str]:
    return [f"{words[i]} {words[i + 1]}" for i in range(len(words) - 1)]


def adapt_hrbek_to_mosque_cs(text: str) -> str:
    """
    Adapt Ivan Hrbek's Czech Quran/Hadith text to Prague/Teplice Mosque convention:
    - Fix known Tanzil OCR typos ('ca' -> 'co', etc.)
    - Replace capitalized 'Bůh / Boží' (Allah) with 'Alláh / Alláhův' across Czech cases,
      while preserving lowercase generic deity uses ('není boha kromě Alláha').
    """
    for pat, rep in _HRBEK_OCR_FIXES:
        text = pat.sub(rep, text)

    for pat, rep in _CS_BOZI_COLLOCATIONS:
        text = pat.sub(rep, text)

    for pat, rep in _CS_DEITY_CASES:
        def _sub_fn(m: re.Match, replacement: str = rep) -> str:
            before = text[: m.start()].split()
            prev = before[-1].strip('„"‚\',.;:!?()[]').lower() if before else ""
            if prev in _GENERIC_DEITY_PRECEDERS and prev != "kromě":
                return m.group(0).lower()
            return replacement

        text = pat.sub(_sub_fn, text)

    return text


def gregorian_to_hijri_tabular(g_date: dt.date) -> tuple[int, int, int]:
    """
    Kuwaiti/Tabular Islamic calendar conversion (stdlib-only fallback;
    uses Umm al-Qura `hijridate` automatically if installed).
    """
    try:
        from hijridate import Gregorian  # type: ignore
        h = Gregorian(g_date.year, g_date.month, g_date.day).to_hijri()
        return h.year, h.month, h.day
    except ImportError:
        pass

    # Julian Day Number from Gregorian date
    a = (14 - g_date.month) // 12
    y = g_date.year + 4800 - a
    m = g_date.month + 12 * a - 3
    jd = (
        g_date.day
        + (153 * m + 2) // 5
        + 365 * y
        + y // 4
        - y // 100
        + y // 400
        - 32045
    )

    # Convert JDN to Islamic Civil/Tabular calendar
    l = jd - 1948440 + 10632
    n = (l - 1) // 10631
    l = l - 10631 * n + 354
    j = ((10985 - l) // 5316) * ((50 * l) // 17719) + (l // 5670) * ((43 * l) // 15238)
    l = l - ((30 - j) // 15) * ((17719 * j) // 50) - (j // 16) * ((15238 * j) // 43) + 29
    h_month = (24 * l) // 709
    h_day = l - (709 * h_month) // 24
    h_year = 30 * n + j - 30
    return h_year, h_month, h_day


def extract_or_format_header_date(ar_text: str, override_date: str | None = None) -> str:
    """Parse YYYY-MM-DD or (YYYY/M/D) from Arabic text (or CLI override) -> Czech header string."""
    g_date = None
    if override_date:
        g_date = dt.date.fromisoformat(override_date)
    else:
        m = re.search(r"(20\d{2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(\d{1,2})", ar_text[:600])
        if m:
            try:
                g_date = dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                g_date = None

    if g_date is None:
        g_date = dt.date.today()

    hy, hm, hd = gregorian_to_hijri_tabular(g_date)
    month_cs = HIJRI_MONTHS_CS[hm - 1]
    return f"{g_date.day}. {g_date.month}. {g_date.year} ({hd}. {month_cs} {hy} h)"


@dataclass
class QuranMatch:
    ref: str            # e.g. "40:19" or "20:123-124"
    ar_snippet: str     # exact Arabic span from the sermon
    cs_hrbek: str       # Hrbek Czech verse(s) with Bůh -> Alláh applied
    is_partial: bool    # True if sermon quoted only a sub-clause of a longer verse
    score: float


@dataclass
class HadithMatch:
    hadith_id: str
    ar_snippet: str
    cs_text: str
    score: float


class ScriptureAndArchiveMatcher:
    def __init__(self) -> None:
        raw_quran = json.loads(QURAN_FILE.read_text(encoding="utf-8"))
        self.verses: list[tuple[str, str, str, str]] = []  # (ref, ar_clean, ar_orig, cs_adapted)
        self.bigram_index: dict[str, set[int]] = {}
        self.exact_index: dict[str, int] = {}
        self.basmala_norm = normalize_ar("بسم الله الرحمن الرحيم")
        self.taawudh_norm = normalize_ar("أعوذ بالله من الشيطان الرجيم")

        for row in raw_quran:
            ref = f"{row['sura']}:{row['aya']}"
            norm = row.get("ar_clean") or normalize_ar(row["ar"])
            cs_adapted = adapt_hrbek_to_mosque_cs(row["cs"])
            idx = len(self.verses)
            self.verses.append((ref, norm, row["ar"], cs_adapted))
            self.exact_index.setdefault(norm, idx)
            for bg in _bigrams(norm.split()):
                self.bigram_index.setdefault(bg, set()).add(idx)

        raw_hadith = json.loads(HADITH_FILE.read_text(encoding="utf-8"))
        self.hadiths: list[dict] = []
        self.hadith_bigrams: dict[str, set[int]] = {}
        for h in raw_hadith:
            idx = len(self.hadiths)
            norm = h.get("ar_clean") or normalize_ar(h.get("ar", ""))
            title_norm = h.get("title_ar_clean") or normalize_ar(h.get("title_ar", ""))
            self.hadiths.append({
                "id": str(h.get("id", idx)),
                "norm": norm,
                "title_norm": title_norm,
                "cs": adapt_hrbek_to_mosque_cs(h.get("cs", "")),
            })
            for bg in set(_bigrams(norm.split()) + _bigrams(title_norm.split())):
                self.hadith_bigrams.setdefault(bg, set()).add(idx)

        self.archive: list[dict] = json.loads(ARCHIVE_FILE.read_text(encoding="utf-8"))

    def match_quran_span(self, raw_span: str, explicit_brackets: bool = True) -> QuranMatch | None:
        norm = normalize_ar(raw_span)
        for prefix in (self.taawudh_norm, self.basmala_norm):
            if norm.startswith(prefix + " "):
                norm = norm[len(prefix) + 1 :].strip()

        if not norm:
            return None

        if norm in self.exact_index:
            idx = self.exact_index[norm]
            ref, _, _, cs = self.verses[idx]
            return QuranMatch(ref=ref, ar_snippet=raw_span.strip(), cs_hrbek=cs, is_partial=False, score=100.0)

        words = norm.split()
        if len(words) < MIN_WORDS:
            return None

        counts: Counter[int] = Counter()
        for bg in _bigrams(words):
            for idx in self.bigram_index.get(bg, ()):
                counts[idx] += 1
        if not counts:
            return None

        best = None
        for idx, _ in counts.most_common(MAX_CANDIDATES):
            ref, vnorm, _, cs = self.verses[idx]
            score = fuzz.partial_ratio(norm, vnorm)
            if best is None or score > best[0]:
                best = (score, idx)

        if best is None or best[0] < SCORE_THRESHOLD:
            return None

        score, idx = best
        lo = hi = idx
        best_full = fuzz.ratio(norm, self.verses[idx][1])

        # Greedily extend across consecutive verses in the same sura (MinbarAI multi-verse logic)
        base_sura = self.verses[idx][0].split(":")[0]
        improved = True
        while improved:
            improved = False
            for nlo, nhi in ((lo - 1, hi), (lo, hi + 1)):
                if nlo < 0 or nhi >= len(self.verses):
                    continue
                if self.verses[nlo][0].split(":")[0] != base_sura or self.verses[nhi][0].split(":")[0] != base_sura:
                    continue
                joined = " ".join(v[1] for v in self.verses[nlo : nhi + 1])
                s = fuzz.ratio(norm, joined)
                if s > best_full + 1.5:
                    best_full, lo, hi = s, nlo, nhi
                    improved = True
                    break

        joined_norm = " ".join(v[1] for v in self.verses[lo : hi + 1])
        contained = len(norm) <= len(joined_norm) * 1.2
        if not contained and best_full < 72:
            return None

        is_partial = len(norm) < len(joined_norm) * 0.85
        if is_partial:
            aln = fuzz.partial_ratio_alignment(norm, joined_norm)
            min_frag_score = 88.0 if explicit_brackets else 94.0
            if aln is None or aln.score < min_frag_score:
                return None
            # For unbracketed prose, enforce MinbarAI's strict rule against mid-verse false positives
            if not explicit_brackets:
                coverage = (aln.dest_end - aln.dest_start) / max(len(joined_norm), 1)
                if aln.dest_start > 12 and coverage < 0.85:
                    return None

        first_ref = self.verses[lo][0]
        last_v = self.verses[hi][0].split(":")[1]
        ref = first_ref if lo == hi else f"{first_ref}-{last_v}"
        cs_joined = " ".join(v[3] for v in self.verses[lo : hi + 1])

        return QuranMatch(
            ref=ref,
            ar_snippet=raw_span.strip(),
            cs_hrbek=cs_joined,
            is_partial=is_partial,
            score=round(max(score, best_full), 1),
        )

    def extract_quran_matches(self, ar_text: str) -> list[QuranMatch]:
        """Find all Quran quotes in a written Arabic sermon (bracketed & unbracketed)."""
        matches: list[QuranMatch] = []
        seen_spans: list[tuple[int, int]] = []

        # 1. Explicit Quranic brackets: ﴿...﴾ or {...}
        bracket_re = re.compile(r"﴿([^﴾]{8,1500})﴾|\{([^\}]{8,1500})\}")
        for m in bracket_re.finditer(ar_text):
            span_txt = m.group(1) or m.group(2)
            qm = self.match_quran_span(span_txt, explicit_brackets=True)
            if qm:
                matches.append(qm)
                seen_spans.append((m.start(), m.end()))

        # 2. Quotes introduced by قال تعالى / يقول الله تعالى in standard quotes «...» or "..." or “...”
        intro_re = re.compile(
            r"(?:قال|يقول)\s+(?:الله\s+)?(?:تعالى|سبحانه[^\n:«\"“]{0,25})\s*[:：]?\s*[«\"“]([^»\"”]{10,1200})[»\"”]"
        )
        for m in intro_re.finditer(ar_text):
            if any(not (m.end() <= s or m.start() >= e) for s, e in seen_spans):
                continue
            qm = self.match_quran_span(m.group(1), explicit_brackets=True)
            if qm:
                matches.append(qm)
                seen_spans.append((m.start(), m.end()))

        # Deduplicate while preserving sermon order
        unique: list[QuranMatch] = []
        seen_keys: set[tuple[str, str]] = set()
        for qm in matches:
            key = (qm.ref, normalize_ar(qm.ar_snippet))
            if key not in seen_keys:
                seen_keys.add(key)
                unique.append(qm)
        return unique

    def extract_hadith_matches(self, ar_text: str, quran_refs_spans: list[str]) -> list[HadithMatch]:
        """Scan Prophetic quotes «...» / “...” against hadith_cs.json (478 HadeethEnc Hadiths)."""
        quran_norms = {normalize_ar(s) for s in quran_refs_spans}
        quote_re = re.compile(r"«([^»]{15,1200})»|“([^”]{15,1200})”|\"([^\"]{15,1200})\"")
        found: list[HadithMatch] = []
        seen_ids: set[str] = set()

        for m in quote_re.finditer(ar_text):
            raw_q = (m.group(1) or m.group(2) or m.group(3)).strip()
            norm_q = normalize_ar(raw_q)
            if len(norm_q.split()) < 4 or norm_q in quran_norms:
                continue

            counts: Counter[int] = Counter()
            for bg in _bigrams(norm_q.split()):
                for idx in self.hadith_bigrams.get(bg, ()):
                    counts[idx] += 1
            if not counts:
                continue

            best = None
            for idx, _ in counts.most_common(8):
                h = self.hadiths[idx]
                if not h["norm"]:
                    continue
                s = fuzz.partial_ratio(norm_q, h["norm"])
                # Require substantial overlap so generic 4-word phrases don't false-match a long hadith Story
                aln = fuzz.partial_ratio_alignment(norm_q, h["norm"])
                cov = (aln.dest_end - aln.dest_start) / max(len(h["norm"]), 1) if aln else 0.0
                if s >= 88.0 and (cov >= 0.35 or len(norm_q) >= 45):
                    if best is None or s > best[0]:
                        best = (s, h)

            if best and best[1]["id"] not in seen_ids:
                seen_ids.add(best[1]["id"])
                found.append(
                    HadithMatch(
                        hadith_id=best[1]["id"],
                        ar_snippet=raw_q,
                        cs_text=best[1]["cs"],
                        score=round(best[0], 1),
                    )
                )
        return found

    def retrieve_similar_sermons(
        self, ar_text: str, matched_refs: list[str], top_k: int = 2
    ) -> list[dict]:
        """Pick top-K parallel AR-CS sermons from prague_archive.json (excluding exact self-match)."""
        norm_input = normalize_ar(ar_text)
        input_bgs = set(_bigrams(norm_input.split()))
        ref_suras = {r.split(":")[0] for r in matched_refs}

        scored: list[tuple[float, dict]] = []
        for s in self.archive:
            norm_s = normalize_ar(s["ar"])
            # Skip if user is testing on an exact sermon from prague_archive.json (avoid data leak!)
            if fuzz.ratio(norm_input[:600], norm_s[:600]) > 92.0:
                continue

            s_bgs = set(_bigrams(norm_s.split()))
            jaccard = len(input_bgs & s_bgs) / max(len(input_bgs | s_bgs), 1)

            # Boost sermons that cite the exact same Quran verses or Suras
            cite_refs = set(re.findall(r"\((\d{1,3}:\d{1,3})\)", s["cs"]))
            exact_ref_overlap = len(set(matched_refs) & cite_refs)
            sura_overlap = len(ref_suras & {r.split(":")[0] for r in cite_refs})

            total_score = jaccard * 100.0 + exact_ref_overlap * 4.0 + sura_overlap * 0.8
            scored.append((total_score, s))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [item[1] for item in scored[:top_k]]


def build_translation_user_payload(
    ar_text: str,
    override_date: str | None = None,
    few_shot_k: int = 2,
    matcher: ScriptureAndArchiveMatcher | None = None,
) -> tuple[str, dict]:
    """Assemble the complete user prompt with [HEADER_DATE], [VERIFIED SCRIPTURE MATCHES], and few-shot examples."""
    m = matcher or ScriptureAndArchiveMatcher()
    header_date = extract_or_format_header_date(ar_text, override_date=override_date)
    q_matches = m.extract_quran_matches(ar_text)
    h_matches = m.extract_hadith_matches(ar_text, [q.ar_snippet for q in q_matches])
    similar = m.retrieve_similar_sermons(ar_text, [q.ref for q in q_matches], top_k=few_shot_k)

    blocks: list[str] = [f"[HEADER_DATE]: {header_date}"]

    if q_matches or h_matches:
        lines = ["[VERIFIED SCRIPTURE MATCHES]"]
        for i, q in enumerate(q_matches, 1):
            mode = (
                "PARTIAL SUB-VERSE QUOTED -> Extract ONLY the matching Czech clause from this canonical Hrbek verse"
                if q.is_partial
                else "FULL VERSE QUOTED -> Copy this Czech verse verbatim"
            )
            lines.append(
                f"- QURAN #{i} ({q.ref}) [{mode}]:\n"
                f"  Arabic in sermon: {q.ar_snippet}\n"
                f"  Canonical Czech (Hrbek + Alláh): „{q.cs_hrbek}“ ({q.ref})"
            )
        for j, h in enumerate(h_matches, 1):
            lines.append(
                f"- HADITH #{j} (HadeethEnc #{h.hadith_id}):\n"
                f"  Arabic in sermon: {h.ar_snippet}\n"
                f"  Verified Czech reference: {h.cs_text}"
            )
        blocks.append("\n".join(lines))

    if similar:
        ex_lines = [
            "[REFERENCE ARCHIVE EXAMPLES (Match this institutional Czech register, vocatives, and flow)]"
        ]
        for idx, s in enumerate(similar, 1):
            ex_lines.append(
                f"--- EXAMPLE {idx} ({s['date']}) ---\n"
                f"ARABIC:\n{s['ar']}\n\n"
                f"CZECH:\n{s['cs']}"
            )
        blocks.append("\n\n".join(ex_lines))

    blocks.append(f"[ARABIC KHUTBAH TO TRANSLATE]\n{ar_text.strip()}")

    meta = {
        "header_date": header_date,
        "quran_matches": q_matches,
        "hadith_matches": h_matches,
        "few_shot_dates": [s["date"] for s in similar],
    }
    return "\n\n========================================\n\n".join(blocks), meta


def main() -> None:
    parser = argparse.ArgumentParser(description="Test offline scripture & context matching on an Arabic sermon")
    parser.add_argument("input", nargs="?", help="Path to Arabic sermon .txt (omit to test on latest archive sermon)")
    parser.add_argument("--date", help="Optional YYYY-MM-DD override for header date")
    args = parser.parse_args()

    matcher = ScriptureAndArchiveMatcher()
    if args.input:
        ar_text = Path(args.input).read_text(encoding="utf-8")
    else:
        sample = matcher.archive[0]
        print(f"🧪 No file passed — testing matcher on archive sermon [{sample['date']}]: {sample['title_ar']}\n")
        ar_text = f"{sample['title_ar']}\n\n{sample['ar']}"

    _, meta = build_translation_user_payload(ar_text, override_date=args.date, matcher=matcher)
    print(f"📅 Computed [HEADER_DATE]: {meta['header_date']}")
    print(f"📖 Matched Quran passages : {len(meta['quran_matches'])}")
    for q in meta["quran_matches"]:
        tag = "PARTIAL" if q.is_partial else "FULL"
        print(f"   • ({q.ref}) [{tag} | score={q.score}] -> „{q.cs_hrbek[:95]}{'…' if len(q.cs_hrbek) > 95 else ''}“")
    print(f"📜 Matched Hadiths        : {len(meta['hadith_matches'])}")
    for h in meta["hadith_matches"]:
        print(f"   • [ID {h.hadith_id} | score={h.score}] -> {h.cs_text[:95]}…")
    print(f"🗂️  Retrieved Few-Shot     : {meta['few_shot_dates']}")


if __name__ == "__main__":
    main()
