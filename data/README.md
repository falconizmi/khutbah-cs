# 📊 Data Sources & Provenance (`khutbah-cs`)

This folder separates untouched source downloads (`data/raw/`) from the normalized JSON datasets consumed by the pipeline (`data/processed/`).

## 1. Raw Source Files (`data/raw/`)

| Filename | Source / Author | Download URL | Settings / Format Used | Date Downloaded |
| :--- | :--- | :--- | :--- | :--- |
| `cs.hrbek.txt` | Tanzil.net (Trans: Ivan Hrbek) | `https://tanzil.net/trans/cs.hrbek` | Text (with aya numbers) — `sura\|aya\|text` | 2026-11-07 |
| `quran-simple-clean.txt` | Tanzil.net | `https://tanzil.net/download/` | Quran Text: **Simple Clean**, Format: **Text (with aya numbers)**, Pause marks: **Off** | 2026-11-07 |
| `HadeethEnc.com_cs-v1.9.0.csv` | HadeethEnc.com | `https://hadeethenc.com/cs/home` | Official CSV Export (`v1.9.0`, last update `2026-05-10`) | 2026-11-07 |

> **Note on Tanzil headers:** Both `cs.hrbek.txt` and `quran-simple-clean.txt` contain a `#` comment block at the bottom/top of the file with Tanzil's copyright notice and generation timestamp. Leave those intact in `data/raw/` for verification; `src/build_datasets.py` automatically skips lines starting with `#`.

---

## 2. Processed & Normalized Files (`data/processed/`)

Generated deterministically by running `python src/build_datasets.py`:

* **`quran_cs.json`** — Merges `quran-simple-clean.txt` and `cs.hrbek.txt` by `sura|aya`. Adds an `ar_clean` field with stripped harakat/tashkeel, removed tatweel (`ـ`), unified alef variants (`أ إ آ ٱ` -> `ا`), and normalized yaa/taa marbuta for `rapidfuzz` bigram matching.
* **`hadith_cs.json`** — Extracted from `hadeethenc_cs_raw.json` with the same `ar_clean` Arabic normalization applied to the Hadith text.
* **`prague_archive.json`** — Selected parallel Arabic–Czech Friday sermons (Khutbahs) from the Prague Mosque (Islámská nadace v Praze, 2017–2026).
* **`glossary.json`** — Enforced Czech Islamic terminology, standard opening/closing liturgical formulas, and regex patterns for stripping congregation-baiting greetings (`As-salámu alajkum`, `Mír s vámi`).
