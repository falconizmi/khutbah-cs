# 🕌 khutbah-cs

Automated Arabic-to-Czech Friday sermon (Khutbah) translation and rhetorical polishing pipeline, built for the Teplice mosque and wider Czech Muslim community.

Designed for pre-written Arabic sermons read aloud as a Czech insert during the Friday prayer pause — enforcing canonical scriptural translations, natural Czech spoken cadence, and ritual silence rules (stripping congregation-baiting greetings).

**100% static web app** — zero backend required. Deploy to GitHub Pages in one click or run locally with `python3 -m http.server`.

---

## 📂 Project Structure

- `data/raw/` — Original, unmodified downloads (`cs.hrbek.txt`, `quran-simple-clean.txt`, `HadeethEnc.com_cs-v1.9.0.csv`, `prague_khutbahs_*.json`). See [`data/README.md`](data/README.md) for exact download URLs, dates, and settings.

- `data/processed/` — Normalized JSON datasets (`quran_cs.json`, `hadith_cs.json`, `prague_archive.json`).

- `data/interim/` — Checkpointed 70-sermon empirical translation style investigation (`ai_discovery_report.md` and `discovery_batches/`).

- `prompts/` — Empirically synthesized Czech Khutbah translation System Prompts (`translation_prompt.md` production pipeline prompt, `condense_prompt.md` for shortened spoken-pulpit inserts across all 3 length tiers).

- `src/` — Raw WordPress fetcher (`fetch_prague_raw.py`), dataset builder & QA verifier (`build_datasets.py`), Free-Tier streaming Gemini client with BYOK support (`gemini_client.py`), fuzzy scripture/few-shot matcher (`match_context.py`), translator/post-processor (`translate.py`).

- `web/` — **Static web application** (zero backend):
  - `index.html` — Complete UI shell with trilingual controls (CS / AR / EN)
  - `styles.css` — Mosque aesthetic palette, print stylesheet for A4 pulpit sheets
  - `i18n.js` — Trilingual dictionary (Czech, Arabic, English) with RTL support
  - `matcher.js` — Client-side port of `match_context.py` + `postprocess_and_verify()` (Quran/Hadith matching, Hijri dates, Hrbek adapter, Levenshtein ratio)
  - `gemini.js` — Browser SSE streaming to Gemini API with automatic model fallback
  - `app.js` — UI state management, generation pipeline, tabs, localStorage BYOK key handling, print trigger

- `.github/workflows/deploy-pages.yml` — GitHub Actions workflow for one-click Pages deployment (assembles `_site/` from `web/*`, `data/processed/*.json`, and `prompts/*.md`).

---

## 🚀 Quick Start — CLI

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

   # Generate all 3 length tiers: full + condensed (~4 min) + brief (~2 min)
   python3 src/translate.py path/to/khutbah_ar.txt -o outputs/khutbah_cs.md --lengths all

   # Generate only the condensed version alongside full
   python3 src/translate.py path/to/khutbah_ar.txt -o outputs/khutbah_cs.md --lengths condensed

   # Legacy alias: --with-short generates the condensed tier too
   python3 src/translate.py path/to/khutbah_ar.txt -o outputs/khutbah_cs.md --with-short

   # Inspect offline Quran/Hadith & archive matches only (0 API calls)
   python3 src/match_context.py path/to/khutbah_ar.txt

   # Test end-to-end on sermon #0 from prague_archive.json (self-match excluded from few-shot)
   python3 src/translate.py --test-archive 0
   ```

### Length Tiers

| Tier | Target | Speaking Time | Output File Suffix |
|------|--------|---------------|-------------------|
| `full` | ~900–1,250 words | ~8–10 min | `_cs.md` (default) |
| `condensed` | ~450–600 words | ~4–5 min (1 A4 page) | `_cs_condensed.md` |
| `brief` | ~250–350 words | ~2–3 min | `_cs_brief.md` |

All tiers run through the same `postprocess_and_verify()` QA pipeline (Hrbek verse verification, script leak guard, balanced quotes check).

---

## 🌐 Static Web App — Local Preview

No build step required. Serve the repo root and open in your browser:

```bash
cd /path/to/khutbah-cs
python3 -m http.server 8000
# → Open http://localhost:8000/web/index.html
```

The web app automatically loads datasets from `../data/processed/*.json` and prompts from `../prompts/*.md` when served this way.

---

## 🚀 Deploy to GitHub Pages (1 Click)

1. Push your repo to GitHub.
2. In the repository: **Settings → Pages → Source** → select **GitHub Actions**.
3. The `.github/workflows/deploy-pages.yml` workflow will assemble `_site/` on every push to `main`:
   - Copies `web/*` (HTML, CSS, JS)
   - Copies `data/processed/*.json` → `_site/assets/data/`
   - Copies `prompts/*.md` → `_site/assets/prompts/`
   - Creates `.nojekyll` and deploys via official `actions/deploy-pages@v4`

Your site will be live at `https://<your-username>.github.io/<repo-name>/`.

---

## 🙏 Credits & Upstream Acknowledgments

- **[MinbarAI](https://github.com/Yacine-DH/MinbarAI)** by **Yacine Dhouafli (@Yacine-DH)** — Upstream inspiration and core logic for the diacritic-stripped fuzzy Quran verse matcher and terminology/leak-guard post-processing (`match_context.py`, `translate.py`).

- **[Tanzil.net](https://tanzil.net/trans/)** — Source of the Simple Clean Arabic Quran (`quran-simple-clean.txt`) and the canonical Czech Quran translation by **Ivan Hrbek** (`cs.hrbek.txt`).

- **[HadeethEnc.com](https://hadeethenc.com/cs/)** — Source of verified Czech Hadith translations via the official HadeethEnc CSV export (`v1.9.0`).

- **Islámská nadace v Praze (`islam.cz` & `mosque.islam.cz`)** — Historical parallel Arabic–Czech Khutbah texts (2021–2026 paired, 2017–2026 Czech archive) used for empirical style discovery and few-shot stylistic alignment.
