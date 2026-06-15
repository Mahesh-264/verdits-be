const { GoogleGenAI } = require("@google/genai");
const User = require("../models/User");

const VALID_CATEGORIES = [
  "criminal",
  "property",
  "family",
  "corporate",
  "cyber",
  "employment",
  "other",
];

const FALLBACK_REPLY =
  "I'm having trouble understanding your request right now. Please try again or consult a lawyer directly.";
const NON_LEGAL_REPLY =
  "I can only help with legal questions. Please ask about a legal issue such as contracts, property, family matters, criminal law, cyber fraud, employment, or court procedures.";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const AI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 15000);
const AI_MAX_RETRIES = 1;

const CATEGORY_ALIASES = {
  criminal: ["criminal", "crime", "ipc", "bail", "fir"],
  property: ["property", "civil", "land", "tenant", "rent", "real estate"],
  family: ["family", "divorce", "marriage", "custody", "maintenance"],
  corporate: ["corporate", "business", "company", "startup", "contract"],
  cyber: ["cyber", "fraud", "online scam", "digital", "data privacy"],
  employment: ["employment", "labour", "labor", "job", "workplace", "salary"],
  other: ["other"],
};

const getGeminiClient = () => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const withTimeout = (promise, ms, label = "Operation") =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const timeout = setTimeout(() => {
        clearTimeout(timeout);
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);
    }),
  ]);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeCategory = (category = "") => {
  const normalized = String(category).trim().toLowerCase();

  const mapping = {
    civil: "property",
    labour: "employment",
    labor: "employment",
    "labour law": "employment",
    "labor law": "employment",
    business: "corporate",
    company: "corporate",
    startup: "corporate",
    matrimonial: "family",
    marriage: "family",
    divorce: "family",
    tenancy: "property",
    tenant: "property",
    rent: "property",
    scam: "cyber",
    fraud: "cyber",
  };

  const mapped = mapping[normalized] || normalized;
  return VALID_CATEGORIES.includes(mapped) ? mapped : "other";
};

const isLegalRelatedQuery = (text = "") => {
  const msg = String(text).toLowerCase();

  return /(law|legal|lawyer|advocate|attorney|court|judge|case|petition|notice|agreement|contract|clause|rights|liability|sue|lawsuit|complaint|fir|police|arrest|bail|crime|criminal|theft|assault|cheating|forgery|property|land|tenant|rent|lease|eviction|divorce|marriage|custody|maintenance|alimony|domestic violence|company|business|startup|shareholder|director|compliance|employment|employee|employer|salary|termination|wages|labour|labor|harassment|cyber|fraud|scam|phishing|upi|otp|data privacy|will|inheritance|consumer|trademark|copyright|patent|tax|gst|document|deed|affidavit|notary|legal notice|dispute|settlement|appeal|tribunal|arbitration|mediation)/i.test(
    msg
  );
};

const detectCategoryFromText = (text = "") => {
  const msg = String(text).toLowerCase();

  if (
    /(murder|theft|police|arrest|fir|crime|assault|bail|cheating|kidnap|violence|forgery|dowry harassment|domestic violence criminal)/i.test(
      msg
    )
  ) {
    return "criminal";
  }

  if (
    /(land|property|rent|tenant|owner|house|flat|builder|sale deed|partition|encroachment|lease|eviction|mutation|registry|real estate|civil)/i.test(
      msg
    )
  ) {
    return "property";
  }

  if (
    /(divorce|marriage|custody|family|alimony|maintenance|domestic violence|matrimonial|child support|adoption)/i.test(
      msg
    )
  ) {
    return "family";
  }

  if (
    /(company|business|startup|contract|shareholder|director|compliance|incorporation|vendor agreement|llp|mou|board|corporate)/i.test(
      msg
    )
  ) {
    return "corporate";
  }

  if (
    /(hack|hacked|fraud|scam|online|cyber|phishing|otp|identity theft|data breach|social media|upi fraud|digital arrest)/i.test(
      msg
    )
  ) {
    return "cyber";
  }

  if (
    /(job|salary|employee|employer|fired|termination|work|office|wages|pf|gratuity|harassment at work|labour|labor|employment)/i.test(
      msg
    )
  ) {
    return "employment";
  }

  return "other";
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

  if (candidateText) {
    return candidateText;
  }

  throw new Error(
    `Gemini returned empty content: ${JSON.stringify(response || {}).slice(0, 1000)}`
  );
};

