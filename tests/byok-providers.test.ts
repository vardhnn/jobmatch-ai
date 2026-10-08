import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * BYOK provider registry + transport tests.
 *
 * All HTTP is stubbed; the suite asserts the three wire protocols' request
 * shapes (URL, auth headers, body mapping), response parsing, retry behavior,
 * validation rules and — critically — that API keys never leak into errors.
 */

import {
  PROVIDER_PRESETS,
  getPreset,
  validateCredential,
  chatJson,
  testCredential,
  extractJson,
  AiTransportError,
  type AiCredential,
} from "@/lib/ai/providers";
import { parseAiCredential } from "@/lib/ai/credential-header";

// ── fetch stub ──────────────────────────────────────────────────────

type RecordedCall = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

let calls: RecordedCall[] = [];
let responder: (call: RecordedCall, attempt: number) => Response = () =>
  new Response(JSON.stringify({}), { status: 200 });

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), { status, headers });
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers: Record<string, string> = {};
      const h = new Headers(init?.headers);
      h.forEach((v, k) => (headers[k.toLowerCase()] = v));
      let body: Record<string, unknown> = {};
      if (typeof init?.body === "string") body = JSON.parse(init.body);
      const call = { url, headers, body };
      calls.push(call);
      return responder(call, calls.length);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const OPENAI: AiCredential = {
  provider: "openai",
  apiKey: "sk-openai-test",
  model: "gpt-test-1",
  baseUrl: "https://api.example.com/v1",
};

