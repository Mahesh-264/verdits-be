const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);

router.post('/send', upload.single('file'), chatController.sendMessage);
router.get('/conversations', chatController.getConversations);
router.get('/history/:partnerId', chatController.getHistory);
router.put('/read-all/:partnerId', chatController.markRead);
router.delete('/:id', chatController.deleteMessage);
// Add this to your existing chat routes file
router.post('/delete-batch', chatController.deleteBatch);
module.exports = router;