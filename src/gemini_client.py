import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from typing import Callable
from pathlib import Path

# Ordered from highest analytical quality to highest Free-Tier daily quota
FREE_TIER_MODELS = [
    "gemini-4-hydrogen",
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
]

def load_api_key() -> str:
    """Read GEMINI_API_KEY / GOOGLE_API_KEY from environment or local .env file."""
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if key:
        return key.strip()

    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                if k.strip() in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
                    return v.strip().strip('"').strip("'")

    raise SystemExit(
        "❌ Missing API key! Export GEMINI_API_KEY='...' or place GEMINI_API_KEY=... in .env"
    )


def _parse_retry_delay(err_body: str, default_sec: int) -> int:
    """Extract Google's suggested retryDelay (e.g. '32s') from a 429 JSON error."""
    m = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', err_body)
    if m:
        return int(float(m.group(1))) + 2
    return default_sec


def generate_stream(
    system_prompt: str,
    user_text: str,
    preferred_model: str = "gemini-3.8-flash",
    temperature: float = 0.2,
    thinking_level: str = "medium",
    stream_to_stdout: bool = True,
    chunk_timeout: int = 150,
    api_key: str | None = None,
    on_chunk: Callable[[str], None] | None = None,
) -> tuple[str, str]:
    """
    Stream text from Gemini Free Tier with automatic 429/503 backoff and model fallback.
    Returns (generated_text, model_used).
    """
    resolved_key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not resolved_key:
        try:
            resolved_key = load_api_key()
        except SystemExit:
            raise SystemExit("❌ No API key provided. Pass api_key=..., set GEMINI_API_KEY, or place .env file.") from None
    models_to_try = [preferred_model] + [m for m in FREE_TIER_MODELS if m != preferred_model]

    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_text}]}],
        "generationConfig": {
            "temperature": temperature,
            "thinkingConfig": {"thinkingLevel": thinking_level},
        },
    }
    data = json.dumps(payload).encode("utf-8")

    for model in models_to_try:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:streamGenerateContent?alt=sse&key={resolved_key}"
        )
        retries = 2
        for attempt in range(1, retries + 1):
            req = urllib.request.Request(
                url,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                },
            )
            chunks: list[str] = []
            try:
                with urllib.request.urlopen(req, timeout=chunk_timeout) as resp:
                    for raw_line in resp:
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line.startswith("data:"):
                            continue
                        json_str = line[5:].strip()
                        if not json_str or json_str == "[DONE]":
                            continue
                        event = json.loads(json_str)
                        parts = (
                            event.get("candidates", [{}])[0]
                            .get("content", {})
                            .get("parts", [])
                        )
                        for part in parts:
                            if part.get("thought"):
                                if stream_to_stdout:
                                    sys.stdout.write(".")
                                    sys.stdout.flush()
                                continue
                            txt = part.get("text", "")
                            if txt:
                                if stream_to_stdout:
                                    sys.stdout.write(txt)
                                    sys.stdout.flush()
                                if on_chunk is not None:
                                    on_chunk(txt)
                                chunks.append(txt)

                if stream_to_stdout:
                    print()
                full_text = "".join(chunks).strip()
                if full_text:
                    return full_text, model
                raise RuntimeError("Empty stream returned by API")

            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8", errors="replace")
                short_err = re.sub(r"\s+", " ", err_body)[:220]
                print(f"\n  ⚠️ [{model}] HTTP {e.code} (attempt {attempt}/{retries}): {short_err}")

                if e.code == 429:
                    # Distinguish per-minute rate limit vs exhausted daily quota (RPD)
                    if "PerDay" in err_body or "daily" in err_body.lower():
                        print(f"  ↪ Daily free quota reached on {model}; switching model...")
                        break
                    wait_s = _parse_retry_delay(err_body, default_sec=25 * attempt)
                    if attempt < retries:
                        print(f"     Rate-limited (RPM/TPM). Cooling down {wait_s}s...")
                        time.sleep(wait_s)
                        continue
                    break

                if e.code in (500, 502, 503, 504) and attempt < retries:
                    wait_s = 6 * attempt
                    print(f"     Server busy. Retrying in {wait_s}s...")
                    time.sleep(wait_s)
                    continue
                break

            except (TimeoutError, socket.timeout, urllib.error.URLError, RuntimeError) as e:
                print(f"\n  ⚠️ [{model}] Stream/Timeout error (attempt {attempt}/{retries}): {e}")
                if attempt < retries:
                    time.sleep(5)
                    continue
                break

        print(f"  ↪ Falling back from {model} to next free-tier model...\n")

    raise SystemExit("❌ All Free-Tier Gemini models failed or exhausted quota. Re-run later to resume from checkpoints.")
