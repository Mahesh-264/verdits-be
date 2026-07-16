const { trimString } = require('../utils/location');

const allowedRoles = ['user', 'lawyer', 'student', 'admin'];
const registrationRoles = ['user', 'lawyer', 'student'];

const normalizeRole = (role) => String(role || '').trim().toLowerCase();
const normalizeEmail = (value) => trimString(value).toLowerCase();
const normalizePhone = (value) => trimString(value);
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isPhone = (value) => /^\+?[0-9]{10,15}$/.test(String(value || '').replace(/[\s-]/g, ''));
const isScalar = (value) => typeof value === 'string' || typeof value === 'number';

const requireFields = (payload, fields) => {
  const missing = fields.filter((field) => !isScalar(payload[field]) || !trimString(payload[field]));
  if (missing.length) {
    const error = new Error(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`);
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    error.field = missing[0];
    throw error;
  }
};

const validateRoleFields = (body, role) => {
  if (role === 'student') {
    requireFields(body, ['collegeName', 'collegeEmail']);
  }

  if (role === 'lawyer') {
    requireFields(body, ['barId', 'specialization', 'languages', 'experienceYears']);
  }
};

const validateEmailRegistration = (body) => {
  const role = normalizeRole(body.role);

  if (!role || !registrationRoles.includes(role)) {
    const error = new Error(!role ? 'Please select a role.' : 'Invalid role selected.');
    error.statusCode = 400;
    throw error;
  }

  requireFields(body, ['firstName', 'lastName', 'email', 'phone', 'password', 'confirmPassword']);

  if (!isEmail(normalizeEmail(body.email))) {
    const error = new Error('Enter a valid email address.');
    error.statusCode = 400;
    throw error;
  }

  if (!isPhone(normalizePhone(body.phone))) {
    const error = new Error('Enter a valid phone number.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    error.field = 'phone';
    throw error;
  }

  if (String(body.password).length < 8 || !/[A-Za-z]/.test(body.password) || !/\d/.test(body.password)) {
    const error = new Error('Password must be at least 8 characters and include a letter and number.');
    error.statusCode = 400;
    throw error;
  }

  if (body.password !== body.confirmPassword) {
    const error = new Error('Passwords do not match');
    error.statusCode = 400;
    throw error;
  }

  validateRoleFields(body, role);
  return role;
};

const validateGoogleProfile = (body) => {
  const role = normalizeRole(body.role) || 'user';

  if (!registrationRoles.includes(role)) {
    const error = new Error('Invalid role selected');
    error.statusCode = 400;
    throw error;
  }

  requireFields(body, ['phone', 'password', 'confirmPassword']);

  if (String(body.password || '').length < 8) {
    const error = new Error('Password must be at least 8 characters');
    error.statusCode = 400;
    throw error;
  }

  if (body.password !== body.confirmPassword) {
    const error = new Error('Passwords do not match');
    error.statusCode = 400;
    throw error;
  }

  validateRoleFields(body, role);
  return role;
};

const validatePasswordReset = (body) => {
  requireFields(body, ['email', 'otp', 'password', 'confirmPassword']);

  if (!isEmail(normalizeEmail(body.email))) {
    const error = new Error('Enter a valid email address');
    error.statusCode = 400;
    throw error;
  }

  if (String(body.password).length < 8) {
    const error = new Error('Password must be at least 8 characters');
    error.statusCode = 400;
    throw error;
  }

  if (body.password !== body.confirmPassword) {
    const error = new Error('Passwords do not match');
    error.statusCode = 400;
    throw error;
  }
};

module.exports = {
  allowedRoles,
  normalizeEmail,
  normalizePhone,
  normalizeRole,
  validateEmailRegistration,
  validateGoogleProfile,
  validatePasswordReset,
};
