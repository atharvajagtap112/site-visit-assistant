import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";

export type LlmRequest = {
  system: string;
  contents: Content[];
  tools: FunctionDeclaration[];
};

export type LlmResponse = {
  /** Replayed unchanged within a turn: Gemini requires its thought signatures back. */
  content: Content | undefined;
  functionCalls: { id?: string; name?: string; args?: Record<string, unknown> }[];
  text: string;
};

export type Llm = (request: LlmRequest) => Promise<LlmResponse>;

// Tried in order. Measured on the free tier: 3.1 lite replied in 1-2 s; 3.6 in about 3 s with
// thinking off; 3.5 lite and 3.8 took 20 s or more and were often busy.
const MODELS = (process.env.CHAT_MODELS ?? "gemini-3.1-flash-lite,gemini-3.6-flash").split(",");
const MODEL_TIMEOUT_MS = 12_000;
const PASSES = 2;
const RETRY_PAUSE_MS = 1500;

/** Free-tier "busy" errors are usually brief, so go through the models twice before giving up. */
export async function tryModels<T>(
  models: string[],
  call: (model: string) => Promise<T>,
  pauseMs = RETRY_PAUSE_MS,
): Promise<T> {
  let lastError: unknown;
  for (let pass = 0; pass < PASSES; pass++) {
    if (pass > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    for (const model of models) {
      try {
        return await call(model);
      } catch (error) {
        lastError = error;
        console.warn(`Model ${model} failed: ${(error as { status?: number }).status ?? "no status"}`);
      }
    }
  }
  throw lastError;
}

export const gemini: Llm = ({ system, contents, tools }) => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  return tryModels(MODELS, async (model) => {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: system,
        tools: [{ functionDeclarations: tools }],
        // The reply is short and the code checks it, so speed matters more than deliberation.
        thinkingConfig: { thinkingBudget: 0 },
        httpOptions: { timeout: MODEL_TIMEOUT_MS },
      },
    });
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    return {
      content: response.candidates?.[0]?.content,
      functionCalls: response.functionCalls ?? [],
      text: parts
        .map((part) => part.text ?? "")
        .join("")
        .trim(),
    };
  });
};
