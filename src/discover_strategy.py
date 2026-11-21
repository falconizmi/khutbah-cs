import argparse
import json
import re
import time
from pathlib import Path

from gemini_client import generate_stream

BASE_DIR = Path(__file__).resolve().parent.parent
ARCHIVE_PATH = BASE_DIR / "data" / "processed" / "prague_archive.json"
BATCH_DIR = BASE_DIR / "data" / "interim" / "discovery_batches"
OUT_REPORT = BASE_DIR / "data" / "interim" / "ai_discovery_report.md"
OUT_PROMPT = BASE_DIR / "prompts" / "system_prompt.md"

BATCH_INVESTIGATION_PROMPT = """You are an objective linguistic investigator analyzing parallel Arabic–Czech Friday sermons (Khutbahs) from the Prague Mosque.

Examine all sermon pairs in this batch without any preconceived assumptions. Document only what you can prove directly from the texts:

1. STRUCTURE & FRAMING: How do the openings, transitions between parts (e.g. first vs. second khutbah), titles/dates, greetings, and closing supplications (du'a) compare between the Arabic and Czech texts?
2. SCRIPTURE & CITATIONS: How are Quranic verses (full and partial) and Prophetic Hadiths rendered, punctuated, introduced, and cited? Note any differences in divine names, proper names, or grading notes.
3. AUDIENCE, TONE & RHETORICAL EDITING: Does the Czech text translate every sentence literally, or does it condense, expand, re-paragraph, or adapt audience forms (gender, singular/plural, direct address)? Does this vary across sermons in this batch?
4. TERMINOLOGY & CULTURAL ADAPTATION: Which Arabic/Islamic terms are kept in transliteration vs. translated into native Czech vs. glossed inline? How consistent or context-dependent are these choices?
5. SURPRISES, EDGE CASES & HUMAN QUIRKS: Any unexpected omissions, additions, inconsistencies, or human errors that an automated translator should EITHER replicate (because they are intentional style) OR avoid (because they are human mistakes).

Support every observation with exact short quotes and sermon dates `[YYYY-MM-DD]`."""

SYNTHESIS_PROMPT = """You are synthesizing 7 independent empirical batch investigations covering all 70 parallel Arabic–Czech Friday sermons (2021–2026) from the Prague Mosque.

Read all 7 batch reports carefully and produce TWO sections separated by the exact marker `=== MASTER_SYSTEM_PROMPT ===`:

PART 1 (Before the marker): A comprehensive, objective Markdown research report (`ai_discovery_report.md`) summarizing:
- Universal patterns that hold across all years (2021–2026) vs. patterns that vary by year/sermon (e.g. faithful length vs. rhetorical condensing).
- Exact recurring liturgical formulas (openings, transitions, second khutbah, closing du'as, honorifics, citations) verified across multiple batches.
- Vocabulary & adaptation philosophy (transliteration boundaries, context-dependent Czech phrasing, gender inclusivity).
- Human errors/quirks spotted in the archive that an AI translator MUST NOT copy.

=== MASTER_SYSTEM_PROMPT ===

PART 2 (After the marker): Write a production-ready Czech Khutbah Translation System Prompt (`system_prompt.md`) designed to instruct an LLM translating a new Arabic Friday sermon into Czech for spoken delivery in a Czech mosque.
- Base every instruction strictly on the verified patterns discovered across the 70 sermons (do NOT invent rules not supported by the corpus, and do NOT copy human mistakes).
- Include exact verified Czech liturgical templates (opening, honorifics, transitions, closing du'a), audience/tone adaptation rules, scripture/citation formatting rules, spoken Czech style guidance, and illustrative Arabic->Czech phrase examples in context.
- Double-check that all Czech text in the prompt contains zero stray Arabic script characters."""


