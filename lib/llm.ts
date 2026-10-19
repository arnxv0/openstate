import type { StepRequest, StepResult } from "@/lib/agent-types";
import * as gemini from "@/lib/gemini";
import * as groq from "@/lib/groq";
import { errorText, log } from "@/lib/log";
import * as openai from "@/lib/openai";
import { recordUsage } from "@/lib/usage";

// One JSON-generation entry point for perception and answers. OpenAI is used
// when its key is present (paid, no free-tier ceiling); otherwise Gemini.
// LLM_PROVIDER=gemini|openai forces one when both keys are set.

export type Provider = "groq" | "openai" | "gemini";

export function provider(): Provider | null {
  const forced = process.env.LLM_PROVIDER;
  if (forced === "groq" && groq.hasGroq()) return "groq";
  if (forced === "openai" || forced === "gemini") return forced;
  if (openai.hasOpenAI()) return "openai";
  if (gemini.hasGemini()) return "gemini";
  return null;
}

export const hasModel = () => provider() !== null;

/** Tool calling is wired for OpenAI and Groq; on Gemini the agent answers from the prompt alone. */
export const supportsTools = () => {
  const active = provider();
  return active === "openai" || active === "groq";
};

/** GROQ_VISION=1 sends photos to Groq as well; needs a paid tier to be useful. */
const groqVision = () => /^(1|true|on)$/i.test(process.env.GROQ_VISION ?? "") || !openai.hasOpenAI();

/** How many photos one call may carry; callers trim to this (see groq.imageBudget). */
export const maxImages = () => (provider() === "groq" && groqVision() ? groq.MAX_IMAGES : Infinity);

export const MISSING_KEY_MESSAGE =
  "Add OPENAI_API_KEY or GEMINI_API_KEY to .env to enable perception and answers.";

/** Small fallback models cannot be trusted with fine visual distinctions. */
export const isLiteModel = (model: string) =>
  gemini.isLiteModel(model) || openai.isLiteOpenAIModel(model);

export async function generateJson<T>(request: Parameters<typeof gemini.generateJson<T>>[0]) {
  const active = provider();
  if (!active) throw new Error(MISSING_KEY_MESSAGE);
  let result;
  const hasImages = request.parts.some((part) => "inline_data" in part);
  if (active === "groq" && hasImages && openai.hasOpenAI() && !groqVision()) {
    // Measured on the free tier: a three-photo episode asks for more input
    // tokens than a key gets per minute (7,000) and is refused, so photos go
    // to the main model and Groq keeps its budget for answers.
    result = await openai.generateJson<T>(request);
  } else if (active === "groq") {
    try {
      result = await groq.generateJson<T>(request);
    } catch (cause) {
      // Every key rate limited, or the request does not fit: keep the demo
      // alive on the paid model rather than failing the episode or answer.
      if (!openai.hasOpenAI()) throw cause;
      log("llm", "groq unavailable, falling back to openai", { error: errorText(cause) });
      result = await openai.generateJson<T>(request);
    }
  } else {
    result =
      active === "openai" ? await openai.generateJson<T>(request) : await gemini.generateJson<T>(request);
  }
  recordUsage(result.model, result.usage);
  return result;
}

/** One step of the tool loop, routed like generateJson (photos stay off free-tier Groq). */
export async function stepWithTools(request: StepRequest): Promise<StepResult> {
  const active = provider();
  if (!active) throw new Error(MISSING_KEY_MESSAGE);
  const hasImages = request.transcript.some(
    (turn) => turn.role === "user" && turn.parts.some((part) => "inline_data" in part),
  );
  let result: StepResult;
  if (active === "groq" && hasImages && openai.hasOpenAI() && !groqVision()) {
    result = await openai.stepWithTools(request);
  } else if (active === "groq") {
    try {
      result = await groq.stepWithTools(request);
    } catch (cause) {
      if (!openai.hasOpenAI()) throw cause;
      log("llm", "groq unavailable, falling back to openai", { error: errorText(cause) });
      result = await openai.stepWithTools(request);
    }
  } else if (active === "openai") {
    result = await openai.stepWithTools(request);
  } else {
    throw new Error("Gemini has no tool support here; use generateJson");
  }
  recordUsage(result.model, result.usage);
  return result;
}
