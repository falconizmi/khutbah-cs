# 🕌 khutbah-cs

Automated Arabic-to-Czech Friday sermon (Khutbah) translation and rhetorical polishing pipeline, built for the Teplice mosque and wider Czech Muslim community.

Designed for pre-written Arabic sermons read aloud as a Czech insert during the Friday prayer pause — enforcing canonical scriptural translations, natural Czech spoken cadence, and ritual silence rules (stripping congregation-baiting greetings).

## 📂 Project Structure

- `data/raw/` — Original, unmodified downloads (`cs.hrbek.txt`, `quran-simple-clean.txt`, `HadeethEnc.com_cs-v1.9.0.csv`, `prague_khutbahs_*.json`). See [`data/README.md`](data/README.md) for exact download URLs, dates, and settings.

- `data/processed/` — Normalized JSON datasets (`quran_cs.json`, `hadith_cs.json`, `prague_archive.json`).

- `data/interim/` — Checkpointed 70-sermon empirical translation style investigation (`ai_discovery_report.md` and `discovery_batches/`).

- `prompts/` — Empirically synthesized Czech Khutbah translation System Prompts (`system_prompt.md` raw discovery output, `translation_prompt.md` production pipeline prompt).

- `src/` — Raw WordPress fetcher (`fetch_prague_raw.py`), dataset builder & QA verifier (`build_datasets.py`), Free-Tier streaming Gemini client (`gemini_client.py`), 70-sermon style discovery (`discover_strategy.py`), fuzzy scripture/few-shot matcher (`match_context.py`), and translator/post-processor (`translate.py`).

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Set your Google AI Studio Free-Tier API key** (in environment or local `.env`):
   ```bash
   export GEMINI_API_KEY="your_api_key_here"
   ```

3. **Translate an Arabic Friday sermon into Czech:**
   ```bash
   # Translate a pre-written Arabic sermon file (auto-detects date or override with --date YYYY-MM-DD)
   python3 src/translate.py path/to/khutbah_ar.txt -o outputs/khutbah_cs.md --date 2026-11-27

   # Inspect offline Quran/Hadith & archive matches only (0 API calls)
   python3 src/match_context.py path/to/khutbah_ar.txt

   # Test end-to-end on sermon #0 from prague_archive.json (self-match excluded from few-shot)
   python3 src/translate.py --test-archive 0
   ```

## 🙏 Credits & Upstream Acknowledgments

- **[MinbarAI](https://github.com/Yacine-DH/MinbarAI)** by **Yacine Dhouafli (@Yacine-DH)** — Upstream inspiration and core logic for the diacritic-stripped fuzzy Quran verse matcher and terminology/leak-guard post-processing (`match_context.py`, `translate.py`).

- **[Tanzil.net](https://tanzil.net/trans/)** — Source of the Simple Clean Arabic Quran (`quran-simple-clean.txt`) and the canonical Czech Quran translation by **Ivan Hrbek** (`cs.hrbek.txt`).

- **[HadeethEnc.com](https://hadeethenc.com/cs/)** — Source of verified Czech Hadith translations via the official HadeethEnc CSV export (`v1.9.0`).

- **Islámská nadace v Praze (`islam.cz` & `mosque.islam.cz`)** — Historical parallel Arabic–Czech Khutbah texts (2021–2026 paired, 2017–2026 Czech archive) used for empirical style discovery and few-shot stylistic alignment.
