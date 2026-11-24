/**
 * Browser-side Gemini API client.
 * Direct fetch + SSE streaming to generativelanguage.googleapis.com.
 * Automatic retry on 429/503 and model fallback across FREE_TIER_MODELS.
 */

const FREE_TIER_MODELS = [
  "gemini-4-hydrogen",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];

/**
 * Stream text from Gemini via SSE.
 * @param {string} systemPrompt - System instruction text.
 * @param {string} userText - User message body.
 * @param {string} apiKey - BYOK API key (AIza...).
 * @param {object} opts - Optional config.
 * @returns {Promise<{text: string, modelUsed: string}>}
 */
async function geminiStream(systemPrompt, userText, apiKey, opts = {}) {
  const {
    preferredModel = "gemini-4-hydrogen",
    temperature = 0.2,
    thinkingLevel = "medium",
    onChunk = null,       // callback(chunk: string) for live streaming
    onProgress = null,    // callback(stepIndex: number) for progress bar
    chunkTimeout = 150,   // seconds before giving up on a model
    abortSignal = null,   // AbortController.signal from caller (cancel button)
  } = opts;

  const modelsToTry = [preferredModel, ...FREE_TIER_MODELS.filter(m => m !== preferredModel)];

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature,
      thinkingConfig: { thinkingLevel },
    },
  };

  for (let mi = 0; mi < modelsToTry.length; mi++) {
    const model = modelsToTry[mi];
    const retries = 2;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await fetchStream(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
          payload,
          apiKey,
          chunkTimeout,
          onChunk,
        );

        if (result.text && result.text.trim()) {
          return { text: result.text.trim(), modelUsed: model };
        }
      } catch (err) {
        const status = err.status;
        const body = err.body || "";

        if (status === 429) {
          // Check if daily quota exhausted → skip this model entirely
          if (/PerDay|daily/i.test(body)) {
            break; // try next model
          }
          // Per-minute rate limit → wait and retry
          const delayMatch = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
          const waitSec = delayMatch ? parseFloat(delayMatch[1]) + 2 : 25 * attempt;
          if (attempt < retries) {
            await sleep(waitSec * 1000);
            continue;
          }
          break;
        }

        if ([500, 502, 503, 504].includes(status) && attempt < retries) {
          await sleep(6000 * attempt);
          continue;
        }

        // Network error or other — retry once more
        if (attempt < retries) {
          await sleep(5000);
          continue;
        }
      }
    }
  }

  throw new Error("All Free-Tier Gemini models failed or exhausted quota.");
}

/**
 * Fetch an SSE stream and parse `data: {...}` frames.
 */
async function fetchStream(url, payload, apiKey, timeoutSec, onChunk) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      const err = new Error(`HTTP ${response.status}: ${errBody.slice(0, 200)}`);
      err.status = response.status;
      err.body = errBody;
      throw err;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let chunks = [];
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        try {
          const event = JSON.parse(jsonStr);
          const parts = (event.candidates?.[0]?.content?.parts) || [];
          for (const part of parts) {
            if (part.thought) continue; // skip thinking tokens
            const txt = part.text;
            if (txt) {
              chunks.push(txt);
              if (onChunk) onChunk(txt);
            }
          }
        } catch (_) {
          // Malformed JSON frame — ignore
        }
      }
    }

    return { text: chunks.join("") };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
