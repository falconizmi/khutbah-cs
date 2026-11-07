import csv
import json
import re
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "data" / "raw"
OUT_DIR = BASE_DIR / "data" / "processed"

AR_CLEAN_FILE = RAW_DIR / "quran-simple-clean.txt"
CS_HRBEK_FILE = RAW_DIR / "cs.hrbek.txt"
OUT_QURAN_JSON = OUT_DIR / "quran_cs.json"

OUT_HADITH_JSON = OUT_DIR / "hadith_cs.json"

TASHKEEL_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
WHITESPACE_RE = re.compile(r"\s+")
BISMILLAH_PREFIX = "بسم الله الرحمن الرحيم "


def normalize_arabic(text: str) -> str:
    """Normalizes Arabic text for rapidfuzz matching."""
    text = TASHKEEL_RE.sub("", text)
    text = re.sub(r"[أإآٱ]", "ا", text)
    text = text.replace("ى", "ي").replace("ة", "ه")
    text = re.sub(r"[^\w\s]", " ", text)
    return WHITESPACE_RE.sub(" ", text).strip()


def load_tanzil_file(filepath: Path) -> dict[tuple[int, int], str]:
    if not filepath.exists():
        raise FileNotFoundError(f"Missing raw file: {filepath}")

    verses = {}
    with filepath.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|", maxsplit=2)
            if len(parts) == 3:
                sura, aya, text = int(parts[0]), int(parts[1]), parts[2].strip()
                verses[(sura, aya)] = text
    return verses


def build_quran_dataset():
    ar_verses = load_tanzil_file(AR_CLEAN_FILE)
    cs_verses = load_tanzil_file(CS_HRBEK_FILE)

    merged_data = []
    for (sura, aya), ar_text in sorted(ar_verses.items()):
        cs_text = cs_verses.get((sura, aya))
        if not cs_text:
            raise ValueError(f"Missing Czech translation for Sura {sura}, Aya {aya}")

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

    print(f"✅ Successfully wrote {len(merged_data)} verses to {OUT_QURAN_JSON}")


def find_hadith_csv() -> Path:
    """Automatically finds HadeethEnc.com_cs-*.csv in data/raw/."""
    matches = sorted(RAW_DIR.glob("HadeethEnc.com_cs*.csv"))
    if not matches:
        raise FileNotFoundError(
            f"No HadeethEnc.com_cs*.csv found in {RAW_DIR}. "
            "Move ~/Downloads/HadeethEnc.com_cs-v1.9.0.csv into data/raw/"
        )
    return matches[-1]


def build_hadith_dataset():
    csv_path = find_hadith_csv()
    print(f"Loading Hadiths from: {csv_path.name}")

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        lines = f.readlines()

    # Locate the actual CSV header row ('id,title_ar,title,...') past the '#' banner
    header_idx = 0
    for idx, line in enumerate(lines):
        if line.startswith("id,title_ar,title"):
            header_idx = idx
            break

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

        ref_parts = [f"Hadís #{h_id}"]
        if takhrij_cs:
            ref_parts.append(takhrij_cs)
        if grade_cs:
            ref_parts.append(grade_cs)

        hadiths.append(
            {
                "id": int(h_id) if h_id.isdigit() else h_id,
                "ref": " – ".join(ref_parts),
                "title_ar": title_ar,
                "title_ar_clean": normalize_arabic(title_ar),  # Short core quote!
                "title_cs": title_cs,
                "ar": ar_full,
                "ar_clean": normalize_arabic(ar_full),         # Full narrated text
                "cs": cs_full,
            }
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUT_HADITH_JSON.open("w", encoding="utf-8") as f:
        json.dump(hadiths, f, ensure_ascii=False, indent=2)

    print(f"✅ Successfully wrote {len(hadiths)} Hadiths to {OUT_HADITH_JSON}")


if __name__ == "__main__":
    build_quran_dataset()
    build_hadith_dataset()
