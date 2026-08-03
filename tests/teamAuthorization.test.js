const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const TeamMember = require('../models/TeamMember');
const { getCaseReadScope } = require('../services/teamAuthorizationService');

test('Team Owner case scope includes every case in their team', () => {
  const teamId = new mongoose.Types.ObjectId();
  const ownerId = new mongoose.Types.ObjectId();
  assert.deepEqual(
    getCaseReadScope({ teamId, userId: ownerId, membership: { role: 'owner' } }),
    { teamId }
  );
});

test('Team Member case scope is permanently limited to their own cases', () => {
  const teamId = new mongoose.Types.ObjectId();
  const memberId = new mongoose.Types.ObjectId();
  assert.deepEqual(
    getCaseReadScope({ teamId, userId: memberId, membership: { role: 'member' } }),
    { teamId, ownerId: memberId }
  );
});

test('TeamMember declares a unique active Team Owner invariant', () => {
  const indexes = TeamMember.schema.indexes();
  assert(indexes.some(([keys, options]) => (
    keys.teamId === 1 && keys.role === 1 && options.unique === true
      && options.partialFilterExpression?.role === 'owner'
      && options.partialFilterExpression?.status === 'active'
  )));
});
