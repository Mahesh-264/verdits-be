const express = require('express');
const teamController = require('../controllers/teamController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(protect, authorize('lawyer'));

router.get('/workspace', teamController.getWorkspace);
router.post('/', teamController.createTeam);
router.post('/join-requests', teamController.requestToJoin);
router.patch('/:teamId/join-requests/:requestId/:decision', teamController.decideJoinRequest);
router.delete('/:teamId/members/:memberId', teamController.removeMember);
router.post('/:teamId/cases', teamController.createCase);
router.patch('/:teamId/cases/:caseId', teamController.updateCase);
router.delete('/:teamId/cases/:caseId', teamController.deleteCase);
router.post('/:teamId/cases/:caseId/hearings', teamController.createHearing);
router.patch('/:teamId/cases/:caseId/hearings/:hearingId', teamController.updateHearing);
router.delete('/:teamId/cases/:caseId/hearings/:hearingId', teamController.deleteHearing);

module.exports = router;
