const { GoogleGenAI } = require("@google/genai");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const AI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 15000);

let geminiClient;

const getGeminiClient = () => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  return geminiClient;
};

const withTimeout = (promise, ms, label) => {
  let timeoutId;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${label} timed out after ${ms}ms`);
      error.code = "GEMINI_TIMEOUT";
      reject(error);
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
};

const extractTextFromResponse = (response) => {
  const directText = response?.text;
  if (typeof directText === "string" && directText.trim()) {
    return directText.trim();
  }

  const candidateText = response?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || "")
    .join("")
    .trim();

  if (candidateText) return candidateText;

  throw new Error("Gemini returned an empty response");
};

const generateGeminiText = async ({ prompt, temperature = 0.2, responseMimeType }) => {
  const config = { temperature };
  if (responseMimeType) config.responseMimeType = responseMimeType;

  const response = await withTimeout(
    getGeminiClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config,
    }),
    AI_TIMEOUT_MS,
    "Gemini request"
  );

  return extractTextFromResponse(response);
};

module.exports = { generateGeminiText };
