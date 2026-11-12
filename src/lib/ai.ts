import Anthropic from "@anthropic-ai/sdk";

/**
 * Every AI call in the app goes through here, cheapest first:
 *
 *   1. Gemini on the free key (GEMINI_API_KEY). Each model has its own daily free
 *      quota, so a list of models is tried in order; a model that runs out of quota is
 *      skipped until it resets.
 *   2. Gemini on a paid key (GEMINI_PAID_API_KEY, optional): the same models, billed.
 *   3. Claude (ANTHROPIC_API_KEY), only as the last resort. CLAUDE_FALLBACK=off turns
 *      it off entirely.
 *
 * Returns null when nothing answers; callers then fall back to rules.
 */

export type Tier = "judge" | "fast";

/** Strongest first for decisions; Pro models usually have no free quota but are tried in case they do. */
const MODELS: Record<Tier, string[]> = {
  judge: list(
    process.env.GEMINI_JUDGE_MODELS,
    "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-pro-latest,gemini-3.1-pro-preview,gemini-3.5-flash,gemini-flash-latest,gemini-3.1-flash-lite,gemini-flash-lite-latest",
  ),
  fast: list(process.env.GEMINI_MODEL, "gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash,gemini-3.6-flash,gemini-flash-latest"),
};
const TIMEOUT: Record<Tier, number> = { judge: 120_000, fast: 25_000 };
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

function list(env: string | undefined, fallback: string) {
  return (env || fallback)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

export const claudeAllowed = () => !!process.env.ANTHROPIC_API_KEY && process.env.CLAUDE_FALLBACK !== "off";

type Schema = { [k: string]: unknown };

export interface Generated<T> {
  data: T;
  /** who answered, e.g. "Gemini 3.6 Flash (free)" or "Claude" */
  model: string;
}

export const modelLabel = (model: string, paid: boolean) =>
  `${model
    .replace(/^gemini-/, "Gemini ")
    .replace(/-latest$/, "")
    .replace(/-preview$/, "")
    .replace(/-/g, " ")
    .replace(/\b(flash|pro|lite)\b/g, (w) => w[0].toUpperCase() + w.slice(1))}${paid ? " (paid)" : " (free)"}`;

// --- Gemini -------------------------------------------------------------------------

/** model|key -> time it may be tried again. On globalThis so every route shares it. */
const g = globalThis as { __strikeGeminiPause?: Map<string, number> };
const paused = (g.__strikeGeminiPause ??= new Map());

/** Next midnight in California, when Gemini's daily free quotas reset. */
function nextQuotaReset() {
  const now = new Date();
  const la = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const msToMidnight = (24 * 60 - (la.getHours() * 60 + la.getMinutes())) * 60_000;
  return now.getTime() + msToMidnight + 60_000;
}

/** Works out how long to leave a model alone after an error. */
function pauseFor(status: number, body: unknown): number {
  const err = (body as { error?: { message?: string; details?: { retryDelay?: string; violations?: { quotaId?: string }[] }[] } })?.error;
  if (status === 404) return Date.now() + 24 * 3_600_000; // retired model
  if (status === 429) {
    const details = err?.details ?? [];
    const daily = details.some((d) => d.violations?.some((v) => /PerDay/i.test(v.quotaId ?? "")));
    if (daily || /per day|daily/i.test(err?.message ?? "")) return nextQuotaReset();
    const retry = details.find((d) => d.retryDelay)?.retryDelay;
    const secs = retry ? parseFloat(retry) : NaN;
    return Date.now() + (Number.isFinite(secs) ? Math.max(secs * 1000, 15_000) : 10 * 60_000);
  }
  return Date.now() + 2 * 60_000; // overloaded, timed out or failed: try again shortly
}

/** One Gemini request. Throws on failure after recording how long to skip the model. */
export async function geminiRequest(
  model: string,
  key: string,
  body: object,
  timeoutMs: number,
  retry = true,
): Promise<{ candidates?: { content?: GeminiContent }[] }> {
  const id = `${model}|${key.slice(-6)}`;
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    paused.set(id, Date.now() + 2 * 60_000);
    throw e;
  }
  const json = await res.json().catch(() => ({}));
  // free-tier overload is usually momentary: one quick retry before moving on
  if (res.status === 503 && retry) {
    await new Promise((r) => setTimeout(r, 1500));
    return geminiRequest(model, key, body, timeoutMs, false);
  }
  if (!res.ok) {
    paused.set(id, pauseFor(res.status, json));
    throw new Error(`${res.status} ${(json as { error?: { status?: string } }).error?.status ?? ""}`.trim());
  }
  return json;
}

