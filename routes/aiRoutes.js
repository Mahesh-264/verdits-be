const express = require("express");
const { chatWithAI, editNoticeDraft, generateNoticeDraft } = require("../controllers/aiController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.post("/chat", chatWithAI);
router.post("/notice/generate", authorize("lawyer"), generateNoticeDraft);
router.post("/notice/edit", authorize("lawyer"), editNoticeDraft);

module.exports = router;
