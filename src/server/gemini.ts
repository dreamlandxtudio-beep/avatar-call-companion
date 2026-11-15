import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

export type ChatHistoryMsg = {
  role: "user" | "assistant";
  content: string;
};

export type CloudModelName = "gemini-3.1-flash-lite" | "gemini-4-hydrogen";

let client: GoogleGenAI | null = null;
let betaClient: GoogleGenAI | null = null;

function getClient() {
  const apiKey = process.env["GEMINI_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error("Falta configurar GEMINI_API_KEY en Settings > Secrets.");
  }
  if (!client) {
    client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return client;
}

function getBetaClient() {
  const apiKey = process.env["GEMINI_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error("Falta configurar GEMINI_API_KEY en Settings > Secrets.");
  }
  if (!betaClient) {
    betaClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: "v1beta",
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return betaClient;
}

function normalizeContents(history: ChatHistoryMsg[]) {
  const cleaned = history
    .filter((m) => m.content && m.content.trim().length > 0 && !m.content.startsWith("(Error"))
    .slice(-14);

  // Drop leading assistant turns so the conversation starts cleanly with a user turn.
  while (cleaned.length > 0 && cleaned[0]?.role === "assistant") {
    cleaned.shift();
  }

  // Merge consecutive messages from the same role so turns strictly alternate user/model.
  const merged: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const m of cleaned) {
    const role = m.role === "assistant" ? "model" : "user";
    const text = m.content.trim();
    const prev = merged.at(-1);
    if (prev && prev.role === role) {
      prev.parts[0]!.text += `\n${text}`;
    } else {
      merged.push({ role, parts: [{ text }] });
    }
  }

  return merged;
}

export async function streamGeminiChat(opts: {
  model?: string | undefined;
  systemInstruction: string;
  history: ChatHistoryMsg[];
  maxOutputTokens?: number | undefined;
}) {
  const ai = getClient();
  const model: CloudModelName =
    opts.model === "gemini-4-hydrogen" ? "gemini-4-hydrogen" : "gemini-3.1-flash-lite";

  const contents = normalizeContents(opts.history);
  if (contents.length === 0) {
    throw new Error("Conversation history cannot be empty.");
  }

  const thinkingLevel =
    model === "gemini-3.1-flash-lite" ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;

  return ai.models.generateContentStream({
    model,
    contents,
    config: {
      systemInstruction: opts.systemInstruction,
      thinkingConfig: { thinkingLevel },
      ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
    },
  });
}

export async function transcribeAudio(opts: {
  mimeType: string;
  data: string;
  language?: string;
}): Promise<string> {
  const beta = getBetaClient();
  const cleanMime = (opts.mimeType || "audio/webm").split(";")[0]?.trim() || "audio/webm";
  const isEs = (opts.language ?? "es-ES").startsWith("es");
  const contents = {
    parts: [
      {
        inlineData: {
          mimeType: cleanMime,
          data: opts.data,
        },
      },
      {
        text: isEs
          ? "Transcribe exactamente lo que dice la persona en este audio. Devuelve únicamente el texto hablado, sin comillas ni explicaciones. Si solo hay silencio o ruido sin palabras, responde vacío."
          : "Transcribe exactly what the speaker says in this audio. Return only the spoken words without quotes or commentary. If there is only silence or background noise with no speech, return empty.",
      },
    ],
  };

  let rawText = "";
  try {
    const response = await Promise.race([
      beta.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TRANSCRIBE_TIMEOUT")), 5500),
      ),
    ]);
    rawText = response.text ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const transient = /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|TRANSCRIBE_TIMEOUT/i.test(
      msg,
    );
    if (!transient) throw err;

    // Fast fallback to gemini-3.1-flash-lite with audio inlineData if 3.5-transcribe stalls or is busy
    const fallback = await getClient().models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });
    rawText = fallback.text ?? "";
  }

  const text = rawText.trim();
  if (/^(\[?(silencio|silence|inaudible|noise|ruido|empty)\]?|\.{1,3})$/i.test(text)) {
    return "";
  }
  return text;
}