export type GeminiPart = { text?: string; thought?: boolean; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: unknown; thoughtSignature?: string };
export type GeminiContent = { role?: string; parts?: GeminiPart[] };

/** Every (model, key, paid) the tier should try right now, cheapest first. */
export function geminiRoute(tier: Tier): { model: string; key: string; paid: boolean }[] {
  const keys = [
    { key: process.env.GEMINI_API_KEY, paid: false },
    { key: process.env.GEMINI_PAID_API_KEY, paid: true },
  ].filter((k): k is { key: string; paid: boolean } => !!k.key);
  const now = Date.now();
  return keys.flatMap(({ key, paid }) =>
    MODELS[tier].filter((m) => (paused.get(`${m}|${key.slice(-6)}`) ?? 0) <= now).map((model) => ({ model, key, paid })),
  );
}

async function viaGemini(system: string, prompt: string, schema: Schema, tier: Tier): Promise<Generated<unknown> | undefined> {
  for (const { model, key, paid } of geminiRoute(tier)) {
    try {
      const json = await geminiRequest(
        model,
        key,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: schema },
        },
        TIMEOUT[tier],
      );
      const text = json.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      if (!text) throw new Error("no text returned");
      return { data: JSON.parse(text), model: modelLabel(model, paid) };
    } catch (e) {
      console.warn(`[ai] ${model}${paid ? " (paid)" : ""} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return undefined;
}

// --- Claude (last resort) -----------------------------------------------------------

let claude: Anthropic | undefined;

/** Claude's structured outputs require every object to forbid extra properties; Gemini's schema dialect rejects the keyword. */
function strict(schema: Schema): Schema {
  const out: Schema = { ...schema };
  if (out.type === "object") {
    out.additionalProperties = false;
    out.properties = Object.fromEntries(Object.entries((out.properties ?? {}) as Record<string, Schema>).map(([k, v]) => [k, strict(v)]));
  }
  if (out.items) out.items = strict(out.items as Schema);
  return out;
}

async function viaClaude(system: string, prompt: string, schema: Schema, tier: Tier): Promise<unknown> {
  if (!claudeAllowed()) return undefined;
  claude ??= new Anthropic();
  // streamed so long answers never hit the HTTP timeout
  const stream = claude.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 32000,
    // if the model declines on policy grounds, the API re-runs the request on a fallback model
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: tier === "judge" ? "high" : "low", format: { type: "json_schema", schema: strict(schema) } },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  const res = await stream.finalMessage();
  if (res.stop_reason === "refusal") throw new Error("Claude declined the request");
  if (res.stop_reason === "max_tokens") throw new Error("Claude ran out of output tokens");
  return JSON.parse(res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
}

/** Structured JSON from the cheapest model that answers. `judge` tries the strongest models first. */
export async function generateJson<T>(system: string, prompt: string, schema: Schema, tier: Tier = "fast"): Promise<Generated<T> | null> {
  const fromGemini = await viaGemini(system, prompt, schema, tier);
  if (fromGemini) return fromGemini as Generated<T>;
  try {
    const data = await viaClaude(system, prompt, schema, tier);
    if (data !== undefined) return { data: data as T, model: "Claude" };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.warn("[ai] Claude rejected the API key");
    else if (e instanceof Anthropic.RateLimitError) console.warn("[ai] Claude rate limit reached");
    else if (e instanceof Anthropic.APIError) console.warn(`[ai] Claude API error ${e.status}: ${e.message}`);
    else console.warn("[ai] Claude failed:", e instanceof Error ? e.message : e);
  }
  return null;
}