def main():
    parser = argparse.ArgumentParser(description="Checkpointed 70-sermon AI style discovery")
    parser.add_argument("--batch-size", type=int, default=10, help="Sermons per API call (default: 10)")
    parser.add_argument("--model", type=str, default="gemini-3.6-flash", help="Preferred Gemini model")
    parser.add_argument("--cooldown", type=int, default=22, help="Seconds to wait between batches for Free-Tier RPM/TPM")
    parser.add_argument("--force", action="store_true", help="Re-run batches even if checkpoint files exist")
    args = parser.parse_args()

    with ARCHIVE_PATH.open("r", encoding="utf-8") as f:
        sermons = json.load(f)

    BATCH_DIR.mkdir(parents=True, exist_ok=True)
    batches = [sermons[i : i + args.batch_size] for i in range(0, len(sermons), args.batch_size)]
    total_batches = len(batches)

    print(f"📚 Loaded {len(sermons)} paired sermons -> {total_batches} batches of up to {args.batch_size}.")
    batch_reports: list[str] = []

    for idx, batch in enumerate(batches, 1):
        ckpt_file = BATCH_DIR / f"batch_{idx:02d}.md"
        date_span = f"{batch[-1]['date']} .. {batch[0]['date']}"

        if ckpt_file.exists() and not args.force:
            print(f"✅ [Batch {idx}/{total_batches}] ({date_span}) Loaded existing checkpoint: {ckpt_file.name}")
            batch_reports.append(ckpt_file.read_text(encoding="utf-8"))
            continue

        print(f"\n🔍 [Batch {idx}/{total_batches}] Investigating {len(batch)} sermons ({date_span})...")
        batch_text = "\n\n====================\n\n".join(
            f"### SERMON [{s['date']}]\nTITLE AR: {s['title_ar']}\nTITLE CS: {s['title_cs']}\n\n"
            f"**ARABIC:**\n{s['ar']}\n\n**CZECH:**\n{s['cs']}"
            for s in batch
        )

        report_md, used_model = generate_stream(
            system_prompt=BATCH_INVESTIGATION_PROMPT,
            user_text=batch_text,
            preferred_model=args.model,
            temperature=0.2,
            thinking_level="medium",
            stream_to_stdout=True,
        )

        header = f"# Batch {idx:02d} Discovery ({date_span}) — Model: {used_model}\n\n"
        ckpt_file.write_text(header + report_md, encoding="utf-8")
        batch_reports.append(header + report_md)
        print(f"💾 Saved checkpoint -> {ckpt_file}")

        if idx < total_batches:
            print(f"⏳ Cooling down {args.cooldown}s to respect Free-Tier RPM/TPM...")
            time.sleep(args.cooldown)

    print(f"\n🧠 Synthesizing all {total_batches} batch reports into final report + system prompt...")
    combined_batches = "\n\n========================================\n\n".join(batch_reports)

    synthesis_out, synth_model = generate_stream(
        system_prompt=SYNTHESIS_PROMPT,
        user_text=combined_batches,
        preferred_model=args.model,
        temperature=0.2,
        thinking_level="high",
        stream_to_stdout=True,
    )

    marker = "=== MASTER_SYSTEM_PROMPT ==="
    if marker in synthesis_out:
        part_report, part_prompt = synthesis_out.split(marker, 1)
    else:
        part_report, part_prompt = synthesis_out, ""

    OUT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    OUT_REPORT.write_text(part_report.strip() + "\n", encoding="utf-8")
    print(f"\n✅ Saved full 70-sermon discovery report -> {OUT_REPORT} (via {synth_model})")

    if part_prompt.strip():
        # Clean markdown outer code-fence if the model wrapped the prompt in ```markdown ... ```
        cleaned_prompt = re.sub(r"^```(?:markdown|md)?\s*\n|\n```\s*$", "", part_prompt.strip())
        OUT_PROMPT.parent.mkdir(parents=True, exist_ok=True)
        OUT_PROMPT.write_text(cleaned_prompt.strip() + "\n", encoding="utf-8")
        print(f"✅ Saved AI-generated translation system prompt -> {OUT_PROMPT}")
    else:
        print("⚠️ Synthesis output did not contain the prompt split marker; check ai_discovery_report.md.")


if __name__ == "__main__":
    main()
