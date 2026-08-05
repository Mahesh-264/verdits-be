const crypto = require('crypto');
const mongoose = require('mongoose');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const TeamJoinRequest = require('../models/TeamJoinRequest');
const Client = require('../models/Client');
const LegalCase = require('../models/Case');
const Hearing = require('../models/Hearing');
const CaseDocument = require('../models/CaseDocument');
const User = require('../models/User');
const { createNotification, getDisplayName } = require('../services/notificationService');
const { recordActivity } = require('../services/activityService');
const { emitTeamEvent } = require('../services/teamRealtimeService');
const { runInTransaction } = require('../utils/transaction');
const {
  assertObjectId,
  domainError,
  getCaseReadScope,
  requireActiveMembership,
  requireCaseAccess,
  requireTeamOwner,
} = require('../services/teamAuthorizationService');

const trim = (value) => String(value || '').trim();
const requestId = (req) => req.headers['x-request-id'] || '';
const caseStatuses = new Set(['new', 'in_progress', 'hearing_scheduled', 'closed']);

const generateTeamCode = async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const joinCode = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    if (!(await Team.exists({ teamCode: joinCode }))) return joinCode;
  }
  throw domainError(500, 'Unable to generate a team code');
};

const parseDocuments = (value) => {
  const records = Array.isArray(value) ? value : String(value || '').split('\n');
  return records.map((item) => {
    if (typeof item === 'string') return { name: trim(item), url: trim(item) };
    return { name: trim(item?.name) || trim(item?.url), url: trim(item?.url) };
  }).filter((item) => item.name && item.url);
};

const formatMember = (member) => ({
  id: String(member._id),
  lawyerId: member.userId?._id || member.userId,
  name: getDisplayName(member.userId, 'Lawyer'),
  email: member.userId?.email || '',
  phone: member.userId?.phone || '',
  role: member.role,
  joinedAt: member.joinedAt,
});

const formatCase = (legalCase, documents = [], viewerId) => {
  const caseName = legalCase.caseName || legalCase.title || legalCase.caseTitle || '';
  const briefInfo = legalCase.briefInfo || legalCase.details || legalCase.caseDetails || '';
  return {
    id: String(legalCase._id),
    clientId: legalCase.clientId || null,
    clientName: legalCase.clientName || '',
    clientPhone: legalCase.clientPhone || '',
    clientAddress: legalCase.clientAddress || '',
    caseName,
    caseTitle: caseName,
    title: caseName,
    briefInfo,
    caseDetails: briefInfo,
    courtName: legalCase.courtName || '',
    startingDate: legalCase.startingDate || null,
    nextHearingDate: legalCase.nextHearingAt || legalCase.nextHearingDate || null,
    hearingDate: legalCase.nextHearingAt || legalCase.startingDate || null,
    documents: documents.map((document) => ({ id: String(document._id), name: document.name, url: document.url })),
    status: legalCase.status,
    addedBy: legalCase.ownerId,
    addedByName: getDisplayName(legalCase.ownerId, 'Lawyer'),
    canEdit: String(legalCase.ownerId?._id || legalCase.ownerId) === String(viewerId),
    createdAt: legalCase.createdAt,
    updatedAt: legalCase.updatedAt,
  };
};

