const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateTokens = (id, role) => ({
  accessToken: jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '15m' }),
  refreshToken: jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '1y' }),
});

const sanitizeAuthUser = (user) => {
  const value = user?.toObject ? user.toObject() : { ...user };
  delete value.password;
  delete value.refreshToken;
  delete value.otp;
  delete value.otpExpires;
  delete value.resetOtpHash;
  delete value.resetOtpExpiresAt;
  delete value.resetResendAvailableAt;
  delete value.resetAttemptCount;
  return value;
};

const issueSession = async (user) => {
  const tokens = generateTokens(user._id, user.role);
  user.refreshToken = tokens.refreshToken;
  await user.save();

  return {
    ...tokens,
    user: sanitizeAuthUser(user),
  };
};

const assertNoDuplicateAccount = async ({ email, phone, googleId }) => {
  const checks = [
    email ? { email } : null,
    phone ? { phone } : null,
    googleId ? { googleId } : null,
  ].filter(Boolean);

  if (!checks.length) return;

  const existing = await User.findOne({ $or: checks });
  if (!existing) return;

  const error = new Error(
    existing.email === email
      ? 'Email already registered'
      : existing.phone === phone
        ? 'Phone already registered'
        : 'Google account already registered'
  );
  error.statusCode = 400;
  throw error;
};

const createUserFromPending = async (pending) => {
  await assertNoDuplicateAccount({
    email: pending.email,
    phone: pending.phone,
    googleId: pending.googleId,
  });

  const user = new User({
    firstName: pending.firstName,
    lastName: pending.lastName,
    email: pending.email,
    phone: pending.phone,
    password: pending.password,
    role: pending.role,
    authProvider: pending.authProvider === 'google' && pending.password ? 'both' : pending.authProvider || 'email',
    googleId: pending.googleId,
    verified: true,
    emailVerified: true,
    phoneVerified: true,
    profilePicture: pending.profilePicture,
    profileImage: pending.profilePicture,
    address: pending.address,
    location: pending.location,
    lawyerProfile: pending.lawyerProfile,
    studentProfile: pending.studentProfile,
  });

  if (pending.password) {
    user.$locals.passwordIsHashed = true;
  }
  await user.save();
  return user;
};

const createGoogleCompletionToken = (googleProfile) => jwt.sign(
  { type: 'google-profile-completion', googleProfile },
  process.env.JWT_SECRET,
  { expiresIn: '10m' }
);

const verifyGoogleCompletionToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.type !== 'google-profile-completion' || !decoded.googleProfile) {
    const error = new Error('Invalid Google profile session');
    error.statusCode = 401;
    throw error;
  }
  return decoded.googleProfile;
};

module.exports = {
  createGoogleCompletionToken,
  createUserFromPending,
  generateTokens,
  issueSession,
  sanitizeAuthUser,
  verifyGoogleCompletionToken,
};
