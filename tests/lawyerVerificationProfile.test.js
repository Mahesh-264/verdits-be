const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'lawyer-verification-test-secret';

const User = require('../models/User');
const LawyerVerificationRequest = require('../models/LawyerVerificationRequest');
const authController = require('../controllers/authController');

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('each lawyer verification token returns only its matching request', async () => {
  const records = [
    { _id: '66a000000000000000000001', firstName: 'Lawyer', lastName: 'One', email: 'one@example.test', barEnrollmentNumber: 'BAR-ONE', status: 'pending' },
    { _id: '66a000000000000000000002', firstName: 'Lawyer', lastName: 'Two', email: 'two@example.test', barEnrollmentNumber: 'BAR-TWO', status: 'pending' },
    { _id: '66a000000000000000000003', firstName: 'Lawyer', lastName: 'Three', email: 'three@example.test', barEnrollmentNumber: 'BAR-THREE', status: 'rejected', rejectionReason: 'Test rejection' },
  ];
  const originalRequestFindOne = LawyerVerificationRequest.findOne;
  const originalUserFindOne = User.findOne;

  LawyerVerificationRequest.findOne = (query) => ({
    lean: async () => records.find((record) => String(record._id) === String(query._id) && record.email === query.email) || null,
  });
  User.findOne = () => ({ lean: async () => null });

  try {
    for (const record of records) {
      const token = jwt.sign({
        type: 'lawyer-verification-status',
        requestId: record._id,
        email: record.email,
      }, process.env.JWT_SECRET);
      const res = responseRecorder();

      await authController.getLawyerVerificationStatus({ headers: { authorization: `Bearer ${token}` } }, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.email, record.email);
      assert.equal(res.body.barEnrollmentNumber, record.barEnrollmentNumber);
      assert.equal(res.body.status, record.status);
      assert.equal(res.body.firstName, record.firstName);
    }

    const mismatchedToken = jwt.sign({
      type: 'lawyer-verification-status',
      requestId: records[0]._id,
      email: records[1].email,
    }, process.env.JWT_SECRET);
    const mismatchRes = responseRecorder();
    await authController.getLawyerVerificationStatus({ headers: { authorization: `Bearer ${mismatchedToken}` } }, mismatchRes);
    assert.equal(mismatchRes.statusCode, 404);
  } finally {
    LawyerVerificationRequest.findOne = originalRequestFindOne;
    User.findOne = originalUserFindOne;
  }
});

test('lawyer profile updates preserve protected registration and verification fields', async () => {
  const lawyer = new User({
    _id: '66a000000000000000000010',
    firstName: 'Protected',
    lastName: 'Lawyer',
    gender: 'Female',
    email: 'protected@example.test',
    phone: '9876543210',
    role: 'lawyer',
    lawyerProfile: { barId: 'BAR-LOCKED', isVerified: true, specialization: 'Civil' },
  });
  lawyer.save = async () => lawyer;
  const originalFindById = User.findById;
  User.findById = async () => lawyer;

  try {
    const res = responseRecorder();
    await authController.updateProfile({
      user: { _id: lawyer._id },
      body: {
        firstName: 'Changed',
        lastName: 'Identity',
        gender: 'Other',
        lawyerProfile: {
          barId: 'BAR-CHANGED',
          barEnrollmentNumber: 'BAR-CHANGED',
          specialization: 'Criminal',
          experienceYears: 8,
        },
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(lawyer.firstName, 'Protected');
    assert.equal(lawyer.lastName, 'Lawyer');
    assert.equal(lawyer.gender, 'Female');
    assert.equal(lawyer.lawyerProfile.barId, 'BAR-LOCKED');
    assert.equal(lawyer.lawyerProfile.isVerified, true);
    assert.equal(lawyer.lawyerProfile.specialization, 'Criminal');
    assert.equal(lawyer.lawyerProfile.experienceYears, 8);
  } finally {
    User.findById = originalFindById;
  }
});