const getWorkspace = async (userId, selectedTeamId) => {
  const memberships = await TeamMember.find({ userId, status: 'active' }).lean();
  const teamIds = memberships.map((member) => member.teamId);
  const teams = await Team.find({ _id: { $in: teamIds }, status: 'active' }).sort({ updatedAt: -1 }).lean();
  if (!teams.length) return { team: null, teams: [], activeTeamId: null };

  const selected = selectedTeamId && teams.find((team) => String(team._id) === String(selectedTeamId));
  const activeTeam = selected || teams[0];
  const membershipByTeam = new Map(memberships.map((member) => [String(member.teamId), member]));
  const activeMembership = membershipByTeam.get(String(activeTeam._id));
  const [memberRecords, pendingRequests, legalCases] = await Promise.all([
    TeamMember.find({ teamId: activeTeam._id, status: 'active' })
      .populate('userId', 'firstName lastName email phone profileImage role')
      .sort({ role: 1, joinedAt: 1 }).lean(),
    activeMembership.role === 'owner'
      ? TeamJoinRequest.find({ teamId: activeTeam._id, status: 'pending' })
        .populate('requesterId', 'firstName lastName email phone').sort({ requestedAt: -1 }).lean()
      : [],
    LegalCase.find(getCaseReadScope({ teamId: activeTeam._id, userId, membership: activeMembership }))
      .populate('ownerId', 'firstName lastName phone').sort({ updatedAt: -1 }).limit(100).lean(),
  ]);
  const caseIds = legalCases.map((legalCase) => legalCase._id);
  const documents = caseIds.length
    ? await CaseDocument.find({ caseId: { $in: caseIds }, deletedAt: null }).sort({ createdAt: -1 }).lean()
    : [];
  const documentsByCase = documents.reduce((map, document) => {
    const key = String(document.caseId);
    map.set(key, [...(map.get(key) || []), document]);
    return map;
  }, new Map());
  const members = memberRecords.filter((member) => member.role === 'member').map(formatMember);
  const workspace = {
    id: String(activeTeam._id),
    role: activeMembership.role,
    teamCode: activeTeam.teamCode,
    firmName: activeTeam.firmName,
    seniorLawyerName: activeTeam.seniorLawyerName,
    maxTeamSize: activeTeam.maxTeamSize,
    seniorLawyer: activeTeam.ownerId || activeTeam.owner,
    members,
    pendingRequests: pendingRequests.map((item) => ({
      id: String(item._id), lawyerId: item.requesterId?._id || item.requesterId,
      name: getDisplayName(item.requesterId, 'Lawyer'), email: item.requesterId?.email || '',
      phone: item.requesterId?.phone || '', requestedAt: item.requestedAt,
    })),
    cases: legalCases.map((legalCase) => formatCase(legalCase, documentsByCase.get(String(legalCase._id)) || [], userId)),
    createdAt: activeTeam.createdAt,
    updatedAt: activeTeam.updatedAt,
  };
  return {
    team: workspace,
    teams: teams.map((team) => ({ id: String(team._id), teamCode: team.teamCode, firmName: team.firmName, role: membershipByTeam.get(String(team._id)).role })),
    activeTeamId: String(activeTeam._id),
  };
};

exports.getWorkspace = async (req, res) => {
  try { res.json(await getWorkspace(req.user._id, req.query.teamId)); }
  catch (error) { res.status(error.statusCode || 500).json({ message: error.message }); }
};

exports.createTeam = async (req, res) => {
  try {
    const firmName = trim(req.body.firmName);
    const seniorLawyerName = trim(req.body.seniorLawyerName) || getDisplayName(req.user, 'Team Owner');
    const maxTeamSize = Number(req.body.maxTeamSize);
    if (!firmName || !Number.isInteger(maxTeamSize) || maxTeamSize < 2) throw domainError(400, 'Firm name and a team size of at least 2 are required');
    const teamCode = await generateTeamCode();
    const team = await runInTransaction(async (session) => {
      const [created] = await Team.create([{ teamCode, firmName, seniorLawyerName, maxTeamSize, owner: req.user._id, ownerId: req.user._id, createdBy: req.user._id }], { session });
      await TeamMember.create([{ teamId: created._id, userId: req.user._id, role: 'owner', addedBy: req.user._id }], { session });
      await recordActivity({ teamId: created._id, actorId: req.user._id, entityType: 'team', entityId: created._id, action: 'team.created', after: { firmName, teamCode }, requestId: requestId(req), session });
      return created;
    });
    emitTeamEvent({ io: req.app.get('socketio'), recipientIds: [req.user._id], event: 'team:created', teamId: team._id, payload: { team: { id: String(team._id), firmName, teamCode } } });
    res.status(201).json({ message: 'Team created', ...(await getWorkspace(req.user._id, team._id)) });
  } catch (error) { res.status(error.statusCode || 500).json({ message: error.message }); }
};

