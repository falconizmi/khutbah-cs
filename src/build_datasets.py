import csv
import html
import json
import re
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


def build_quran_dataset():
    ar_verses = load_tanzil_file(AR_CLEAN_FILE)
    cs_verses = load_tanzil_file(CS_HRBEK_FILE)

    merged_data = []
    for (sura, aya), ar_text in sorted(ar_verses.items()):
        cs_text = cs_verses[(sura, aya)]
        ar_for_matching = ar_text
        if sura not in (1, 9) and aya == 1 and ar_for_matching.startswith(BISMILLAH_PREFIX):
            ar_for_matching = ar_for_matching[len(BISMILLAH_PREFIX):]

        merged_data.append(
            {
                "sura": sura,
                "aya": aya,
                "ref": f"Korán {sura}:{aya}",
                "ar": ar_for_matching,
                "ar_clean": normalize_arabic(ar_for_matching),
                "cs": cs_text,
            }
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUT_QURAN_JSON.open("w", encoding="utf-8") as f:
        json.dump(merged_data, f, ensure_ascii=False, indent=2)
    print(f"✅ Wrote {len(merged_data)} verses to {OUT_QURAN_JSON.name}")


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


def clean_wp_html(raw_html: str) -> str:
    text = re.sub(r"</(p|div|h[1-6]|li|br\s*/?)>", "\n", raw_html, flags=re.IGNORECASE)
    text = HTML_TAG_RE.sub("", text)
    text = html.unescape(text).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    text = "\n\n".join(line for line in lines if line)
    return MULTI_NEWLINE_RE.sub("\n\n", text).strip()


def extract_date(title: str, wp_date_str: str) -> str:
    m_ar = re.search(r"(20\d{2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(\d{1,2})", title)
    if m_ar:
        return f"{int(m_ar.group(1)):04d}-{int(m_ar.group(2)):02d}-{int(m_ar.group(3)):02d}"
    m_cs = re.search(r"(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})", title)
    if m_cs:
        return f"{int(m_cs.group(3)):04d}-{int(m_cs.group(2)):02d}-{int(m_cs.group(1)):02d}"
    return wp_date_str[:10]


def shift_date(date_str: str, days: int) -> str:
    dt = datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=days)
    return dt.strftime("%Y-%m-%d")


def build_prague_archive():
    with RAW_PRAGUE_AR.open("r", encoding="utf-8") as f:
        ar_posts = json.load(f)
    with RAW_PRAGUE_CS.open("r", encoding="utf-8") as f:
        cs_posts = json.load(f)

    cs_by_date: dict[str, dict] = {}
    for p in cs_posts:
        title_cs = html.unescape(p["title"]["rendered"]).strip()
        text_cs = clean_wp_html(p["content"]["rendered"])
        if len(text_cs) < 600:
            continue
        d_key = extract_date(title_cs, p["date"])
        cs_by_date[d_key] = {
            "date": d_key,
            "title_cs": title_cs,
            "url_cs": p["link"],
            "cs": text_cs,
        }

    # Filter Arabic posts: skip announcements ("تغيير موعد", "زكاة الفطر", "أول ايام")
    # and require actual sermon length (>= 600 chars)
    SKIP_AR_TITLES = ("تغيير موعد", "تنبية على", "زكاة الفطر", "أول ايام", "بداية شهر")
    valid_ar_posts = []
    for p in ar_posts:
        title_ar = html.unescape(p["title"]["rendered"]).strip()
        text_ar = clean_wp_html(p["content"]["rendered"])
        if len(text_ar) < 600 or any(bad in title_ar for bad in SKIP_AR_TITLES):
            continue
        has_explicit_date = bool(re.search(r"20\d{2}\s*[/\-]\s*\d{1,2}", title_ar))
        is_khutbah_cat = 15 in p.get("categories", []) or "خطبة" in title_ar
        if has_explicit_date or is_khutbah_cat:
            valid_ar_posts.append((has_explicit_date, title_ar, text_ar, p))

    # Sort so posts with an explicit (YYYY/M/D) in the title get priority first!
    valid_ar_posts.sort(key=lambda x: x[0], reverse=True)

    paired = []
    used_cs_dates = set()

    print("\n--- PAIRING PRAGUE ARCHIVE (AR <-> CS) ---")
    for has_explicit_date, title_ar, text_ar, p in valid_ar_posts:
        d_key = extract_date(title_ar, p["date"])

        # Only allow +/- 1 day shift if the Arabic title didn't have an explicit date
        offsets = (0,) if has_explicit_date else (0, -1, 1, -2, 2)
        matched_cs = None
        for offset in offsets:
            cand = shift_date(d_key, offset)
            if cand in cs_by_date and cand not in used_cs_dates:
                matched_cs = cs_by_date[cand]
                used_cs_dates.add(cand)
                break

        if matched_cs:
            print(f"  🔗 [{matched_cs['date']}] {matched_cs['title_cs'][:40]:<40} <--> {title_ar[:35]}")
            paired.append(
                {
                    "date": matched_cs["date"],
                    "title_cs": matched_cs["title_cs"],
                    "title_ar": title_ar,
                    "url_cs": matched_cs["url_cs"],
                    "url_ar": p["link"],
                    "ar": text_ar,
                    "ar_clean": normalize_arabic(text_ar),
                    "cs": matched_cs["cs"],
                }
            )

    paired.sort(key=lambda x: x["date"], reverse=True)
    with OUT_PRAGUE_JSON.open("w", encoding="utf-8") as f:
        json.dump(paired, f, ensure_ascii=False, indent=2)

    print(f"✅ Wrote {len(paired)} verified 1-to-1 AR-CS Prague Khutbahs to {OUT_PRAGUE_JSON.name}")

if __name__ == "__main__":
    build_quran_dataset()
    build_hadith_dataset()
    build_prague_archive()
