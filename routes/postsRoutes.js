const express = require('express');
const multer = require('multer');
const postsController = require('../controllers/postsController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);

router.post(
  '/create',
  authorize('student', 'lawyer'),
  upload.array('images', 3),
  postsController.createPost
);
router.get('/feed', authorize('student', 'lawyer'), postsController.getFeed);
router.get('/user/:id', authorize('student', 'lawyer'), postsController.getUserPosts);

module.exports = router;
