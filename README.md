# 🕌 khutbah-cs

Automated Arabic-to-Czech Friday sermon (Khutbah) translation and rhetorical polishing pipeline, built for the Teplice mosque and wider Czech Muslim community.

Designed for pre-written Arabic sermons read aloud as a Czech insert during the Friday prayer pause — enforcing canonical scriptural translations, natural Czech spoken cadence, and ritual silence rules (stripping congregation-baiting greetings).

**100% static web app** — zero backend required. Built with Astro, deployed to GitHub Pages automatically via Actions workflow.

---

## 📂 Project Structure

- `data/raw/` — Original, unmodified downloads (`cs.hrbek.txt`, `quran-simple-clean.txt`, `HadeethEnc.com_cs-v1.9.0.csv`, `prague_khutbahs_*.json`). See [`data/README.md`](data/README.md) for exact download URLs, dates, and settings.

- `data/processed/` — Normalized JSON datasets (`quran_cs.json`, `hadith_cs.json`, `prague_archive.json`).

- `data/interim/` — Checkpointed 70-sermon empirical translation style investigation (`ai_discovery_report.md` and `discovery_batches/`).

- `prompts/` — Empirically synthesized Czech Khutbah translation System Prompts (`translation_prompt.md` production pipeline prompt, `condense_prompt.md` for shortened spoken-pulpit inserts across all 3 length tiers).

- `src/` — Astro layouts, pages, and components. Raw WordPress fetcher (`fetch_prague_raw.py`), dataset builder & QA verifier (`build_datasets.py`), Free-Tier streaming Gemini client with BYOK support (`gemini_client.py`), fuzzy scripture/few-shot matcher (`match_context.py`), translator/post-processor (`translate.py`).

- `public/` — **Static web application assets** (served as-is by Astro):
  - `client/i18n.js` — Trilingual dictionary (Czech, Arabic, English) with RTL support
  - `client/matcher.js` — Client-side port of `match_context.py` + `postprocess_and_verify()` (Quran/Hadith matching, Hijri dates, Hrbek adapter, Levenshtein ratio)
  - `client/gemini.js` — Browser SSE streaming to Gemini API with automatic model fallback and real-time fallback notifications
  - `client/app.js` — UI state management, generation pipeline, tabs, localStorage BYOK key handling, print trigger
  - `client/bootstrap.js` — Script loader that injects classic dependencies before the main app module
  - `styles/styles.css` — Mosque aesthetic palette, print stylesheet for A4 pulpit sheets
  - `assets/data/` — Quran, Hadith, and Prague archive JSON datasets (copied from `data/processed/`)
  - `assets/prompts/` — Translation and condense prompts (copied from `prompts/`)

- `.github/workflows/deploy-pages.yml` — GitHub Actions workflow: runs `npm ci`, `astro build`, deploys the `dist/` output to Pages.

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

## 🌐 Static Web App — Local Development

```bash
cd /path/to/khutbah-cs

# Install Node.js dependencies (one-time)
npm install

# Dev server with hot-reload
npm run dev -- --host 0.0.0.0   # → http://localhost:4321

# Production build + preview
npm run build                  # builds to dist/
npm run preview -- --host 0.0.0.0   # serves dist/ at http://localhost:4321
```

---

## 🚀 Deploy to GitHub Pages (Automatic)

Push to `main` — the Actions workflow runs `astro build` and deploys automatically.

Setup once: **Settings → Pages → Source** → select **GitHub Actions**.

Your site will be live at `https://<your-username>.github.io/<repo-name>/`.

---

## 🔒 Security & Privacy

- **Zero backend**: no server-side code, no cookies, no tracking
- **BYOK API key**: stored in `localStorage` only when you check "Save key on this device" — never leaves your browser
- **CSP enforced**: `script-src 'self'`, `connect-src` limited to Gemini API only
- **No inline scripts**: all JS loaded via module entry point (`bootstrap.js`)
- **DOM-safe rendering**: no `innerHTML` with dynamic data; all content via `textContent`

---

## 🤖 Model Fallback System

The app tries your preferred model first. If it's busy or quota-exhausted (common on free tier), it automatically falls back through weaker models:

```
gemini-4-hydrogen → gemini-3.8-flash → gemini-3.6-flash → gemini-3.5-flash-lite → gemini-3.1-flash-lite
```

A visible notification appears when a fallback occurs, and the final model used is shown after translation completes. Translation quality remains good even on weaker models for this task.

---

## 🙏 Credits & Upstream Acknowledgments

- **[MinbarAI](https://github.com/Yacine-DH/MinbarAI)** by **Yacine Dhouafli (@Yacine-DH)** — Upstream inspiration and core logic for the diacritic-stripped fuzzy Quran verse matcher and terminology/leak-guard post-processing (`match_context.py`, `translate.py`).

- **[Tanzil.net](https://tanzil.net/trans/)** — Source of the Simple Clean Arabic Quran (`quran-simple-clean.txt`) and the canonical Czech Quran translation by **Ivan Hrbek** (`cs.hrbek.txt`).

- **[HadeethEnc.com](https://hadeethenc.com/cs/)** — Source of verified Czech Hadith translations via the official HadeethEnc CSV export (`v1.9.0`).

- **Islámská nadace v Praze (`islam.cz` & `mosque.islam.cz`)** — Historical parallel Arabic–Czech Khutbah texts (2021–2026 paired, 2017–2026 Czech archive) used for empirical style discovery and few-shot stylistic alignment.
