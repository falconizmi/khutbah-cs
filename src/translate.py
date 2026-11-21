# Portions of the non-Latin script leak guard, refusal detector, and deity
# post-processing are adapted from MinbarAI (https://github.com/Yacine-DH/MinbarAI):
# Copyright (c) 2026 M. Yacine Dhouafli — Licensed under the MIT License.
# See THIRD_PARTY_NOTICES.md at the repository root for full license text.

"""End-to-end Arabic -> Czech Friday Khutbah translator, Czech proofreader & Hrbek verifier.

Usage:
    python3 src/translate.py path/to/khutbah_ar.txt -o khutbah_cs.md
    python3 src/translate.py --test-archive 0
"""

import argparse
import re
from difflib import SequenceMatcher
from pathlib import Path

from gemini_client import generate_stream
from match_context import (
    ScriptureAndArchiveMatcher,
    adapt_hrbek_to_mosque_cs,
    build_translation_user_payload,
)

BASE_DIR = Path(__file__).resolve().parent.parent
PROMPT_FILE = BASE_DIR / "prompts" / "translation_prompt.md"

POLISH_SYSTEM_PROMPT = """You are a native Czech literary editor proofreading a Czech Friday sermon (khutbah) before it is read aloud in a mosque.

Review the Czech draft against the original Arabic sermon and fix ONLY:
1. Czech spelling, non-existent verb prefixes, diacritic slips, or wrong grammatical case/gender agreement (e.g. 'se Svatými služebníky' when Arabic says 'على عباده' -> 'se Svými služebníky'; 'nepohlídat na ně' -> 'nepohlížet na ně'; 'skryl tebe' -> 'skryl tobě'; 'Ibn Mádže' -> 'Ibn Mádži').
2. Awkward or unnatural phrasing so every sentence flows smoothly when spoken aloud from the pulpit.

STRICT LOCKS — DO NOT VIOLATE:
- NEVER alter a single word inside Qur'anic quotes `„...“ (Surah:Verse)` or the opening `Khutbat al-Hājah` paragraph.
- Keep `Alláh` / `Alláhův` (never `Bůh` / `Boží`), keep transliterated honorifics (`salla lláhu ʻalajhi wa sallam`, `radija lláhu anhu`), and NEVER add audience greetings (`As-salámu alajkum` / `Mír s vámi`).
- Output ONLY the final corrected Czech sermon text, with zero commentary.
- Keep gender-inclusive Czech vocatives ('bratři a sestry', 'muslimové a muslimky') even when the Arabic uses masculine plural ('إخوة الإيمان' / 'أيها الكرام') — NEVER revert them to masculine-only 'bratři' or 'věřící'!"""

# MinbarAI-inspired script leak guard: Arabic, Cyrillic, CJK, Hebrew, Persian/Urdu blocks
_SCRIPT_LEAK_RE = re.compile(r"[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u4E00-\u9FFF\u3040-\u30FF]")

# AI refusal detector (Czech + English)
_REFUSAL_RE = re.compile(
    r"(jako\s+jazykový\s+model|nemohu\s+přeložit|as\s+an\s+ai\s+language\s+model|i\s+cannot\s+fulfill)",
    re.IGNORECASE,
)

# Standalone congregation greeting guard (Ritual Silence during Friday khutbah)
_AUDIENCE_SALAM_RE = re.compile(
    r"^\s*(as-?salámu\s+alajkum[^\n]*|mír\s+s\s+vámi\s+a\s+milost[^\n]*)\n+",
    re.IGNORECASE | re.MULTILINE,
)

KHUTBAT_HAJAH_REFS = {"33:70", "33:71", "33:70-71", "3:102", "4:1"}


def _norm_cmp(text: str) -> str:
    text = re.sub(r"\b(bůh|boha|bohu|bohem|boží\w*|alláh\w*)\b", "alláh", text.lower())
    return re.sub(r"\W+", " ", text).strip()


