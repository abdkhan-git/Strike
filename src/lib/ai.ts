import Anthropic from "@anthropic-ai/sdk";

/**
 * JSON generation for the news notes: Gemini first (large free daily quota), Claude when
 * Gemini is rate-limited, errors, or returns something unusable. Returns null when neither
 * is configured or both fail; callers fall back to the rule-based text.
 */

/** Tried in order. The free tier of the main flash model is often slow or saturated; flash-lite usually answers. */
const GEMINI_MODELS = (process.env.GEMINI_MODEL || "gemini-flash-latest,gemini-flash-lite-latest").split(",").map((m) => m.trim());
const GEMINI_TIMEOUT = 20_000;
const PAUSE = 5 * 60_000;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

type Schema = { [k: string]: unknown };

export interface Generated<T> {
  data: T;
  /** short provider label shown next to the text */
  model: "Gemini" | "Claude";
}

/** Claude's structured outputs require every object to forbid extra properties; Gemini's schema dialect rejects the keyword. */
function strict(schema: Schema): Schema {
  const out: Schema = { ...schema };
  if (out.type === "object") {
    out.additionalProperties = false;
    out.properties = Object.fromEntries(
      Object.entries((out.properties ?? {}) as Record<string, Schema>).map(([k, v]) => [k, strict(v)]),
    );
  }
  if (out.items) out.items = strict(out.items as Schema);
  return out;
}

/** A model that timed out or hit its quota is skipped until this time. */
const pausedUntil = new Map<string, number>();

async function askGemini(model: string, key: string, system: string, prompt: string, schema: Schema): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(GEMINI_TIMEOUT),
    });
  } catch (e) {
    pausedUntil.set(model, Date.now() + PAUSE);
    throw e;
  }
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) pausedUntil.set(model, Date.now() + PAUSE);
    throw new Error(`${res.status}`);
  }
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new Error("no text returned");
  return JSON.parse(text);
}

/** Undefined when no Gemini model is configured or available right now. */
async function viaGemini(system: string, prompt: string, schema: Schema): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return undefined;
  for (const model of GEMINI_MODELS) {
    if (Date.now() < (pausedUntil.get(model) ?? 0)) continue;
    try {
      return await askGemini(model, key, system, prompt, schema);
    } catch (e) {
      console.warn(`[ai] ${model} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return undefined;
}

let claude: Anthropic | undefined;

async function viaClaude(system: string, prompt: string, schema: Schema): Promise<unknown> {
  if (!process.env.ANTHROPIC_API_KEY) return undefined;
  claude ??= new Anthropic();
  const res = await claude.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    // if the model declines on policy grounds, the API re-runs the request on a fallback model
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: strict(schema) } },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined the request");
  if (res.stop_reason === "max_tokens") throw new Error("Claude ran out of output tokens");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text);
}

export async function generateJson<T>(system: string, prompt: string, schema: Schema): Promise<Generated<T> | null> {
  const fromGemini = await viaGemini(system, prompt, schema);
  if (fromGemini !== undefined) return { data: fromGemini as T, model: "Gemini" };
  try {
    const data = await viaClaude(system, prompt, schema);
    if (data !== undefined) return { data: data as T, model: "Claude" };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.warn("[ai] Claude rejected the API key");
    else if (e instanceof Anthropic.RateLimitError) console.warn("[ai] Claude rate limit reached");
    else if (e instanceof Anthropic.APIError) console.warn(`[ai] Claude API error ${e.status}: ${e.message}`);
    else console.warn("[ai] Claude failed:", e instanceof Error ? e.message : e);
  }
  return null;
}