const extractJsonObject = (value = "") => {
  const trimmed = String(value).trim();

  if (!trimmed) {
    throw new Error("Empty AI response");
  }

  const cleaned = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (parseError) {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");

    if (first !== -1 && last !== -1 && first < last) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }

    throw new Error(`Invalid JSON from AI: ${cleaned.slice(0, 500)}`);
  }
};

const sanitizeReply = (reply = "") => {
  const text = String(reply).replace(/\s+/g, " ").trim();
  return text || FALLBACK_REPLY;
};

const buildPrompt = (message) => `
You are Lawin AI, a legal assistant for an Indian legal platform.

Your job:
1. Answer only legal questions.
2. Give a short, simple, practical answer in plain English.
3. Classify the issue into exactly one category:
criminal, property, family, corporate, cyber, employment, other

Rules:
- If the user asks about anything unrelated to law or legal rights, set "reply" to: "${NON_LEGAL_REPLY}"
- For non-legal questions, set "category" to "other".
- Return ONLY valid JSON.
- Do not use markdown.
- Do not wrap the response in backticks.
- Do not include any text before or after the JSON.
- "reply" must be a concise helpful explanation for a normal user.
- "category" must be exactly one of:
  criminal, property, family, corporate, cyber, employment, other
- If unsure, use "other".

Return exactly this schema:
{"reply":"string","category":"criminal|property|family|corporate|cyber|employment|other"}

User legal question:
${message}
`.trim();

const buildNoticePrompt = ({ documentType, details, lawyer }) => `
You are Lawin AI drafting assistant for an Indian lawyer.

Draft a professional ${documentType} using the facts below.

Rules:
- Return only the final document text.
- Do not use markdown fences.
- Use formal legal notice style suitable for India.
- Include placeholders like [date] only when the fact is missing.
- Keep the language clear, assertive, and editable.
- Do not invent case numbers, addresses, statutes, or dates that were not provided.
- Add a short "Subject" line.
- Add numbered paragraphs and a clear demand/compliance section.
- End with "For and on behalf of" and the lawyer details if available.

Lawyer:
Name: ${lawyer?.name || [lawyer?.firstName, lawyer?.lastName].filter(Boolean).join(" ").trim() || "Advocate"}
Specialization: ${lawyer?.lawyerProfile?.specialization || "Legal Practice"}
Bar Council ID: ${lawyer?.lawyerProfile?.barId || ""}
Location: ${lawyer?.address?.city || lawyer?.address?.district || lawyer?.address?.state || ""}

Document facts:
${details}
`.trim();

const buildNoticeEditPrompt = ({ documentType, currentDraft, editInstruction, lawyer }) => `
You are Lawin AI drafting assistant for an Indian lawyer.

Revise the existing ${documentType || "legal notice"} according to the lawyer's edit instruction.

Rules:
- Return only the revised full document text.
- Preserve useful legal structure and formal tone.
- Apply the requested changes exactly.
- Do not add facts that are not in the current draft or instruction.
- Do not use markdown fences.

Lawyer:
Name: ${lawyer?.name || [lawyer?.firstName, lawyer?.lastName].filter(Boolean).join(" ").trim() || "Advocate"}

Edit instruction:
${editInstruction}

Current draft:
${currentDraft}
`.trim();

const buildLawyerRegex = (category) => {
  const aliases = CATEGORY_ALIASES[category] || [category];
  return new RegExp(aliases.map(escapeRegex).join("|"), "i");
};

const fetchSuggestedLawyers = async (category) => {
  if (category === "other") {
    return [];
  }

  const regex = buildLawyerRegex(category);

  const lawyers = await User.find({
    role: { $in: ["lawyer", "LAWYER"] },
    "lawyerProfile.specialization": regex,
  })
    .select("firstName lastName lawyerProfile.specialization profileImage")
    .limit(3)
    .lean({ virtuals: true });

  return lawyers.map((lawyer) => ({
    _id: lawyer._id,
    name:
      lawyer.name ||
      [lawyer.firstName, lawyer.lastName].filter(Boolean).join(" ").trim() ||
      "Lawyer",
    specialization: lawyer.lawyerProfile?.specialization || category,
    profileImage: lawyer.profileImage || "",
  }));
};

const callGeminiOnce = async (message) => {
  const ai = getGeminiClient();

  const response = await withTimeout(
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: buildPrompt(message) }],
        },
      ],
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
    AI_TIMEOUT_MS,
    "Gemini request"
  );

  const rawText = extractTextFromResponse(response);
  const parsed = extractJsonObject(rawText);

  return {
    rawText,
    parsed,
  };
};

