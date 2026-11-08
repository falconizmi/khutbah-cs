import csv
import html
import json
import re
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "data" / "raw"
OUT_DIR = BASE_DIR / "data" / "processed"

AR_CLEAN_FILE = RAW_DIR / "quran-simple-clean.txt"
CS_HRBEK_FILE = RAW_DIR / "cs.hrbek.txt"
RAW_PRAGUE_AR = RAW_DIR / "prague_khutbahs_ar.json"
RAW_PRAGUE_CS = RAW_DIR / "prague_khutbahs_cs.json"

OUT_QURAN_JSON = OUT_DIR / "quran_cs.json"
OUT_HADITH_JSON = OUT_DIR / "hadith_cs.json"
OUT_PRAGUE_JSON = OUT_DIR / "prague_archive.json"

TASHKEEL_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
WHITESPACE_RE = re.compile(r"\s+")
BISMILLAH_PREFIX = "بسم الله الرحمن الرحيم "
HTML_TAG_RE = re.compile(r"<[^>]+>")
MULTI_NEWLINE_RE = re.compile(r"\n{3,}")

# Recurring Khutbat al-Hajah verses (excluded when verifying body-verse overlap)
KHUTBAT_HAJAH_VERSES = {(3, 102), (4, 1), (33, 70), (33, 71)}

# Known MS Word template typo in Prague Czech sermons: opening quote before 33:70-71
# ("„Vy, kteří jste uvěřili, chraňte se...") is missing its closing quote "“"
UNCLOSED_HAJAH_RE = re.compile(
    r"(„Vy,\s+kteří\s+jste\s+uvěřili,\s+chraňte\s+se\s+před\s+trestem\s+Alláha[^“\n]+?"
    r"dosáhne\s+nesmírného\s+vítězství\.?)(?=\s*(?:\n|$))",
    re.MULTILINE,
)


def normalize_arabic(text: str) -> str:
    text = TASHKEEL_RE.sub("", text)
    text = re.sub(r"[أإآٱ]", "ا", text)
    text = text.replace("ى", "ي").replace("ة", "ه")
    text = re.sub(r"[^\w\s]", " ", text)
    return WHITESPACE_RE.sub(" ", text).strip()


def load_tanzil_file(filepath: Path) -> dict[tuple[int, int], str]:
    verses = {}
    with filepath.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|", maxsplit=2)
            if len(parts) == 3:
                verses[(int(parts[0]), int(parts[1]))] = parts[2].strip()
    return verses