exports.requestToJoin = async (req, res) => {
  try {
    const teamCode = trim(req.body.teamCode).toUpperCase();
    if (!teamCode) throw domainError(400, 'Team code is required');
    const team = await Team.findOne({ teamCode, status: 'active' }).lean();
    if (!team) throw domainError(404, 'Team not found');
    if (String(team.ownerId || team.owner) === String(req.user._id)) throw domainError(400, 'You already own this team');
    const result = await runInTransaction(async (session) => {
      const member = await TeamMember.findOne({ teamId: team._id, userId: req.user._id, status: 'active' }).session(session);
      if (member) throw domainError(409, 'You are already a member of this team');
      const activeCount = await TeamMember.countDocuments({ teamId: team._id, status: 'active' }).session(session);
      if (activeCount >= team.maxTeamSize) throw domainError(409, 'This team is already full');
      const request = await TeamJoinRequest.findOneAndUpdate(
        { teamId: team._id, requesterId: req.user._id, status: 'pending' },
        { $setOnInsert: { requestedAt: new Date() } }, { upsert: true, new: true, session, setDefaultsOnInsert: true }
      );
      await recordActivity({ teamId: team._id, actorId: req.user._id, entityType: 'team_join_request', entityId: request._id, action: 'team.join_request.created', requestId: requestId(req), session });
      return request;
    });
    const teamOwnerId = team.ownerId || team.owner;
    await createNotification({ recipient: teamOwnerId, actor: req.user._id, type: 'team_join_request', title: 'New team join request', message: `${getDisplayName(req.user)} requested to join ${team.firmName}.`, link: `/lawyer-dash?section=team&teamId=${team._id}`, metadata: { teamId: team._id, requestId: result._id }, io: req.app.get('socketio') });
    emitTeamEvent({ io: req.app.get('socketio'), recipientIds: [teamOwnerId], event: 'team:join-request-created', teamId: team._id, payload: { requestId: String(result._id) } });
    res.status(202).json({ message: 'Join request sent to the Team Owner', requestPending: true, requestId: result._id });
  } catch (error) { res.status(error.statusCode || 500).json({ message: error.message }); }
};

exports.decideJoinRequest = async (req, res) => {
  try {
    assertObjectId(req.params.teamId, 'Team'); assertObjectId(req.params.requestId, 'Join request');
    const approved = req.params.decision === 'approve';
    if (!approved && req.params.decision !== 'reject') throw domainError(400, 'Invalid join request decision');
    const result = await runInTransaction(async (session) => {
      const { team } = await requireTeamOwner(req.params.teamId, req.user._id, { session });
      const joinRequest = await TeamJoinRequest.findOne({ _id: req.params.requestId, teamId: team._id, status: 'pending' }).session(session);
      if (!joinRequest) throw domainError(404, 'Pending join request not found');
      if (approved) {
        const activeCount = await TeamMember.countDocuments({ teamId: team._id, status: 'active' }).session(session);
        if (activeCount >= team.maxTeamSize) throw domainError(409, 'This team is already full');
        await TeamMember.findOneAndUpdate({ teamId: team._id, userId: joinRequest.requesterId }, { $set: { role: 'member', status: 'active', joinedAt: new Date(), leftAt: null, addedBy: req.user._id, removedBy: null, removalReason: '' } }, { upsert: true, new: true, session, setDefaultsOnInsert: true });
      }
      joinRequest.status = approved ? 'approved' : 'rejected'; joinRequest.decidedAt = new Date(); joinRequest.decidedBy = req.user._id; joinRequest.decisionReason = trim(req.body.reason); await joinRequest.save({ session });
      await recordActivity({ teamId: team._id, actorId: req.user._id, entityType: 'team_join_request', entityId: joinRequest._id, action: approved ? 'team.join_request.approved' : 'team.join_request.rejected', after: { requesterId: joinRequest.requesterId }, requestId: requestId(req), session });
      return { team, joinRequest };
    });
    const type = approved ? 'team_join_accepted' : 'team_join_rejected';
    await createNotification({ recipient: result.joinRequest.requesterId, actor: req.user._id, type, title: approved ? 'Team request accepted' : 'Team request rejected', message: `${getDisplayName(req.user)} ${approved ? 'accepted' : 'rejected'} your request to join ${result.team.firmName}.`, link: `/lawyer-dash?section=team&teamId=${result.team._id}`, metadata: { teamId: result.team._id }, io: req.app.get('socketio') });
    emitTeamEvent({ io: req.app.get('socketio'), recipientIds: [req.user._id, result.joinRequest.requesterId], event: approved ? 'team:member-joined' : 'team:join-request-rejected', teamId: result.team._id, payload: { userId: String(result.joinRequest.requesterId) } });
    res.json({ message: approved ? 'Join request approved' : 'Join request rejected', ...(await getWorkspace(req.user._id, result.team._id)) });
  } catch (error) { res.status(error.statusCode || 500).json({ message: error.message }); }
};

