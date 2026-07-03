const express = require('express');
const multer = require('multer');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  authLimiter,
  loginLimiter,
  otpLimiter,
} = require('../middleware/authRateLimiters');

const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const allowedTypes = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);

    if (allowedTypes.has(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(new Error('Resume must be a PDF, DOC, or DOCX file'));
  },
});

router.post('/register', authLimiter, authController.register);
router.post('/login', loginLimiter, authController.login);
router.post('/google', loginLimiter, authController.googleAuth);
router.post('/forgot-password', otpLimiter, authController.forgotPassword);
router.post('/reset-password', otpLimiter, authController.resetPassword);
router.post('/logout', authController.logout);
router.get('/location/pincode/:pincode', authController.lookupPincode);
router.post('/location/geocode', authController.geocodeRegistrationAddress);
router.get('/location/reverse-geocode', authController.reverseGeocodeRegistrationAddress);
router.post('/send-otp', otpLimiter, authController.sendOTP);
router.post('/verify-phone-otp', otpLimiter, authController.verifyPhoneOTP);
router.post('/verify-otp', otpLimiter, authController.verifyOTP);
router.post('/resend-otp', otpLimiter, authController.resendOTP);
router.post('/refresh', authController.refresh);
router.get('/published-internships', authController.getPublishedInternships);
router.get('/published-jam-sessions', authController.getPublishedJamSessions);
router.get('/lawyers', authController.getLawyers);
router.get('/lawyers/nearby', authController.getNearbyLawyers);
router.get('/lawyers/:id', authController.getLawyerById);
router.use(protect);
router.get('/me', authController.getCurrentUser);
router.get('/students', authController.getStudents);
router.get('/student/discovery', authorize('student'), authController.getStudentDiscovery);
router.post('/student/internships/:postId/apply', authorize('student'), resumeUpload.single('resumeFile'), authController.applyToInternship);
router.post('/student/jam-sessions/:sessionId/join', authorize('student'), authController.joinJamSession);
router.post('/jam-sessions/:sessionId/like', authorize('student', 'lawyer'), authController.toggleJamSessionLike);
router.post('/jam-sessions/:sessionId/comments', authorize('student', 'lawyer'), authController.addJamSessionComment);
router.get('/lawyer/student-interactions', authorize('lawyer'), authController.getLawyerStudentInteractions);
router.post('/lawyer/internships', authorize('lawyer'), authController.createLawyerInternship);
router.post('/lawyer/jam-sessions', authorize('lawyer'), authController.createLawyerJamSession);
router.post('/lawyer/internships/:postId/like', authorize('student', 'lawyer'), authController.toggleInternshipLike);
router.post('/lawyer/internships/:postId/comments', authorize('student', 'lawyer'), authController.addInternshipComment);
router.patch('/lawyer/internships/:postId/toggle-status', authorize('lawyer'), authController.toggleInternshipStatus);
router.delete('/lawyer/internships/:postId', authorize('lawyer'), authController.deleteLawyerInternship);
router.patch('/lawyer/internships/:postId/applicants/:applicationId/status', authorize('lawyer'), authController.updateInternshipApplicantStatus);
router.post('/follow-lawyer/:id', authController.toggleFollowLawyer);
router.post('/connect-student/:id', authController.sendStudentConnectionRequest);
router.post('/accept-student-request/:id', authController.acceptStudentConnectionRequest);
router.put('/update-profile', authController.updateProfile);
router.patch('/verify-lawyer/:id', authorize('admin'), authController.verifyLawyer);

module.exports = router;