const callGeminiText = async (prompt, temperature = 0.2) => {
  const ai = getGeminiClient();

  const response = await withTimeout(
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      config: { temperature },
    }),
    AI_TIMEOUT_MS,
    "Gemini notice request"
  );

  return extractTextFromResponse(response);
};

const getAICompletion = async (message) => {
  let lastError;

  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt += 1) {
    try {
      console.log(
        `[AI] Gemini attempt ${attempt + 1}/${AI_MAX_RETRIES + 1} using model ${GEMINI_MODEL}`
      );

      const result = await callGeminiOnce(message);

      console.log("[AI] Gemini raw response:", result.rawText);

      return result.parsed;
    } catch (error) {
      lastError = error;
      console.error(
        `[AI] Gemini attempt ${attempt + 1} failed:`,
        error?.message || error
      );

      if (attempt < AI_MAX_RETRIES) {
        await delay(400);
      }
    }
  }

  throw lastError;
};

exports.chatWithAI = async (req, res) => {
  const incomingMessage = String(req.body?.message || "").trim();

  if (!incomingMessage) {
    return res.status(400).json({ message: "Message is required" });
  }

  console.log("[AI] Incoming legal query:", incomingMessage);

  try {
    if (!isLegalRelatedQuery(incomingMessage)) {
      console.log("[AI] Rejected non-legal query");

      return res.status(200).json({
        reply: NON_LEGAL_REPLY,
        category: "other",
        lawyers: [],
      });
    }

    let reply = FALLBACK_REPLY;
    let category = "other";
    let aiUsed = false;

    try {
      const parsed = await getAICompletion(incomingMessage);

      reply = sanitizeReply(parsed?.reply);
      category = normalizeCategory(parsed?.category);
      aiUsed = true;

      if (category === "other") {
        const detected = detectCategoryFromText(incomingMessage);
        if (detected !== "other") {
          console.warn(
            `[AI] AI returned "other". Keyword fallback upgraded category to "${detected}".`
          );
          category = detected;
        }
      }
    } catch (aiError) {
      console.error("[AI] Final Gemini failure:", aiError?.message || aiError);
      category = detectCategoryFromText(incomingMessage);
      console.warn(`[AI] Using fallback keyword category: ${category}`);
    }

    const lawyers = await fetchSuggestedLawyers(category);

    console.log("[AI] Final response meta:", {
      aiUsed,
      category,
      lawyersFound: lawyers.length,
    });

    return res.status(200).json({
      reply,
      category,
      lawyers,
    });
  } catch (error) {
    console.error("[AI] chatWithAI controller failure:", error?.stack || error);

    return res.status(200).json({
      reply: FALLBACK_REPLY,
      category: "other",
      lawyers: [],
    });
  }
};

exports.generateNoticeDraft = async (req, res) => {
  try {
    if (req.user?.role !== "lawyer") {
      return res.status(403).json({ message: "Only lawyers can generate legal notices" });
    }

    const documentType = String(req.body?.documentType || "").trim();
    const details = String(req.body?.details || "").trim();

    if (!documentType || !details) {
      return res.status(400).json({ message: "Document type and details are required" });
    }

    const draft = await callGeminiText(
      buildNoticePrompt({ documentType, details, lawyer: req.user }),
      0.15
    );

    res.json({ documentType, draft });
  } catch (error) {
    console.error("[AI] notice generation failed:", error?.message || error);
    res.status(500).json({ message: "Failed to generate notice draft" });
  }
};

exports.editNoticeDraft = async (req, res) => {
  try {
    if (req.user?.role !== "lawyer") {
      return res.status(403).json({ message: "Only lawyers can edit legal notices" });
    }

    const documentType = String(req.body?.documentType || "").trim();
    const currentDraft = String(req.body?.currentDraft || "").trim();
    const editInstruction = String(req.body?.editInstruction || "").trim();

    if (!currentDraft || !editInstruction) {
      return res.status(400).json({ message: "Current draft and edit instruction are required" });
    }

    const draft = await callGeminiText(
      buildNoticeEditPrompt({ documentType, currentDraft, editInstruction, lawyer: req.user }),
      0.1
    );

    res.json({ documentType, draft });
  } catch (error) {
    console.error("[AI] notice edit failed:", error?.message || error);
    res.status(500).json({ message: "Failed to edit notice draft" });
  }
};