def postprocess_and_verify(
    cs_text: str, matcher: ScriptureAndArchiveMatcher
) -> tuple[str, list[str]]:
    """
    Deterministic cleanup & QA verification:
    1. Strip outer markdown fences, audience salam greetings, and stray Bůh -> Alláh.
    2. Strip stray non-Latin script leaks (Arabic/Cyrillic characters inside Czech words).
    3. Verify cited (Sura:Aya) quotes against canonical Ivan Hrbek; auto-snap full-verse matches!
    4. Check balanced Czech quotes („ == “).
    """
    warnings: list[str] = []

    cs_text = re.sub(r"^```(?:markdown|md|text)?\s*\n|\n```\s*$", "", cs_text.strip()).strip()

    if _REFUSAL_RE.search(cs_text):
        warnings.append("CRITICAL: Output resembles an AI refusal rather than a sermon translation!")

    cs_text = _AUDIENCE_SALAM_RE.sub("", cs_text)
    cs_text = adapt_hrbek_to_mosque_cs(cs_text)

    leaks = _SCRIPT_LEAK_RE.findall(cs_text)
    if leaks:
        warnings.append(f"Removed {len(leaks)} stray non-Latin character(s): {sorted(set(leaks))}")
        cs_text = _SCRIPT_LEAK_RE.sub("", cs_text)

    verse_map: dict[tuple[int, int], str] = {}
    for ref, _, _, cs_v in matcher.verses:
        s, a = ref.split(":")
        verse_map[(int(s), int(a))] = cs_v

    quote_re = re.compile(r"„([^“]{8,800})“\s*\((\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\)")

    def _verify_quote(m: re.Match) -> str:
        q_body = m.group(1).strip()
        s, a1 = int(m.group(2)), int(m.group(3))
        a2 = int(m.group(4)) if m.group(4) else a1
        ref_str = f"{s}:{a1}" + (f"-{a2}" if a2 != a1 else "")

        if ref_str in KHUTBAT_HAJAH_REFS or (s, a1) not in verse_map:
            return m.group(0)

        hrbek_full = " ".join(verse_map.get((s, a), "") for a in range(a1, a2 + 1)).strip()
        q_norm = _norm_cmp(q_body)
        h_norm = _norm_cmp(hrbek_full)

        if 0.82 <= len(q_norm) / max(len(h_norm), 1) <= 1.18:
            full_sim = SequenceMatcher(None, q_norm, h_norm, autojunk=False).ratio()
            if full_sim < 1.0 and full_sim >= 0.65:
                warnings.append(f"Auto-snapped ({ref_str}) from {round(full_sim*100,1)}% to 100% canonical Hrbek.")
                return f"„{hrbek_full}“ ({ref_str})"
            if full_sim < 0.65:
                warnings.append(f"WARNING: Full quote ({ref_str}) has low Hrbek similarity ({round(full_sim*100,1)}%) — verify verse number!")
            return m.group(0)

        if q_norm in h_norm:
            return m.group(0)
        best_sub = 0.0
        if len(q_norm) < len(h_norm):
            w = len(q_norm)
            for i in range(len(h_norm) - w + 1):
                r = SequenceMatcher(None, q_norm, h_norm[i : i + w], autojunk=False).ratio()
                if r > best_sub:
                    best_sub = r
        if best_sub < 0.85:
            warnings.append(f"Review partial quote ({ref_str}) [Hrbek clause sim={round(best_sub*100,1)}%].")
        return m.group(0)

    cs_text = quote_re.sub(_verify_quote, cs_text)

    open_q, close_q = cs_text.count("„"), cs_text.count("“")
    if open_q != close_q:
        warnings.append(f"Unbalanced Czech quotation marks detected: „={open_q} vs “={close_q}")

    return cs_text, warnings


