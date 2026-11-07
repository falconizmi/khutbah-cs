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
- **`prague_archive.json`** — 57 verified 1-to-1 parallel Arabic–Czech Friday sermons (2022–2026) paired by Friday date from `prague_khutbahs_ar.json` and `prague_khutbahs_cs.json`.
- **`glossary.json`** — Mosque-specific Czech Islamic terminology, standard opening/closing liturgical formulas, and regex patterns for stripping congregation-baiting greetings.
