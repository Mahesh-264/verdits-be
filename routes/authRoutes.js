const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/send-otp', authController.sendOTP);
router.post('/verify-otp', authController.verifyOTP);
router.post('/refresh', authController.refresh);
router.get('/published-internships', authController.getPublishedInternships);
router.get('/published-jam-sessions', authController.getPublishedJamSessions);
router.get('/lawyers', authController.getLawyers);
router.get('/lawyers/:id', authController.getLawyerById);
router.use(protect);
router.get('/me', authController.getCurrentUser);
router.get('/students', authController.getStudents);
router.get('/lawyer/student-interactions', authorize('lawyer'), authController.getLawyerStudentInteractions);
router.post('/lawyer/internships', authorize('lawyer'), authController.createLawyerInternship);
router.post('/lawyer/jam-sessions', authorize('lawyer'), authController.createLawyerJamSession);
router.post('/follow-lawyer/:id', authController.toggleFollowLawyer);
router.post('/connect-student/:id', authController.sendStudentConnectionRequest);
router.post('/accept-student-request/:id', authController.acceptStudentConnectionRequest);
router.put('/update-profile', authController.updateProfile);
router.patch('/verify-lawyer/:id', authorize('admin'), authController.verifyLawyer);

module.exports = router;