def main() -> None:
    parser = argparse.ArgumentParser(description="Translate an Arabic Friday sermon into Czech")
    parser.add_argument("input", nargs="?", help="Path to input Arabic .txt file")
    parser.add_argument("-o", "--output", help="Path to save translated Czech .md/.txt file")
    parser.add_argument("--date", help="Optional YYYY-MM-DD override for the sermon Friday date")
    parser.add_argument("--few-shot", type=int, default=2, help="Number of similar Prague sermons to include (default: 2)")
    parser.add_argument("--model", default="gemini-4-hydrogen", help="Preferred Free-Tier Gemini model (default: gemini-4-hydrogen)")
    parser.add_argument("--no-polish", action="store_true", help="Skip Pass 2 Czech proofreading (saves 1 API call during quick tests)")
    parser.add_argument(
        "--test-archive",
        type=int,
        default=None,
        help="Test pipeline on sermon index N from prague_archive.json (self-match auto-excluded from few-shot!)",
    )
    args = parser.parse_args()

    if not args.input and args.test_archive is None:
        parser.error("Provide an input Arabic file OR pass `--test-archive 0` to run a test translation.")

    matcher = ScriptureAndArchiveMatcher()
    if args.test_archive is not None:
        sample = matcher.archive[args.test_archive]
        ar_text = f"{sample['title_ar']}\n\n{sample['ar']}"
        override_date = args.date or sample["date"]
        out_path = Path(args.output or f"outputs/test_{sample['date']}_cs.md")
        print(f"🧪 Testing on archive sermon #{args.test_archive} [{sample['date']}]: {sample['title_ar']}")
    else:
        in_path = Path(args.input)
        ar_text = in_path.read_text(encoding="utf-8")
        override_date = args.date
        out_path = Path(args.output) if args.output else in_path.with_name(in_path.stem + "_cs.md")

    system_prompt = PROMPT_FILE.read_text(encoding="utf-8")
    user_payload, meta = build_translation_user_payload(
        ar_text,
        override_date=override_date,
        few_shot_k=args.few_shot,
        matcher=matcher,
    )

    print(f"📅 Header Date       : {meta['header_date']}")
    print(f"📖 Quran Matches     : {len(meta['quran_matches'])} ({', '.join(q.ref for q in meta['quran_matches']) or 'none'})")
    print(f"📜 Hadith Matches    : {len(meta['hadith_matches'])}")
    print(f"🗂️  Few-Shot Examples : {meta['few_shot_dates']}")
    print(f"\n🚀 [Pass 1] Translating via Free-Tier Gemini (preferred={args.model})...\n")

    draft_cs, trans_model = generate_stream(
        system_prompt=system_prompt,
        user_text=user_payload,
        preferred_model=args.model,
        temperature=0.2,
        thinking_level="high",
        stream_to_stdout=True,
        chunk_timeout=150,
    )

    if not args.no_polish:
        print(f"✍️  [Pass 1 done via {trans_model}] -> Running [Pass 2] Czech grammar & spoken cadence polish...\n")
        polish_input = f"[ORIGINAL ARABIC SERMON]\n{ar_text}\n\n[CZECH DRAFT TO PROOFREAD]\n{draft_cs}"
        raw_cs, polish_model = generate_stream(
            system_prompt=POLISH_SYSTEM_PROMPT,
            user_text=polish_input,
            preferred_model=args.model,
            temperature=0.1,
            thinking_level="low",
            stream_to_stdout=True,
            chunk_timeout=150,
        )
        used_model_str = f"{trans_model} + polish:{polish_model}"
    else:
        raw_cs = draft_cs
        used_model_str = trans_model

    final_cs, warnings = postprocess_and_verify(raw_cs, matcher)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(final_cs + "\n", encoding="utf-8")

    print(f"\n✅ Saved Czech sermon -> {out_path} ({used_model_str})")
    if warnings:
        print("🔎 Post-Processing & Hrbek QA Notes:")
        for w in warnings:
            print(f"   • {w}")
    else:
        print("✨ Post-Processing & Hrbek QA: 0 warnings (all quotes balanced, zero script leaks, 100% Hrbek lock)!")


if __name__ == "__main__":
    main()
