const mongoose = require('mongoose');
const Team = require('../models/Team');
const TeamMember = require('../models/TeamMember');
const Case = require('../models/Case');

const domainError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const assertObjectId = (value, label = 'Resource') => {
  if (!mongoose.isValidObjectId(value)) throw domainError(400, `Invalid ${label.toLowerCase()} id`);
};

const getActiveMembership = async (teamId, userId, options = {}) => {
  assertObjectId(teamId, 'Team');
  const query = TeamMember.findOne({ teamId, userId, status: 'active' });
  if (options.session) query.session(options.session);
  return query.lean();
};

const requireActiveMembership = async (teamId, userId, options = {}) => {
  const [team, membership] = await Promise.all([
    Team.findOne({ _id: teamId, status: 'active' }).session(options.session || null).lean(),
    getActiveMembership(teamId, userId, options),
  ]);
  if (!team) throw domainError(404, 'Team not found');
  if (!membership) throw domainError(403, 'You are not an active member of this team');
  return { team, membership };
};

const requireTeamOwner = async (teamId, userId, options = {}) => {
  const context = await requireActiveMembership(teamId, userId, options);
  if (context.membership.role !== 'owner' || String(context.team.owner) !== String(userId)) {
    throw domainError(403, 'Only the Team Owner can perform this action');
  }
  return context;
};

const getCaseReadScope = ({ teamId, userId, membership }) => (
  membership.role === 'owner'
    ? { teamId }
    : { teamId, ownerId: userId }
);

const requireCaseAccess = async (caseId, teamId, userId, action = 'read', options = {}) => {
  assertObjectId(caseId, 'Case');
  const { team, membership } = await requireActiveMembership(teamId, userId, options);
  const query = Case.findOne({ _id: caseId, teamId });
  if (options.session) query.session(options.session);
  const legalCase = await query;
  if (!legalCase) throw domainError(404, 'Case not found');

  const isCaseOwner = String(legalCase.ownerId) === String(userId);
  const mayRead = isCaseOwner || membership.role === 'owner';
  if (!mayRead) throw domainError(403, 'You do not have access to this case');
  if (action !== 'read' && !isCaseOwner) {
    throw domainError(403, 'Only the case owner can modify or delete this case');
  }

  return { team, membership, legalCase, isCaseOwner };
};

module.exports = {
  assertObjectId,
  domainError,
  getActiveMembership,
  getCaseReadScope,
  requireActiveMembership,
  requireCaseAccess,
  requireTeamOwner,
};
