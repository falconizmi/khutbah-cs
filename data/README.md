# 📊 Data Sources & Provenance (`khutbah-cs`)

This folder separates untouched source downloads (`data/raw/`) from the normalized JSON datasets consumed by the pipeline (`data/processed/`).

## 1. Raw Source Files (`data/raw/`)

| Filename | Source / Author | Download URL / Endpoint | Settings / Format Used | Date Downloaded |
| :--- | :--- | :--- | :--- | :--- |
| `cs.hrbek.txt` | Tanzil.net (Trans: Ivan Hrbek) | `https://tanzil.net/trans/cs.hrbek` | Text (with aya numbers) — `sura\|aya\|text` | 2026-11-07 |
| `quran-simple-clean.txt` | Tanzil.net | `https://tanzil.net/download/` | Quran Text: **Simple (Clean)**, Format: **Text (with aya numbers)**, All checkboxes: **Off** | 2026-11-07 |
| `HadeethEnc.com_cs-v1.9.0.csv` | HadeethEnc.com | `https://hadeethenc.com/cs/home` | Official CSV Export (`v1.9.0`, last update `2026-05-10`) | 2026-11-07 |
| `prague_khutbahs_ar.json` | الوقف الإسلامي في براغ | `https://mosque.islam.cz/wp-json/wp/v2/posts` | WordPress REST API dump (`src/fetch_prague_raw.py`, 157 posts) | 2026-11-07 |
| `prague_khutbahs_cs.json` | IslámDnes (`islam.cz`) | `https://islam.cz/wp-json/wp/v2/posts` | WordPress REST API dump (`category=patecni-kazani`, 647 posts) | 2026-11-07 |

> **Note on Tanzil headers:** Both `cs.hrbek.txt` and `quran-simple-clean.txt` contain a `#` comment block with Tanzil's copyright notice and generation timestamp. Leave those intact in `data/raw/` for verification; `src/build_datasets.py` automatically skips lines starting with `#`.

---

## 2. Processed & Normalized Files (`data/processed/`)

Generated deterministically offline by running `python3 src/build_datasets.py`:

- **`quran_cs.json`** — Merges `quran-simple-clean.txt` and `cs.hrbek.txt` by `sura|aya` (6,236 verses). Strips glued Bismillah from Aya 1 (except Suras 1 and 9) and adds an `ar_clean` field with stripped tashkeel/tatweel, unified alef variants (`أ إ آ ٱ` -> `ا`), and normalized yaa/taa marbuta for `rapidfuzz` matching.

- **`hadith_cs.json`** — Extracted from `HadeethEnc.com_cs-v1.9.0.csv` (478 Hadiths) with both normalized full text (`ar_clean`) and short core Prophetic quote (`title_ar_clean`).

- **`prague_archive.json`** — 70 verified 1-to-1 parallel Arabic–Czech Friday sermons (`2021`: 15, `2022`: 9, `2023`: 3, `2026`: 43) paired from `prague_khutbahs_ar.json` and `prague_khutbahs_cs.json`:
  - Enforces full-sermon length (`>= 1,800` chars in both languages) and a `CS/AR` length ratio (`0.65–2.15`) to exclude short Eid prayer-time announcements and mid-week essays.
  - Prioritizes explicit Friday dates and verifies lagged WordPress uploads (`-1` to `-7` days) via shared body Quran citations (`(Sura:Aya)` in Czech verified against normalized Arabic verse slices in `quran_cs.json`).
  - Auto-closes a recurring unclosed Czech quotation mark (`„...“`) in the Prague Mosque's *Khutbat al-Hajah* opening template across 50 sermons.
  - **Built-in QA & Canonical Hrbek Verification (`run_archive_qa_checks()`):** Audits all 275 cited body Quran verses across the 70 sermons against `cs.hrbek.txt` (100% derived from Hrbek: 82.9% character-for-character verbatim after accounting for the mosque's systematic `Bůh/Boží -> Alláh/Alláhův` grammatical case substitution, 16.0% with 1–2 word adjustments such as OCR typo fixes or `Abraham -> Ibráhím`, and 0% below 80% similarity).

- **`glossary.json`** — Mosque-specific Czech Islamic terminology, standard opening/closing liturgical formulas, and regex patterns for stripping congregation-baiting greetings.