export type GeminiVoiceName = "Kore" | "Zephyr" | "Puck" | "Charon" | "Fenrir";
const VALID_VOICES = new Set<GeminiVoiceName>(["Kore", "Zephyr", "Puck", "Charon", "Fenrir"]);

function ttsStyleForEmotion(emotion: string | undefined, isEs: boolean, custom?: string): string {
  if (custom?.trim()) return custom.trim();
  if (isEs) {
    switch (emotion) {
      case "angry":
        return "Voz humana real, molesta, intensa y firme, con tono enojado expresivo en español natural";
      case "laugh":
        return "Voz humana riendo con alegría espontánea, divertida y muy expresiva en español natural";
      case "happy":
        return "Voz humana cálida, feliz, sonriente, cercana y entusiasta en español natural";
      case "surprised":
        return "Voz humana sorprendida, espontánea y muy expresiva en español natural";
      case "sad":
        return "Voz humana suave, melancólica, empática y pausada en español natural";
      default:
        return "Voz humana realista, natural, cercana y conversacional con respiraciones y ritmo humano en español";
    }
  }
  switch (emotion) {
    case "angry":
      return "Realistic human voice, annoyed, intense, firm angry tone";
    case "laugh":
      return "Realistic human voice laughing warmly, joyful and spontaneous";
    case "happy":
      return "Realistic warm, cheerful, smiling conversational human voice";
    case "surprised":
      return "Realistic surprised, expressive spontaneous human voice";
    case "sad":
      return "Realistic soft, empathetic, melancholic human voice";
    default:
      return "Realistic, natural, expressive conversational human voice with subtle human pacing";
  }
}

export async function synthesizeSpeech(opts: {
  text: string;
  voiceName?: string | undefined;
  language?: string | undefined;
  style?: string | undefined;
  emotion?: string | undefined;
}): Promise<Buffer> {
  const ai = getBetaClient();
  const isEs = (opts.language ?? "es-ES").startsWith("es");
  const voiceName: GeminiVoiceName = VALID_VOICES.has(opts.voiceName as GeminiVoiceName)
    ? (opts.voiceName as GeminiVoiceName)
    : "Kore";

  const style = ttsStyleForEmotion(opts.emotion, isEs, opts.style);
  const cleanText = opts.text.trim();
  const expressiveText =
    opts.emotion === "laugh" && !cleanText.includes("<laugh>") ? `<laugh> ${cleanText}` : cleanText;

  const callTts = async (
    model: "gemini-3.8-flash-tts" | "gemini-3.8-flash-lite-tts",
    text: string,
  ) => {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text,
              speechMetadata: { style },
            },
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error("No se recibió audio del servicio de voz.");
    }
    return Buffer.from(base64Audio, "base64");
  };

  try {
    return await Promise.race([
      callTts("gemini-3.8-flash-tts", expressiveText),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TTS_TIMEOUT")), 6500)),
    ]);
  } catch {
    return await callTts("gemini-3.8-flash-lite-tts", cleanText);
  }
}

export type VisionFaceKeypoints = {
  detected: boolean;
  rightEye: [number, number];
  leftEye: [number, number];
  noseTip: [number, number];
  mouthCenter: [number, number];
  mouthLeft: [number, number];
  mouthRight: [number, number];
  chin: [number, number];
  forehead: [number, number];
  stylized: boolean;
};

