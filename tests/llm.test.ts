import { afterEach, describe, expect, it, vi } from "vitest";
import { Type } from "@google/genai";

const GROQ_REPLY = (message: object, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message }] }), { status });

async function loadChatModel(models: string) {
  vi.resetModules();
  vi.stubEnv("CHAT_MODELS", models);
  return (await import("../lib/llm")).chatModel;
}

const REQUEST = { system: "rules", contents: [{ role: "user", parts: [{ text: "hi" }] }], tools: [] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Groq adapter", () => {
  it("converts a whole tool round trip, keeping the call and its result linked", async () => {
    const { toGroqMessages } = await import("../lib/llm");

    const messages = toGroqMessages("rules", [
      { role: "user", parts: [{ text: "visit?" }] },
      { role: "model", parts: [{ functionCall: { id: "c1", name: "get_free_slots", args: { project_slug: "p" } } }] },
      { role: "user", parts: [{ functionResponse: { id: "c1", name: "get_free_slots", response: { free: [] } } }] },
      { role: "model", parts: [{ text: "None free." }] },
    ]);

    expect(messages).toEqual([
      { role: "system", content: "rules" },
      { role: "user", content: "visit?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "get_free_slots", arguments: '{"project_slug":"p"}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: '{"free":[]}' },
      { role: "assistant", content: "None free." },
    ]);
  });

  it("links a Gemini call with no id to its result", async () => {
    const { toGroqMessages } = await import("../lib/llm");

    const [, call, result] = toGroqMessages("rules", [
      { role: "model", parts: [{ functionCall: { name: "book_visit", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { name: "book_visit", response: {} } }] },
    ]) as { tool_calls?: { id: string }[]; tool_call_id?: string }[];

    expect(result.tool_call_id).toBe(call.tool_calls?.[0].id);
  });

  it("lower-cases schema types without touching other values", async () => {
    const { toGroqTools } = await import("../lib/llm");

    const [tool] = toGroqTools([
      {
        name: "t",
        parameters: { type: Type.OBJECT, properties: { a: { type: Type.STRING, enum: ["KEEP"] } } },
      },
    ]);

    expect(tool.function.parameters).toEqual({
      type: "object",
      properties: { a: { type: "string", enum: ["KEEP"] } },
    });
  });

  it("returns tool calls in the shape the chat loop replays", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        GROQ_REPLY({ tool_calls: [{ id: "c1", function: { name: "book_visit", arguments: '{"slot_id":5}' } }] }),
      ),
    );
    const chatModel = await loadChatModel("groq:m");

    const reply = await chatModel(REQUEST);

    expect(reply.functionCalls).toEqual([{ id: "c1", name: "book_visit", args: { slot_id: 5 } }]);
    expect(reply.content?.parts).toEqual([{ functionCall: { id: "c1", name: "book_visit", args: { slot_id: 5 } } }]);
    expect(reply.text).toBe("");
  });

  it("never lets a model's reasoning reach the buyer, even if it is cut off", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(GROQ_REPLY({ content: "<think>secret plan</think>\nHello." }))
        .mockResolvedValueOnce(GROQ_REPLY({ content: "<think>secret plan cut off" })),
    );
    const chatModel = await loadChatModel("groq:m");

    expect((await chatModel(REQUEST)).text).toBe("Hello.");
    expect((await chatModel(REQUEST)).text).toBe("");
  });

  it("moves to the next model when Groq is busy, and sends the bare model name", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(GROQ_REPLY({ content: "From the backup." }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const chatModel = await loadChatModel("groq:first,groq:second");

    const reply = await chatModel(REQUEST);

    expect(reply.text).toBe("From the backup.");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe("second");
  });

  it("treats a malformed tool call as a failure, so the next model gets the turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(GROQ_REPLY({ tool_calls: [{ id: "c1", function: { name: "x", arguments: "{bad" } }] }))
        .mockResolvedValueOnce(GROQ_REPLY({ content: "Fine." })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const chatModel = await loadChatModel("groq:first,groq:second");

    expect((await chatModel(REQUEST)).text).toBe("Fine.");
  });
});
