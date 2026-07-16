const { generateGeminiText } = require("./geminiService");
const { buildNoticePrompt, buildNoticeEditPrompt } = require("./noticePrompt");

const generateNoticeDraft = ({ documentType, basicInformation, lawyer }) =>
  generateGeminiText({
    prompt: buildNoticePrompt({ documentType, basicInformation, lawyer }),
    temperature: 0.15,
  });

const editNoticeDraft = ({ documentType, currentDraft, editInstruction }) =>
  generateGeminiText({
    prompt: buildNoticeEditPrompt({ documentType, currentDraft, editInstruction }),
    temperature: 0.1,
  });

module.exports = { generateNoticeDraft, editNoticeDraft };