export async function detectFaceKeypointsWithGemini(opts: {
  mimeType: string;
  data: string;
}): Promise<VisionFaceKeypoints | null> {
  const ai = getClient();
  const ptSchema = {
    type: Type.OBJECT,
    properties: {
      x: {
        type: Type.NUMBER,
        description: "Horizontal pixel coordinate scaled 0 (left) to 1000 (right)",
      },
      y: {
        type: Type.NUMBER,
        description: "Vertical pixel coordinate scaled 0 (top) to 1000 (bottom)",
      },
    },
    required: ["x", "y"],
  };

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: opts.mimeType || "image/jpeg",
            data: opts.data,
          },
        },
        {
          text: "Locate the main character's face in this image (works for real photos, 3D renders, anime, manga, or illustrations). Return pixel coordinates normalized 0..1000 (x: 0 left to 1000 right, y: 0 top to 1000 bottom) for both eyes, nose tip, mouth corners, mouth center, chin bottom, and top of forehead hairline. If no face exists, set detected=false.",
        },
      ],
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          detected: { type: Type.BOOLEAN },
          stylized: {
            type: Type.BOOLEAN,
            description: "True if anime, cartoon, drawing, or illustration",
          },
          eyeLeftSideOfImage: ptSchema,
          eyeRightSideOfImage: ptSchema,
          noseTip: ptSchema,
          mouthLeftCornerInImage: ptSchema,
          mouthRightCornerInImage: ptSchema,
          mouthCenter: ptSchema,
          chinBottom: ptSchema,
          foreheadTop: ptSchema,
        },
        required: [
          "detected",
          "stylized",
          "eyeLeftSideOfImage",
          "eyeRightSideOfImage",
          "noseTip",
          "mouthLeftCornerInImage",
          "mouthRightCornerInImage",
          "mouthCenter",
          "chinBottom",
          "foreheadTop",
        ],
      },
    },
  });

  const raw = response.text?.trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw) as {
    detected?: boolean;
    stylized?: boolean;
    eyeLeftSideOfImage?: { x: number; y: number };
    eyeRightSideOfImage?: { x: number; y: number };
    noseTip?: { x: number; y: number };
    mouthLeftCornerInImage?: { x: number; y: number };
    mouthRightCornerInImage?: { x: number; y: number };
    mouthCenter?: { x: number; y: number };
    chinBottom?: { x: number; y: number };
    foreheadTop?: { x: number; y: number };
  };
  if (!parsed.detected) return null;
  const norm = (p?: { x: number; y: number }): [number, number] | null =>
    p && Number.isFinite(p.x) && Number.isFinite(p.y)
      ? [Math.min(0.98, Math.max(0.02, p.x / 1000)), Math.min(0.98, Math.max(0.02, p.y / 1000))]
      : null;

  const rightEye = norm(parsed.eyeLeftSideOfImage);
  const leftEye = norm(parsed.eyeRightSideOfImage);
  const noseTip = norm(parsed.noseTip);
  const mouthLeft = norm(parsed.mouthLeftCornerInImage);
  const mouthRight = norm(parsed.mouthRightCornerInImage);
  const mouthCenter = norm(parsed.mouthCenter);
  const chin = norm(parsed.chinBottom);
  const forehead = norm(parsed.foreheadTop);
  if (
    !rightEye ||
    !leftEye ||
    !noseTip ||
    !mouthLeft ||
    !mouthRight ||
    !mouthCenter ||
    !chin ||
    !forehead
  ) {
    return null;
  }

  return {
    detected: true,
    stylized: !!parsed.stylized,
    rightEye,
    leftEye,
    noseTip,
    mouthCenter,
    mouthLeft,
    mouthRight,
    chin,
    forehead,
  };
}

export async function detectAvatarGenderWithGemini(opts: {
  mimeType: string;
  data: string;
}): Promise<"male" | "female"> {
  try {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: opts.mimeType || "image/jpeg",
              data: opts.data,
            },
          },
          {
            text: "Look at the main person or character in this portrait. Should their speaking voice be male or female? Reply strictly in JSON.",
          },
        ],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            gender: {
              type: Type.STRING,
              description: "Strictly 'male' or 'female'",
            },
          },
          required: ["gender"],
        },
      },
    });
    const parsed = JSON.parse(response.text?.trim() || "{}") as { gender?: string };
    return parsed.gender?.toLowerCase() === "male" ? "male" : "female";
  } catch {
    return "female";
  }
}