const openAiOk = (content: string) =>
  jsonResponse({
    model: "gpt-test-1",
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

const anthropicOk = (content: string) =>
  jsonResponse({ model: "claude-test-1", content: [{ type: "text", text: content }] });

const geminiOk = (content: string) =>
  jsonResponse({
    candidates: [{ content: { parts: [{ text: content }] } }],
    modelVersion: "gemini-test-1",
  });

// ── Registry ────────────────────────────────────────────────────────

describe("provider registry", () => {
  it("lists presets for every public provider with a protocol", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.protocol).toMatch(/^(openai-compatible|anthropic|gemini)$/);
      // Local/custom presets legitimately have no docs link.
      if (p.docsUrl) expect(p.docsUrl).toMatch(/^https?:\/\//);
    }
    expect(getPreset("openai")?.protocol).toBe("openai-compatible");
    expect(getPreset("anthropic")?.protocol).toBe("anthropic");
    expect(getPreset("gemini")?.protocol).toBe("gemini");
    expect(getPreset("openrouter")?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(getPreset("custom-openai")?.baseUrl).toBeNull();
    expect(getPreset("heuristic")?.internal).toBe(true);
  });
});

// ── Validation ──────────────────────────────────────────────────────

describe("validateCredential", () => {
  it("accepts a valid credential", () => {
    expect(validateCredential(OPENAI)).toBeNull();
  });

  it("accepts https and loopback http base URLs", () => {
    expect(validateCredential({ ...OPENAI, baseUrl: "https://x.io/v1" })).toBeNull();
    expect(validateCredential({ ...OPENAI, baseUrl: "http://localhost:11434/v1" })).toBeNull();
    expect(validateCredential({ ...OPENAI, baseUrl: "http://127.0.0.1:1234/v1" })).toBeNull();
  });

  it("rejects http base URLs off loopback", () => {
    expect(validateCredential({ ...OPENAI, baseUrl: "http://evil.example.com/v1" })).toMatch(
      /https/i,
    );
  });

  it("rejects unknown providers", () => {
    expect(
      validateCredential({ ...OPENAI, provider: "not-a-thing" as unknown as AiCredential["provider"] }),
    ).toMatch(/unknown provider/i);
  });

  it("rejects empty keys and models", () => {
    expect(validateCredential({ ...OPENAI, apiKey: "  " })).toMatch(/key/i);
    expect(validateCredential({ ...OPENAI, model: "" })).toMatch(/model/i);
  });

  it("rejects a missing base URL for custom-openai", () => {
    expect(validateCredential({ ...OPENAI, provider: "custom-openai", baseUrl: null })).toMatch(
      /base url/i,
    );
  });

  it("rejects oversized keys", () => {
    expect(validateCredential({ ...OPENAI, apiKey: "k".repeat(5000) })).toMatch(/key/i);
  });
});

// ── OpenAI-compatible transport ─────────────────────────────────────

describe("openai-compatible transport", () => {
  it("posts to {base}/chat/completions with bearer auth", async () => {
    responder = () => openAiOk('{"a":1}');
    const out = await chatJson<{ a: number }>(OPENAI, [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(out).toEqual({ a: 1 });
    expect(calls[0]?.url).toBe("https://api.example.com/v1/chat/completions");
    expect(calls[0]?.headers["authorization"]).toBe("Bearer sk-openai-test");
    expect(calls[0]?.body.model).toBe("gpt-test-1");
    expect(calls[0]?.body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
  });

  it("falls back to the preset base URL", async () => {
    responder = () => openAiOk('{"a":1}');
    await chatJson({ ...OPENAI, baseUrl: undefined }, [{ role: "user", content: "x" }]);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("retries a 429 then succeeds", async () => {
    responder = (call, attempt) =>
      attempt === 1
        ? new Response("rate limited", { status: 429, headers: { "retry-after": "0" } })
        : openAiOk('{"retried":true}');
    const out = await chatJson<{ retried: boolean }>(OPENAI, [{ role: "user", content: "x" }]);
    expect(out.retried).toBe(true);
    expect(calls.length).toBe(2);
  });

  it("fails fast on 4xx without retrying", async () => {
    responder = () => new Response("bad key", { status: 401 });
    await expect(chatJson(OPENAI, [{ role: "user", content: "x" }])).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      status: 401,
    });
    expect(calls.length).toBe(1);
  });

  it("never leaks the API key in transport errors", async () => {
    responder = () => new Response("upstream exploded", { status: 500 });
    const secret = "sk-super-secret-do-not-leak";
    try {
      await chatJson({ ...OPENAI, apiKey: secret }, [{ role: "user", content: "x" }], {
        retries: 0,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AiTransportError);
      expect(String((err as Error).message)).not.toContain(secret);
    }
  });

  it("rejects empty completions as INVALID_RESPONSE", async () => {
    responder = () => jsonResponse({ choices: [] });
    await expect(chatJson(OPENAI, [{ role: "user", content: "x" }])).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

// ── Anthropic transport ─────────────────────────────────────────────

describe("anthropic transport", () => {
  const ANTHROPIC: AiCredential = {
    provider: "anthropic",
    apiKey: "ak-ant-test",
    model: "claude-test-1",
  };

  it("posts to /v1/messages with x-api-key and promotes the system message", async () => {
    responder = () => anthropicOk('{"ok":true}');
    const out = await chatJson<{ ok: boolean }>(ANTHROPIC, [
      { role: "system", content: "be precise" },
      { role: "user", content: "hello" },
    ]);
    expect(out).toEqual({ ok: true });
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.headers["x-api-key"]).toBe("ak-ant-test");
    expect(calls[0]?.headers["anthropic-version"]).toBeTruthy();
    expect(calls[0]?.body.system).toBe("be precise");
    expect(calls[0]?.body.model).toBe("claude-test-1");
    expect(calls[0]?.body.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("parses the content[0].text response shape", async () => {
    responder = () => anthropicOk('{"n":42}');
    const out = await chatJson<{ n: number }>(ANTHROPIC, [{ role: "user", content: "x" }]);
    expect(out.n).toBe(42);
  });
});

// ── Gemini transport ────────────────────────────────────────────────

describe("gemini transport", () => {
  const GEMINI: AiCredential = {
    provider: "gemini",
    apiKey: "gm-gem-test",
    model: "gemini-test-1",
  };

  it("posts to models/{model}:generateContent with x-goog-api-key", async () => {
    responder = () => geminiOk('{"ok":true}');
    await chatJson(GEMINI, [
      { role: "system", content: "be precise" },
      { role: "user", content: "hello" },
    ]);
    expect(calls[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-1:generateContent",
    );
    expect(calls[0]?.headers["x-goog-api-key"]).toBe("gm-gem-test");
    expect(calls[0]?.body.systemInstruction).toEqual({ parts: [{ text: "be precise" }] });
    expect(calls[0]?.body.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
  });

  it("joins multi-part text in the response", async () => {
    responder = () =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: '{"a":' }, { text: "3}" }] } }] });
    const out = await chatJson<{ a: number }>(GEMINI, [{ role: "user", content: "x" }]);
    expect(out.a).toBe(3);
  });
});

// ── testCredential ──────────────────────────────────────────────────

describe("testCredential", () => {
  it("returns ok with latency on a good key", async () => {
    responder = () => openAiOk('{"ok":true}');
    const res = await testCredential(OPENAI);
    expect(res.ok).toBe(true);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect(res.error).toBeUndefined();
  });

  it("returns a clean error on a bad key", async () => {
    responder = () => new Response("denied", { status: 401 });
    const res = await testCredential(OPENAI);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/401|denied/i);
  });

  it("rejects invalid credentials before any network call", async () => {
    const res = await testCredential({ ...OPENAI, model: "" });
    expect(res.ok).toBe(false);
    expect(calls.length).toBe(0);
  });
});

// ── extractJson (moved from ai-flow.test.ts) ────────────────────────

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses fenced JSON", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```\ndone')).toEqual({ a: 1 });
  });
  it("parses JSON embedded in prose", () => {
    expect(extractJson('Here you go: {"a":[1,2]} hope that helps')).toEqual({ a: [1, 2] });
  });
  it("throws AiTransportError on garbage", () => {
    expect(() => extractJson("no json here")).toThrow(AiTransportError);
  });
});

// ── Credential header parsing (Task 3) ──────────────────────────────

describe("parseAiCredential", () => {
  const encode = (c: unknown) =>
    Buffer.from(JSON.stringify(c), "utf8").toString("base64");

  it("round-trips a valid credential", () => {
    const req = new Request("https://app.test/api/x", {
      headers: { "x-ai-credential": encode(OPENAI) },
    });
    expect(parseAiCredential(req)).toMatchObject({
      provider: "openai",
      apiKey: "sk-openai-test",
      model: "gpt-test-1",
    });
  });

  it("returns null when the header is missing", () => {
    expect(parseAiCredential(new Request("https://app.test/"))).toBeNull();
  });

  it("returns null on garbage base64 / wrong JSON", () => {
    const bad1 = new Request("https://app.test/", { headers: { "x-ai-credential": "!!notb64!!" } });
    const bad2 = new Request("https://app.test/", {
      headers: { "x-ai-credential": Buffer.from("not json", "utf8").toString("base64") },
    });
    expect(parseAiCredential(bad1)).toBeNull();
    expect(parseAiCredential(bad2)).toBeNull();
  });

  it("rejects the internal heuristic provider over HTTP", () => {
    const req = new Request("https://app.test/", {
      headers: {
        "x-ai-credential": encode({ provider: "heuristic", apiKey: "local", model: "heuristic" }),
      },
    });
    expect(parseAiCredential(req)).toBeNull();
  });

  it("rejects credentials that fail validation", () => {
    const req = new Request("https://app.test/", {
      headers: { "x-ai-credential": encode({ ...OPENAI, apiKey: "" }) },
    });
    expect(parseAiCredential(req)).toBeNull();
  });
});