exports.removeMember = async (req, res) => {
  try {
    assertObjectId(req.params.teamId, 'Team'); assertObjectId(req.params.memberId, 'Member');
    const result = await runInTransaction(async (session) => {
      const { team } = await requireTeamOwner(req.params.teamId, req.user._id, { session });
      if (String(team.ownerId || team.owner) === String(req.params.memberId)) throw domainError(400, 'The Team Owner cannot be removed');
      const member = await TeamMember.findOne({ teamId: team._id, userId: req.params.memberId, role: 'member', status: 'active' }).session(session);
      if (!member) throw domainError(404, 'Active Team Member not found');
      member.status = 'removed'; member.leftAt = new Date(); member.removedBy = req.user._id; member.removalReason = trim(req.body.reason); await member.save({ session });
      await recordActivity({ teamId: team._id, actorId: req.user._id, entityType: 'team_member', entityId: member._id, action: 'team.member.removed', after: { userId: member.userId }, requestId: requestId(req), session });
      return { team, member };
    });
    await createNotification({ recipient: result.member.userId, actor: req.user._id, type: 'team_member_removed', title: 'Removed from team', message: `${getDisplayName(req.user)} removed you from ${result.team.firmName}.`, link: '/lawyer-dash?section=team', metadata: { teamId: result.team._id }, io: req.app.get('socketio') });
    emitTeamEvent({ io: req.app.get('socketio'), recipientIds: [req.user._id, result.member.userId], event: 'team:member-left', teamId: result.team._id, payload: { userId: String(result.member.userId) } });
    res.json({ message: 'Team Member removed', ...(await getWorkspace(req.user._id, result.team._id)) });
  } catch (error) { res.status(error.statusCode || 500).json({ message: error.message }); }
};

