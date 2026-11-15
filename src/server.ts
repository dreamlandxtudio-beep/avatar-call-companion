import fs from "node:fs";
import path from "node:path";
import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  detectAvatarGenderWithGemini,
  detectFaceKeypointsWithGemini,
  streamGeminiChat,
  synthesizeSpeech,
  transcribeAudio,
  type ChatHistoryMsg,
} from "./server/gemini";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function handleApiChat(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      model?: string;
      systemInstruction?: string;
      history?: ChatHistoryMsg[];
      maxOutputTokens?: number;
    };
    const model = typeof body.model === "string" ? body.model : undefined;
    const systemInstruction = String(body.systemInstruction ?? "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const maxOutputTokens =
      typeof body.maxOutputTokens === "number" && body.maxOutputTokens > 0
        ? body.maxOutputTokens
        : undefined;

    const stream = await streamGeminiChat({ model, systemInstruction, history, maxOutputTokens });
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.text ?? "";
            if (text) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

async function handleApiTranscribe(request: Request): Promise<Response> {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let mimeType = "audio/webm";
    let base64Data = "";
    let language = "es-ES";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const audio = form.get("audio");
      const lang = form.get("language");
      if (typeof lang === "string" && lang.trim()) language = lang.trim();
      if (audio instanceof Blob) {
        mimeType = audio.type || mimeType;
        const arr = new Uint8Array(await audio.arrayBuffer());
        base64Data = Buffer.from(arr).toString("base64");
      }
    } else {
      const body = (await request.json()) as {
        mimeType?: string;
        data?: string;
        language?: string;
      };
      if (typeof body.mimeType === "string") mimeType = body.mimeType;
      if (typeof body.data === "string") base64Data = body.data;
      if (typeof body.language === "string") language = body.language;
    }

    if (!base64Data) {
      return new Response(JSON.stringify({ text: "" }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const text = await transcribeAudio({ mimeType, data: base64Data, language });
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

async function handleApiTts(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      text?: string;
      voiceName?: string;
      language?: string;
      style?: string;
      emotion?: string;
    };
    const text = String(body.text ?? "").trim();
    if (!text) {
      return new Response(JSON.stringify({ error: "Texto vacío." }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const wav = await synthesizeSpeech({
      text,
      voiceName: typeof body.voiceName === "string" ? body.voiceName : undefined,
      language: typeof body.language === "string" ? body.language : undefined,
      style: typeof body.style === "string" ? body.style : undefined,
      emotion: typeof body.emotion === "string" ? body.emotion : undefined,
    });

    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

async function handleApiFaceLandmarks(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { dataUrl?: string };
    const dataUrl = String(body.dataUrl ?? "");
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!m) {
      return new Response(JSON.stringify({ detected: false }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const result = await detectFaceKeypointsWithGemini({ mimeType: m[1]!, data: m[2]! });
    return new Response(JSON.stringify(result ?? { detected: false }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return new Response(JSON.stringify({ detected: false }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

async function handleApiAvatarGender(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { dataUrl?: string };
    const dataUrl = String(body.dataUrl ?? "");
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!m) {
      return new Response(JSON.stringify({ gender: "female" }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const gender = await detectAvatarGenderWithGemini({ mimeType: m[1]!, data: m[2]! });
    return new Response(JSON.stringify({ gender }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return new Response(JSON.stringify({ gender: "female" }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

async function handleApiLiveAvatarStatus(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url") || "http://localhost:7860";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(targetUrl, { signal: controller.signal });
      clearTimeout(timeout);
      return new Response(
        JSON.stringify({
          ok: true,
          status: "connected",
          url: targetUrl,
          statusCode: res.status,
          engine: "Alibaba-Quark/LiveAvatar",
        }),
        { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    } catch (e) {
      clearTimeout(timeout);
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(
        JSON.stringify({
          ok: false,
          status: "offline",
          url: targetUrl,
          error: msg,
          engine: "Alibaba-Quark/LiveAvatar",
        }),
        { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, status: "error", error: "URL inválida" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

// Hosting compresses every response at the edge. Never compress a body (gzip, brotli,
// CompressionStream) or set content-encoding here or in a server route: the body gets encoded
// twice and renders garbled.
export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (
        url.pathname.startsWith("/mediapipe-wasm/") &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        const file = url.pathname.slice("/mediapipe-wasm/".length);
        if (/^[a-zA-Z0-9_.-]+$/.test(file)) {
          const full = path.resolve(
            process.cwd(),
            "node_modules/@mediapipe/tasks-vision/wasm",
            file,
          );
          if (fs.existsSync(full)) {
            const bytes = fs.readFileSync(full);
            const mime = file.endsWith(".wasm")
              ? "application/wasm"
              : "application/javascript; charset=utf-8";
            return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), {
              status: 200,
              headers: {
                "Content-Type": mime,
                "Content-Length": String(bytes.byteLength),
                "Cache-Control": "public, max-age=86400",
              },
            });
          }
        }
      }
      if (url.pathname === "/api/chat" && request.method === "POST") {
        return await handleApiChat(request);
      }
      if (url.pathname === "/api/transcribe" && request.method === "POST") {
        return await handleApiTranscribe(request);
      }
      if (url.pathname === "/api/tts" && request.method === "POST") {
        return await handleApiTts(request);
      }
      if (url.pathname === "/api/face-landmarks" && request.method === "POST") {
        return await handleApiFaceLandmarks(request);
      }
      if (url.pathname === "/api/avatar-gender" && request.method === "POST") {
        return await handleApiAvatarGender(request);
      }
      if (url.pathname === "/api/liveavatar/status") {
        return await handleApiLiveAvatarStatus(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
