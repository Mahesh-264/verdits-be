const express = require("express");
const { chatWithAI } = require("../controllers/aiController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.post("/chat", chatWithAI);

module.exports = router;
