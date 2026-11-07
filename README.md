# 🕌 khutbah-cs

Automated Arabic-to-Czech Friday sermon (Khutbah) translation and rhetorical polishing pipeline, built for the Teplice mosque and wider Czech Muslim community.

Designed for pre-written Arabic sermons read aloud as a Czech insert during the Friday prayer pause — enforcing canonical scriptural translations, natural Czech spoken cadence, and ritual silence rules (stripping congregation-baiting greetings).

## 📂 Project Structure

- `data/raw/` — Original, unmodified downloads (`cs.hrbek.txt`, `quran-simple-clean.txt`, `HadeethEnc.com_cs-v1.9.0.csv`, `prague_khutbahs_*.json`). See [`data/README.md`](data/README.md) for exact download URLs, dates, and settings.
- `data/processed/` — Normalized JSON datasets (`quran_cs.json`, `hadith_cs.json`, `prague_archive.json`, `glossary.json`).
- `src/` — Raw WordPress fetcher, dataset builder, fuzzy verse/hadith injector, Mini-RAG retriever, two-pass LLM translator, and post-processor.

## 🙏 Credits & Upstream Acknowledgments

- **[MinbarAI](https://github.com/Yacine-DH/MinbarAI)** by **Yacine Dhouafli (@Yacine-DH)** — Upstream inspiration and core logic for the diacritic-stripped fuzzy Quran verse matcher (`quran_match.py`) and terminology/leak-guard post-processing (`postprocess.py`).
- **[Tanzil.net](https://tanzil.net/trans/)** — Source of the Simple Clean Arabic Quran (`quran-simple-clean.txt`) and the canonical Czech Quran translation by **Ivan Hrbek** (`cs.hrbek.txt`).
- **[HadeethEnc.com](https://hadeethenc.com/cs/)** — Source of verified Czech Hadith translations via the official HadeethEnc CSV export (`v1.9.0`).
- **Islámská nadace v Praze (`islam.cz` & `mosque.islam.cz`)** — Historical parallel Arabic–Czech Khutbah texts (2022–2026 paired, 2014–2026 Czech archive) used for few-shot stylistic alignment.