exports.createCase = async (req, res) => {
  try {
    assertObjectId(req.params.teamId, 'Team');
    const title = trim(req.body.caseTitle || req.body.title); const details = trim(req.body.caseDetails || req.body.details); const clientName = trim(req.body.clientName);
    if (!title || !details || !clientName) throw domainError(400, 'Client name, case title, and case details are required');
    const status = trim(req.body.status) || 'new'; if (!caseStatuses.has(status)) throw domainError(400, 'Invalid case status');
    const hearingDate = req.body.hearingDate ? new Date(req.body.hearingDate) : null; if (hearingDate && Number.isNaN(hearingDate.getTime())) throw domainError(400, 'Invalid hearing date');
    const result = await runInTransaction(async (session) => {
      await requireActiveMembership(req.params.teamId, req.user._id, { session });
      let clientId = null;
      if (req.body.clientId) { assertObjectId(req.body.clientId, 'Client'); const client = await Client.findOne({ _id: req.body.clientId, teamId: req.params.teamId, status: 'active' }).session(session); if (!client) throw domainError(404, 'Client not found'); clientId = client._id; }
      const [legalCase] = await LegalCase.create([{ teamId: req.params.teamId, clientId, clientName, title, details, basicInfo: trim(req.body.basicInfo), courtName: trim(req.body.courtName), status, nextHearingAt: hearingDate, ownerId: req.user._id, createdBy: req.user._id, updatedBy: req.user._id }], { session });
      const documents = parseDocuments(req.body.documents);
      if (documents.length) await CaseDocument.insertMany(documents.map((document) => ({ teamId: req.params.teamId, caseId: legalCase._id, ...document, uploadedBy: req.user._id })), { session });
      await recordActivity({ teamId: req.params.teamId, caseId: legalCase._id, actorId: req.user._id, entityType: 'case', entityId: legalCase._id, action: 'case.created', after: { title, status }, requestId: requestId(req), session });
      return legalCase;
    });
    const membership = await TeamMember.findOne({ teamId: req.params.teamId, userId: req.user._id, status: 'active' }).lean();
    const team = await Team.findById(req.params.teamId).lean();
    emitTeamEvent({ io: req.app.get('socketio'), recipientIds: [req.user._id, team.ownerId || team.owner], event: 'case:created', teamId: req.params.teamId, payload: { caseId: String(result._id), ownerId: String(req.user._id) } });
    res.status(201).json({ message: 'Case created', case: formatCase(result, [], req.user._id), membershipRole: membership.role });
  } catch (error) {
    console.error('CREATE CASE ERROR');
    console.error(error);
    console.error(error.message);
    console.error(error.stack);

    if (error?.name?.startsWith('Mongo') || error?.code || error?.codeName || error?.errorLabels || error?.cause) {
      console.error('CREATE CASE MONGODB ERROR DETAILS', {
        code: error.code,
        codeName: error.codeName,
        errorLabels: error.errorLabels,
        cause: error.cause,
      });
    }

    if (error?.name === 'ValidationError' || error?.errors) {
      console.error('CREATE CASE VALIDATION DETAILS', Object.fromEntries(
        Object.entries(error.errors || {}).map(([path, detail]) => [path, {
          kind: detail.kind,
          message: detail.message,
          name: detail.name,
          value: detail.value,
        }])
      ));
    }

    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.updateCase = async (req, res) => {
  try {
    assertObjectId(req.params.teamId, 'Team');
    const { legalCase, team } = await requireCaseAccess(req.params.caseId, req.params.teamId, req.user._id, 'write');
    const allowed = { title: 'caseTitle', details: 'caseDetails', basicInfo: 'basicInfo', courtName: 'courtName', status: 'status', nextHearingAt: 'hearingDate' };
    const before = {}; const changedFields = [];
    Object.entries(allowed).forEach(([field, bodyField]) => {
      if (req.body[bodyField] === undefined && req.body[field] === undefined) return;
      let value = req.body[bodyField] ?? req.body[field];
      if (field === 'status') { value = trim(value); if (!caseStatuses.has(value)) throw domainError(400, 'Invalid case status'); }
      else if (field === 'nextHearingAt') { value = value ? new Date(value) : null; if (value && Number.isNaN(value.getTime())) throw domainError(400, 'Invalid hearing date'); }
      else value = trim(value);
      if (String(legalCase[field] || '') !== String(value || '')) { before[field] = legalCase[field]; legalCase[field] = value; changedFields.push(field); }
    });
    if (!changedFields.length) throw domainError(400, 'No editable case fields were supplied');
    legalCase.updatedBy = req.user._id; await legalCase.save();
    await recordActivity({ teamId: team._id, caseId: legalCase._id, actorId: req.user._id, entityType: 'case', entityId: legalCase._id, action: 'case.updated', changedFields, before, after: changedFields.reduce((data, field) => ({ ...data, [field]: legalCase[field] }), {}), requestId: requestId(req) });
    emitTeamEvent({ io: req.app.get('socketio'), recipientIds: [req.user._id, team.ownerId || team.owner], event: changedFields.includes('status') ? 'case:status-changed' : 'case:updated', teamId: team._id, payload: { caseId: String(legalCase._id), ownerId: String(legalCase.ownerId), changedFields } });
    res.json({ message: 'Case updated', case: formatCase(legalCase, [], req.user._id) });
  } catch (error) { res.status(error.statusCode || 500).json({ message: error.message }); }
};

exports.deleteCase = async (req, res) => {
  try {
    assertObjectId(req.params.teamId, 'Team');
    const { legalCase, team } = await requireCaseAccess(req.params.caseId, req.params.teamId, req.user._id, 'delete');
    await runInTransaction(async (session) => {
      await Promise.all([LegalCase.deleteOne({ _id: legalCase._id }).session(session), Hearing.deleteMany({ caseId: legalCase._id }).session(session), CaseDocument.updateMany({ caseId: legalCase._id }, { deletedAt: new Date(), deletedBy: req.user._id }).session(session)]);
      await recordActivity({ teamId: team._id, caseId: legalCase._id, actorId: req.user._id, entityType: 'case', entityId: legalCase._id, action: 'case.deleted', before: { title: legalCase.title, ownerId: legalCase.ownerId }, requestId: requestId(req), session });
    });
    emitTeamEvent({ io: req.app.get('socketio'), recipientIds: [req.user._id, team.ownerId || team.owner], event: 'case:deleted', teamId: team._id, payload: { caseId: String(legalCase._id), ownerId: String(legalCase.ownerId) } });
    res.json({ message: 'Case deleted' });
  } catch (error) { res.status(error.statusCode || 500).json({ message: error.message }); }
};

exports.createHearing = async (req, res) => {
  try {
    assertObjectId(req.params.teamId, 'Team');
    const { legalCase, team } = await requireCaseAccess(req.params.caseId, req.params.teamId, req.user._id, 'write');
    const scheduledAt = new Date(req.body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) throw domainError(400, 'A valid hearing date is required');
    const [hearing] = await Hearing.create([{
      teamId: team._id, caseId: legalCase._id, scheduledAt,
      courtName: trim(req.body.courtName) || legalCase.courtName,
      courtroom: trim(req.body.courtroom), notes: trim(req.body.notes),
      createdBy: req.user._id, updatedBy: req.user._id,
    }]);
    if (!legalCase.nextHearingAt || scheduledAt < legalCase.nextHearingAt) {
      legalCase.nextHearingAt = scheduledAt; legalCase.updatedBy = req.user._id; await legalCase.save();
    }
    await recordActivity({ teamId: team._id, caseId: legalCase._id, actorId: req.user._id, entityType: 'hearing', entityId: hearing._id, action: 'hearing.created', after: { scheduledAt }, requestId: requestId(req) });
    emitTeamEvent({ io: req.app.get('socketio'), recipientIds: [req.user._id, team.ownerId || team.owner], event: 'hearing:created', teamId: team._id, payload: { caseId: String(legalCase._id), hearingId: String(hearing._id), ownerId: String(legalCase.ownerId) } });
    res.status(201).json({ hearing });
  } catch (error) { res.status(error.statusCode || 500).json({ message: error.message }); }
};

exports.updateHearing = async (req, res) => {
  try {
    assertObjectId(req.params.teamId, 'Team'); assertObjectId(req.params.hearingId, 'Hearing');
    const { legalCase, team } = await requireCaseAccess(req.params.caseId, req.params.teamId, req.user._id, 'write');
    const hearing = await Hearing.findOne({ _id: req.params.hearingId, caseId: legalCase._id, teamId: team._id });
    if (!hearing) throw domainError(404, 'Hearing not found');
    ['courtName', 'courtroom', 'notes', 'status'].forEach((field) => { if (req.body[field] !== undefined) hearing[field] = trim(req.body[field]); });
    if (req.body.scheduledAt !== undefined) { const scheduledAt = new Date(req.body.scheduledAt); if (Number.isNaN(scheduledAt.getTime())) throw domainError(400, 'Invalid hearing date'); hearing.scheduledAt = scheduledAt; }
    hearing.updatedBy = req.user._id; await hearing.save();
    await recordActivity({ teamId: team._id, caseId: legalCase._id, actorId: req.user._id, entityType: 'hearing', entityId: hearing._id, action: 'hearing.updated', requestId: requestId(req) });
    emitTeamEvent({ io: req.app.get('socketio'), recipientIds: [req.user._id, team.ownerId || team.owner], event: 'hearing:updated', teamId: team._id, payload: { caseId: String(legalCase._id), hearingId: String(hearing._id), ownerId: String(legalCase.ownerId) } });
    res.json({ hearing });
  } catch (error) { res.status(error.statusCode || 500).json({ message: error.message }); }
};

exports.deleteHearing = async (req, res) => {
  try {
    assertObjectId(req.params.teamId, 'Team'); assertObjectId(req.params.hearingId, 'Hearing');
    const { legalCase, team } = await requireCaseAccess(req.params.caseId, req.params.teamId, req.user._id, 'delete');
    const hearing = await Hearing.findOneAndDelete({ _id: req.params.hearingId, caseId: legalCase._id, teamId: team._id });
    if (!hearing) throw domainError(404, 'Hearing not found');
    await recordActivity({ teamId: team._id, caseId: legalCase._id, actorId: req.user._id, entityType: 'hearing', entityId: hearing._id, action: 'hearing.deleted', requestId: requestId(req) });
    emitTeamEvent({ io: req.app.get('socketio'), recipientIds: [req.user._id, team.ownerId || team.owner], event: 'hearing:deleted', teamId: team._id, payload: { caseId: String(legalCase._id), hearingId: String(hearing._id), ownerId: String(legalCase.ownerId) } });
    res.json({ message: 'Hearing deleted' });
  } catch (error) { res.status(error.statusCode || 500).json({ message: error.message }); }
};