def build_quran_dataset() -> dict[tuple[int, int], str]:
    ar_verses = load_tanzil_file(AR_CLEAN_FILE)
    cs_verses = load_tanzil_file(CS_HRBEK_FILE)

    merged_data = []
    quran_ar_clean_map: dict[tuple[int, int], str] = {}
    for (sura, aya), ar_text in sorted(ar_verses.items()):
        cs_text = cs_verses[(sura, aya)]
        ar_for_matching = ar_text
        if sura not in (1, 9) and aya == 1 and ar_for_matching.startswith(BISMILLAH_PREFIX):
            ar_for_matching = ar_for_matching[len(BISMILLAH_PREFIX):]

        ar_clean = normalize_arabic(ar_for_matching)
        quran_ar_clean_map[(sura, aya)] = ar_clean
        merged_data.append(
            {
                "sura": sura,
                "aya": aya,
                "ref": f"Korán {sura}:{aya}",
                "ar": ar_for_matching,
                "ar_clean": ar_clean,
                "cs": cs_text,
            }
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUT_QURAN_JSON.open("w", encoding="utf-8") as f:
        json.dump(merged_data, f, ensure_ascii=False, indent=2)
    print(f"✅ Wrote {len(merged_data)} verses to {OUT_QURAN_JSON.name}")
    return quran_ar_clean_map


def build_hadith_dataset():
    matches = sorted(RAW_DIR.glob("HadeethEnc.com_cs*.csv"))
    csv_path = matches[-1]

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        lines = f.readlines()

    header_idx = next(i for i, line in enumerate(lines) if line.startswith("id,title_ar,title"))
    reader = csv.DictReader(lines[header_idx:])
    hadiths = []

    for row in reader:
        h_id = (row.get("id") or "").strip()
        ar_full = (row.get("hadith_text_ar") or "").strip()
        cs_full = (row.get("hadith_text") or "").strip()
        title_ar = (row.get("title_ar") or "").strip()
        title_cs = (row.get("title") or "").strip()
        grade_cs = (row.get("grade") or "").strip()
        takhrij_cs = (row.get("takhrij") or "").strip()

        if not h_id or not ar_full or not cs_full:
            continue

        ref_parts = [f"Hadís #{h_id}"] + [x for x in (takhrij_cs, grade_cs) if x]
        hadiths.append(
            {
                "id": int(h_id) if h_id.isdigit() else h_id,
                "ref": " – ".join(ref_parts),
                "title_ar": title_ar,
                "title_ar_clean": normalize_arabic(title_ar),
                "title_cs": title_cs,
                "ar": ar_full,
                "ar_clean": normalize_arabic(ar_full),
                "cs": cs_full,
            }
        )

    with OUT_HADITH_JSON.open("w", encoding="utf-8") as f:
        json.dump(hadiths, f, ensure_ascii=False, indent=2)
    print(f"✅ Wrote {len(hadiths)} Hadiths to {OUT_HADITH_JSON.name}")


def clean_wp_html(raw_html: str, fix_cs_quotes: bool = False) -> str:
    text = re.sub(r"</(p|div|h[1-6]|li|br\s*/?)>", "\n", raw_html, flags=re.IGNORECASE)
    text = HTML_TAG_RE.sub("", text)
    text = html.unescape(text).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    text = "\n\n".join(line for line in lines if line)
    text = MULTI_NEWLINE_RE.sub("\n\n", text).strip()
    if fix_cs_quotes:
        text = UNCLOSED_HAJAH_RE.sub(r"\1“", text)
    return text


def extract_date(title: str, wp_date_str: str) -> tuple[bool, str]:
    m_ar = re.search(r"(20\d{2})\s*[/\-\.]\s*(\d{1,2})\s*[/\-\.]\s*(\d{1,2})", title)
    if m_ar:
        return True, f"{int(m_ar.group(1)):04d}-{int(m_ar.group(2)):02d}-{int(m_ar.group(3)):02d}"
    m_cs = re.search(r"(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})", title)
    if m_cs:
        return True, f"{int(m_cs.group(3)):04d}-{int(m_cs.group(2)):02d}-{int(m_cs.group(1)):02d}"
    return False, wp_date_str[:10]


def get_cs_cited_verses(cs_text: str, quran_ar_map: dict[tuple[int, int], str]) -> set[tuple[int, int]]:
    cited = set()
    for m in re.finditer(r"\((\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\)", cs_text):
        s, a1 = int(m.group(1)), int(m.group(2))
        if (s, a1) not in KHUTBAT_HAJAH_VERSES and (s, a1) in quran_ar_map:
            cited.add((s, a1))
    return cited


def count_shared_verses(
    ar_clean: str,
    cs_verses: set[tuple[int, int]],
    quran_ar_map: dict[tuple[int, int], str],
) -> int:
    hits = 0
    for s, a in cs_verses:
        v_ar = quran_ar_map[(s, a)]
        words = v_ar.split()
        if len(words) < 4:
            if v_ar in ar_clean:
                hits += 1
        else:
            for i in range(len(words) - 3):
                if " ".join(words[i : i + 4]) in ar_clean:
                    hits += 1
                    break
    return hits


def build_prague_archive(quran_ar_map: dict[tuple[int, int], str]):
    with RAW_PRAGUE_AR.open("r", encoding="utf-8") as f:
        ar_posts = json.load(f)
    with RAW_PRAGUE_CS.open("r", encoding="utf-8") as f:
        cs_posts = json.load(f)

    # 1. Index valid Czech sermons (require full sermon length >= 1800 chars)
    cs_by_date: dict[str, dict] = {}
    for p in cs_posts:
        title_cs = html.unescape(p["title"]["rendered"]).strip()
        text_cs = clean_wp_html(p["content"]["rendered"], fix_cs_quotes=True)
        if len(text_cs) < 1800:
            continue
        _, d_key = extract_date(title_cs, p["date"])
        cs_by_date[d_key] = {
            "date": d_key,
            "title_cs": title_cs,
            "url_cs": p["link"],
            "cs": text_cs,
            "verses": get_cs_cited_verses(text_cs, quran_ar_map),
        }

    # 2. Filter Arabic candidate sermons (require >= 1800 chars and skip admin notices)
    SKIP_AR_TITLES = ("تغيير موعد", "تنبية على", "زكاة الفطر", "أول ايام", "بداية شهر", "رمضان:")
    ar_candidates = []
    for p in ar_posts:
        title_ar = html.unescape(p["title"]["rendered"]).strip()
        text_ar = clean_wp_html(p["content"]["rendered"], fix_cs_quotes=False)
        if len(text_ar) < 1800 or any(bad in title_ar for bad in SKIP_AR_TITLES):
            continue

        has_explicit_date, d_ar = extract_date(title_ar, p["date"])
        is_khutbah_cat = 15 in p.get("categories", []) or "خطبة" in title_ar
        is_friday_pub = datetime.strptime(d_ar, "%Y-%m-%d").weekday() == 4
        ar_clean = normalize_arabic(text_ar)

        # Priority score ensures explicit-date and Friday khutbahs lock in before lagged posts
        priority = (
            2 if (has_explicit_date or is_khutbah_cat) else (1 if is_friday_pub else 0),
            len(text_ar),
        )
        ar_candidates.append((priority, has_explicit_date, d_ar, title_ar, text_ar, ar_clean, p))

    ar_candidates.sort(key=lambda x: x[0], reverse=True)

    paired = []
    used_cs_dates = set()

    print("\n--- PAIRING PRAGUE ARCHIVE (AR <-> CS) ---")
    for _, has_explicit_date, d_ar, title_ar, text_ar, ar_clean, p in ar_candidates:
        dt_ar = datetime.strptime(d_ar, "%Y-%m-%d")
        # If title has explicit date, allow 0 or -2d (for WP Sunday upload of Friday title);
        # otherwise check 0 first, then lagged upload window (-1 to -7 days).
        offsets = (0, -2) if has_explicit_date else (0, -1, 1, -2, -3, -4, -5, -7)

        matched_cs = None
        matched_info = ""
        for offset in offsets:
            cand_date = (dt_ar + timedelta(days=offset)).strftime("%Y-%m-%d")
            if cand_date not in cs_by_date or cand_date in used_cs_dates:
                continue

            cs_item = cs_by_date[cand_date]
            ratio = len(cs_item["cs"]) / len(text_ar)
            if not (0.65 <= ratio <= 2.15):
                continue

            shared_v = count_shared_verses(ar_clean, cs_item["verses"], quran_ar_map)
            total_v = len(cs_item["verses"])

            # Acceptance criteria:
            # - Exact date match (offset == 0) with valid length ratio and either no body verses
            #   or >=1 shared verse (prevents same-day mid-week essay collision)
            # - Off-date lagged upload (offset != 0): MUST be proven by scripture overlap
            #   (shared_v >= 2, or 1/1 verse overlap, or exact family khutbah match when 0 verses cited)
            is_valid_exact = (offset == 0) and (total_v == 0 or shared_v >= 1)
            is_valid_lagged = (offset != 0) and (
                shared_v >= 2
                or (shared_v == 1 and total_v == 1)
                or (total_v == 0 and "الأسرة" in title_ar and "Rodina" in cs_item["title_cs"])
            )

            if is_valid_exact or is_valid_lagged:
                matched_cs = cs_item
                matched_info = f"off={offset:+2d}d | verses={shared_v}/{total_v} | ratio={ratio:.2f}"
                used_cs_dates.add(cand_date)
                break

        if matched_cs:
            print(
                f"  🔗 [{matched_cs['date']}] ({matched_info}) "
                f"{matched_cs['title_cs'][:34]:<34} <--> {title_ar[:32]}"
            )
            paired.append(
                {
                    "date": matched_cs["date"],
                    "title_cs": matched_cs["title_cs"],
                    "title_ar": title_ar,
                    "url_cs": matched_cs["url_cs"],
                    "url_ar": p["link"],
                    "ar": text_ar,
                    "ar_clean": ar_clean,
                    "cs": matched_cs["cs"],
                }
            )

    paired.sort(key=lambda x: x["date"], reverse=True)
    with OUT_PRAGUE_JSON.open("w", encoding="utf-8") as f:
        json.dump(paired, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Wrote {len(paired)} verified 1-to-1 AR-CS Prague Khutbahs to {OUT_PRAGUE_JSON.name}")
    run_archive_qa_checks(paired)


def run_archive_qa_checks(paired: list[dict]):
    print("\n--- QA & ANOMALY CONTROL REPORT ---")
    by_year = Counter(p["date"][:4] for p in paired)
    print("  1. Paired sermons by year:", dict(sorted(by_year.items())))

    short_ar = [p["date"] for p in paired if len(p["ar"]) < 1800]
    short_cs = [p["date"] for p in paired if len(p["cs"]) < 1800]
    bad_ratio = [
        (p["date"], round(len(p["cs"]) / len(p["ar"]), 2))
        for p in paired
        if not (0.65 <= len(p["cs"]) / len(p["ar"]) <= 2.15)
    ]
    unbalanced_q = []
    for p in paired:
        o, c = p["cs"].count("„"), p["cs"].count("“")
        if o != c:
            unbalanced_q.append((p["date"], o, c, p["title_cs"][:40]))

    print(f"  2. Short text violations (<1800 chars): AR={len(short_ar)}, CS={len(short_cs)}")
    print(f"  3. Length ratio violations: {len(bad_ratio)}")
    print(f"  4. Remaining sermons with unbalanced Czech quotes („ != “): {len(unbalanced_q)} / {len(paired)}")
    for d, o, c, t in unbalanced_q:
        print(f"     ⚠️ [{d}] „={o}, “={c} | {t}")


if __name__ == "__main__":
    quran_ar_map = build_quran_dataset()
    build_hadith_dataset()
    build_prague_archive(quran_ar_map)