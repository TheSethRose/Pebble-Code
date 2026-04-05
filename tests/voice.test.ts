import { afterEach, describe, expect, test } from "bun:test";
import { connectVoiceStream } from "../src/voice/voiceStreamSTT";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("voice STT client", () => {
  test("uses configured voice endpoint overrides for transcription", async () => {
    let calledUrl = "";
    let calledModel = "";

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calledUrl = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      const body = init?.body as FormData;
      calledModel = String(body.get("model") ?? "");

      return new Response(JSON.stringify({ text: "custom transcript" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    let transcript = "";
    const connection = await connectVoiceStream({
      onTranscript: (text) => {
        transcript = text;
      },
      onError: (error) => {
        throw new Error(error);
      },
      onClose: () => {},
      onReady: () => {},
    }, {
      provider: "custom-stt",
      baseUrl: "http://127.0.0.1:7777/",
      transcribePath: "custom/transcribe",
      model: "gpt-4o-mini-transcribe",
    });

    expect(connection).not.toBeNull();
    connection?.send(Buffer.from([0, 1, 2, 3]));
    const result = await connection?.finalize();

    expect(result).toBe("post_closestream_endpoint");
    expect(calledUrl).toBe("http://127.0.0.1:7777/custom/transcribe");
    expect(calledModel).toBe("gpt-4o-mini-transcribe");
    expect(transcript).toBe("custom transcript");
  });
});