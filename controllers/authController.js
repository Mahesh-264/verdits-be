const User = require('../models/User');
const Otp = require('../models/Otp');
const jwt = require('jsonwebtoken');
const {
  normalizeAddressPayload,
  parseBooleanFlag,
  parseLimit,
  parseRadiusKm,
  parseSearchCoordinates,
  parseSpecializationTerms,
  trimString,
} = require('../utils/location');
const {
  mapLawyerDiscoveryCard,
  searchNearbyLawyers,
} = require('../services/lawyerDiscoveryService');
const {
  hasManualLocationInput,
  lookupPincodeDetails,
  resolveLawyerAddress,
  reverseGeocodeCoordinates,
} = require('../services/locationResolutionService');
const {
  createNotification,
  getDisplayName: getNotificationDisplayName,
} = require('../services/notificationService');

const sanitizeUser = '-password -refreshToken -otp';
const allowedRoles = ['user', 'lawyer', 'student', 'admin'];

const normalizeRole = (role) => String(role || '').trim().toLowerCase();
const normalizeEmail = (value) => trimString(value).toLowerCase();
const normalizePhone = (value) => trimString(value);

const getOptionalViewerId = (req) => {
  const token = req.headers.authorization?.startsWith('Bearer')
    ? req.headers.authorization.split(' ')[1]
    : null;

  if (!token) return null;

  try {
    return jwt.verify(token, process.env.JWT_SECRET).id;
  } catch {
    return null;
  }
};

const getDisplayName = (user) => {
  if (!user) return 'Lawyer';
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.name || 'Lawyer';
};

const getLocationLabel = (user) => (
  user?.address?.city ||
  user?.address?.district ||
  user?.address?.state ||
  'India'
);

const normalizeLanguageList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => trimString(item)).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const buildDistanceLabel = (distanceKm) => (
  Number.isFinite(distanceKm) ? `${distanceKm.toFixed(1)} km away` : null
);

const getRelativeTime = (dateValue) => {
  if (!dateValue) return 'Recently posted';

  const timestamp = new Date(dateValue).getTime();
  if (Number.isNaN(timestamp)) return 'Recently posted';

  const difference = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (difference < hour) {
    const minutes = Math.max(1, Math.floor(difference / minute));
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  if (difference < day) {
    const hours = Math.max(1, Math.floor(difference / hour));
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.max(1, Math.floor(difference / day));
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

const getStudentApplicationIds = (student) => new Set(
  (student?.studentProfile?.internshipApplications || []).map((item) => String(item.postId))
);

const getJoinedJamSessionIds = (student) => new Set(
  (student?.studentProfile?.joinedJamSessions || []).map((item) => String(item.sessionId))
);

const formatInteractionComment = (comment) => ({
  id: comment._id,
  userId: comment.userId,
  name: comment.name || 'User',
  role: comment.role || 'user',
  text: comment.text || '',
  createdAt: comment.createdAt,
  postedAt: getRelativeTime(comment.createdAt),
});

const formatPublishedInternship = (lawyer, internship, options = {}) => ({
  id: internship._id,
  type: 'internship',
  lawyerId: lawyer._id,
  lawyerName: getDisplayName(lawyer),
  profileImage: lawyer.profileImage || '',
  avatar: getDisplayName(lawyer).charAt(0).toUpperCase(),
  title: internship.title || 'Internship',
  firm: internship.firm || lawyer.address?.city || lawyer.address?.district || 'Lawin',
  specialization: internship.specialization || [],
  description: internship.description || '',
  duration: internship.duration || 'Not specified',
  location: internship.location || getLocationLabel(lawyer),
  stipend: internship.stipend || 'Not specified',
  skills: internship.skills || [],
  status: internship.status || 'open',
  createdAt: internship.createdAt,
  postedAt: getRelativeTime(internship.createdAt),
  applicationCount: Array.isArray(internship.applications) ? internship.applications.length : 0,
  likesCount: Array.isArray(internship.likedBy) ? internship.likedBy.length : 0,
  liked: (internship.likedBy || []).some((id) => String(id) === String(options.viewerId)),
  commentsCount: Array.isArray(internship.comments) ? internship.comments.length : 0,
  comments: (internship.comments || []).map(formatInteractionComment),
  city: lawyer.address?.city || lawyer.address?.district || '',
  state: lawyer.address?.state || '',
  distanceKm: Number.isFinite(options.distanceKm) ? options.distanceKm : null,
  distanceLabel: buildDistanceLabel(options.distanceKm),
});

const formatPublishedJamSession = (lawyer, session, options = {}) => ({
  id: session._id,
  type: 'jam',
  lawyerId: lawyer._id,
  lawyerName: getDisplayName(lawyer),
  author: getDisplayName(lawyer),
  profileImage: lawyer.profileImage || '',
  avatar: getDisplayName(lawyer).charAt(0).toUpperCase(),
  title: session.title || 'Jam Session',
  topic: session.topic || 'General Discussion',
  summary: session.summary || '',
  schedule: session.schedule || '',
  location: session.location || getLocationLabel(lawyer),
  createdAt: session.createdAt,
  time: getRelativeTime(session.createdAt),
  meta: lawyer.lawyerProfile?.specialization || 'Lawyer',
  participantCount: Array.isArray(session.participants) ? session.participants.length : 0,
  participants: Array.isArray(session.participants)
    ? `${session.participants.length} joined`
    : 'Open for students',
  likesCount: Array.isArray(session.likedBy) ? session.likedBy.length : 0,
  liked: (session.likedBy || []).some((id) => String(id) === String(options.viewerId)),
  commentsCount: Array.isArray(session.comments) ? session.comments.length : 0,
  comments: (session.comments || []).map(formatInteractionComment),
  commentsLabel: `${Array.isArray(session.comments) ? session.comments.length : 0} comments`,
  city: lawyer.address?.city || lawyer.address?.district || '',
  state: lawyer.address?.state || '',
  distanceKm: Number.isFinite(options.distanceKm) ? options.distanceKm : null,
  distanceLabel: buildDistanceLabel(options.distanceKm),
});

const getLawyerInteractionStats = (lawyer) => {
  const internships = lawyer?.lawyerProfile?.internships || [];
  const jamSessions = lawyer?.lawyerProfile?.jamSessions || [];

  return {
    totalInternshipsPosted: internships.length,
    activeInternships: internships.filter((internship) => (internship.status || 'open') === 'open').length,
    totalApplicants: internships.reduce((count, internship) => count + (internship.applications?.length || 0), 0),
    totalJamSessions: jamSessions.length,
    totalParticipants: jamSessions.reduce((count, session) => count + (session.participants?.length || 0), 0),
  };
};

const formatLawyerCard = (lawyer) => ({
  id: lawyer._id,
  name: getDisplayName(lawyer),
  profileImage: lawyer.profileImage || '',
  avatar: getDisplayName(lawyer).charAt(0).toUpperCase(),
  specialization: lawyer.lawyerProfile?.specialization || 'General Practice',
  location: getLocationLabel(lawyer),
  city: lawyer.address?.city || lawyer.address?.district || '',
  state: lawyer.address?.state || '',
  verified: Boolean(lawyer.lawyerProfile?.isVerified),
  isOnline: Boolean(lawyer.lawyerProfile?.isOnline),
  rating: lawyer.lawyerProfile?.rating || 4.8,
});

const buildStudentFeed = (lawyers, student, distanceLookup = new Map()) => {
  const appliedIds = getStudentApplicationIds(student);
  const joinedIds = getJoinedJamSessionIds(student);

  return lawyers.flatMap((lawyer) => {
    const distanceKm = distanceLookup.get(String(lawyer._id));
    const internships = (lawyer.lawyerProfile?.internships || []).map((internship) => ({
      ...formatPublishedInternship(lawyer, internship, { distanceKm, viewerId: student?._id }),
      applied: appliedIds.has(String(internship._id)),
    }));

    const jamSessions = (lawyer.lawyerProfile?.jamSessions || []).map((session) => ({
      ...formatPublishedJamSession(lawyer, session, { distanceKm, viewerId: student?._id }),
      joined: joinedIds.has(String(session._id)),
    }));

    return [...internships, ...jamSessions];
  }).sort((first, second) => {
    const firstDistance = Number.isFinite(first.distanceKm) ? first.distanceKm : Number.MAX_SAFE_INTEGER;
    const secondDistance = Number.isFinite(second.distanceKm) ? second.distanceKm : Number.MAX_SAFE_INTEGER;

    if (firstDistance !== secondDistance) {
      return firstDistance - secondDistance;
    }

    return new Date(second.createdAt || 0) - new Date(first.createdAt || 0);
  });
};

const generateTokens = (id, role) => {
  console.log(`🎫 Tokens requested for: ${id} [${role}]`);
  const accessToken = jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '1y' });
  return { accessToken, refreshToken };
};

// 1. REGISTER
exports.register = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      role,
      address,
      barId,
      specialization,
      experienceYears,
      about,
      languages,
      consultationFee,
      collegeName,
      collegeEmail,
    } = req.body;
    
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone && await User.findOne({ phone: normalizedPhone })) return res.status(400).json({ message: 'Phone exists' });
    if (normalizedEmail && await User.findOne({ email: normalizedEmail })) return res.status(400).json({ message: 'Email exists' });

    // Removed OTP validation for User and Student as per requirement

    const normalizedRole = normalizeRole(role) || 'user';
    const userData = {
      firstName: trimString(firstName),
      lastName: trimString(lastName),
      email: normalizedEmail,
      phone: normalizedPhone,
      password,
      role: normalizedRole,
    };
    
    if (normalizedRole === 'lawyer') {
      const normalizedLocation = await resolveLawyerAddress(address || {}, {
        requireCoordinates: hasManualLocationInput(address || {}),
      });
      userData.address = normalizedLocation.address;
      userData.location = normalizedLocation.location;
      userData.lawyerProfile = { 
        barId: trimString(barId),
        specialization: trimString(specialization),
        experienceYears: Number(experienceYears) || 0,
        about: trimString(about),
        languages: normalizeLanguageList(languages),
        consultationFee: Number(consultationFee) || 500,
        isVerified: false 
      };
    } else if (normalizedRole === 'student') {
      userData.studentProfile = {
        collegeName: trimString(collegeName),
        collegeEmail: trimString(collegeEmail),
      };
    }
    
    const user = await User.create(userData);
    const { accessToken, refreshToken } = generateTokens(user._id, user.role);
    user.refreshToken = refreshToken;
    await user.save();

    res.status(201).json({ accessToken, user });
  } catch (error) { 
    res.status(error.statusCode || 500).json({ message: error.message }); 
  }
};

// 1A. LOOK UP PINCODE DETAILS FOR LAWYER REGISTRATION
exports.lookupPincode = async (req, res) => {
  try {
    const address = await lookupPincodeDetails(req.params.pincode);
    res.json({ address });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// 1B. GEOCODE CITY/DISTRICT/STATE INTO COORDINATES
exports.geocodeRegistrationAddress = async (req, res) => {
  try {
    const resolvedAddress = await resolveLawyerAddress(req.body?.address || req.body || {}, {
      requireCoordinates: false,
    });

    if (!resolvedAddress.location) {
      return res.status(422).json({
        message: 'Unable to generate coordinates from the provided location details.',
        address: resolvedAddress.address,
        resolution: resolvedAddress.resolution,
      });
    }

    res.json(resolvedAddress);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// 1C. REVERSE GEOCODE CURRENT COORDINATES INTO ADDRESS FIELDS
exports.reverseGeocodeRegistrationAddress = async (req, res) => {
  try {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    const resolvedAddress = await reverseGeocodeCoordinates({ latitude, longitude });
    res.json(resolvedAddress);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// 2. LOGIN
exports.login = async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const normalizedPhone = normalizePhone(req.body.phone);
    const password = String(req.body.password || '');
    const email = normalizedEmail;
    const phone = normalizedPhone;
    const requestedRole = normalizeRole(req.body.role);

    if (requestedRole && !allowedRoles.includes(requestedRole)) {
      return res.status(400).json({ message: 'Invalid role selected' });
    }

    if (!normalizedEmail && !normalizedPhone) {
      return res.status(400).json({ message: 'Email or phone is required' });
    }

    if (!password.trim()) {
      return res.status(400).json({ message: 'Password is required' });
    }

    let user;
    if (normalizedEmail) {
      console.log("🚀 Login request:", email);
      user = await User.findOne({ email: normalizedEmail }).select('+password');
    } else if (normalizedPhone) {
      console.log("🚀 Login request:", phone);
      user = await User.findOne({ phone: normalizedPhone }).select('+password');
    }
    
    if (!user) {
      return res.status(404).json({
        message: 'No account found with these details. Please register first.',
        code: 'ACCOUNT_NOT_FOUND',
      });
    }

    if (!user.password) {
      return res.status(400).json({
        message: 'This account is not set up for password login yet.',
        code: 'PASSWORD_NOT_SET',
      });
    }

    if (!(await user.matchPassword(password))) {
      return res.status(401).json({
        message: 'Incorrect password. Please try again.',
        code: 'INVALID_PASSWORD',
      });
    }

    if (requestedRole && user.role !== requestedRole) {
      return res.status(403).json({
        message: `This account is registered as ${user.role}. Please use the ${user.role} login.`,
        code: 'ROLE_MISMATCH',
      });
    }

    const { accessToken, refreshToken } = generateTokens(user._id, user.role);
    user.refreshToken = refreshToken;
    await user.save();

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: true, sameSite: 'none' });
    console.log("✅ Login Successful.");
    res.json({ accessToken, refreshToken, user });
  } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. SEND OTP
exports.sendOTP = async (req, res) => {
  try {
    const { phone, isRegister } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`📡 OTP for ${phone}: ${otp}`);

    if (isRegister) {
       await Otp.findOneAndUpdate({ phone }, { otp }, { upsert: true, new: true });
    } else {
      const user = await User.findOneAndUpdate(
        { phone },
        { otp, otpExpires: Date.now() + 600000 },
        { new: true }
      );
      if (!user) return res.status(404).json({ message: "User not found" });
    }
    res.json({ message: "OTP sent" });
  } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. VERIFY OTP
exports.verifyOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const requestedRole = normalizeRole(req.body.role);

    if (requestedRole && !allowedRoles.includes(requestedRole)) {
      return res.status(400).json({ message: 'Invalid role selected' });
    }

    const user = await User.findOne({ phone, otp, otpExpires: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ message: "Invalid/Expired OTP" });

    if (requestedRole && user.role !== requestedRole) {
      return res.status(403).json({
        message: `This account is registered as ${user.role}. Please use the ${user.role} login.`,
      });
    }

    user.otp = undefined; user.otpExpires = undefined;
    const { accessToken, refreshToken } = generateTokens(user._id, user.role);
    user.refreshToken = refreshToken;
    await user.save();
    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: true, sameSite: 'none' });
    res.json({ accessToken, refreshToken, user });
  } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. REFRESH TOKEN
exports.refresh = async (req, res) => {
  const token = req.body?.refreshToken || req.headers['x-refresh-token'] || req.cookies.refreshToken;
  console.log("♻️ Token Refresh triggered");
  if (!token) return res.status(401).json({ message: "No token" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findOne({ _id: decoded.id, refreshToken: token });
    if (!user) return res.status(403).json({ message: "Invalid session" });
    const accessToken = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    res.json({ accessToken });
  } catch (err) { res.status(403).json({ message: "Expired" }); }
};

// 6. GET LAWYERS (Filtered)
exports.getLawyers = async (req, res) => {
  try {
    const { district, specialization } = req.query;
    
    // Base Query: Must be a registered lawyer
    let query = { role: 'lawyer' };

    // Filter by District
    if (district) query['address.district'] = district;

    // Filter by Specialization (Regex for flexible matching)
    const specializationTerms = parseSpecializationTerms(specialization);
    if (specializationTerms.length) {
        query['lawyerProfile.specialization'] = { $regex: specializationTerms.join('|'), $options: 'i' };
    }
    
    const lawyers = await User.find(query)
      .select(sanitizeUser)
      .sort({ createdAt: -1 });
    res.json(lawyers);
  } catch (error) { 
    res.status(500).json({ message: error.message }); 
  }
};

// 6A. GET NEARBY LAWYERS USING MONGODB GEOSPATIAL SEARCH
exports.getNearbyLawyers = async (req, res) => {
  try {
    const { latitude, longitude } = parseSearchCoordinates(req.query);
    const radiusKm = parseRadiusKm(req.query.radiusKm);
    const limit = parseLimit(req.query.limit);
    const onlineOnly = parseBooleanFlag(req.query.onlineOnly);

    const lawyers = await searchNearbyLawyers({
      latitude,
      longitude,
      specialization: req.query.specialization,
      onlineOnly,
      radiusKm,
      limit,
    });

    res.json({
      count: lawyers.length,
      origin: { latitude, longitude },
      radiusKm,
      lawyers: lawyers.map(mapLawyerDiscoveryCard),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// 7. GET REGISTERED STUDENTS
exports.getStudents = async (req, res) => {
  try {
    const excludeId = req.user?._id;
    const query = { role: 'student' };

    if (excludeId) query._id = { $ne: excludeId };

    const students = await User.find(query)
      .select(sanitizeUser)
      .sort({ createdAt: -1 });

    res.json(students);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 7A. GET CURRENT USER
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(sanitizeUser);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 8. FOLLOW OR UNFOLLOW LAWYER (Student Only)
exports.toggleFollowLawyer = async (req, res) => {
  try {
    const student = await User.findById(req.user._id);
    const lawyer = await User.findById(req.params.id);

    if (!student || student.role !== 'student') {
      return res.status(403).json({ message: 'Only students can follow lawyers' });
    }

    if (!lawyer || lawyer.role !== 'lawyer') {
      return res.status(404).json({ message: 'Lawyer not found' });
    }

    if (!student.studentProfile) student.studentProfile = {};
    if (!Array.isArray(student.studentProfile.followingLawyers)) {
      student.studentProfile.followingLawyers = [];
    }
    student.following = Array.isArray(student.following) ? student.following : [];
    lawyer.followers = Array.isArray(lawyer.followers) ? lawyer.followers : [];

    const lawyerId = String(lawyer._id);
    const alreadyFollowing = student.studentProfile.followingLawyers.some(
      (id) => String(id) === lawyerId
    );

    if (alreadyFollowing) {
      student.studentProfile.followingLawyers = student.studentProfile.followingLawyers.filter(
        (id) => String(id) !== lawyerId
      );
      student.following = student.following.filter((id) => String(id) !== lawyerId);
      lawyer.followers = lawyer.followers.filter((id) => String(id) !== String(student._id));
    } else {
      student.studentProfile.followingLawyers.push(lawyer._id);
      if (!student.following.some((id) => String(id) === lawyerId)) {
        student.following.push(lawyer._id);
      }
      if (!lawyer.followers.some((id) => String(id) === String(student._id))) {
        lawyer.followers.push(student._id);
      }

      // 🔔 Send notification when someone follows a lawyer
      await createNotification({
        recipient: lawyer._id,
        actor: student._id,
        type: 'follow_accepted',
        title: 'You have a new follower',
        message: `${getNotificationDisplayName(student, 'A student')} started following you.`,
        link: `/lawyer-profile/${lawyer._id}`,
        metadata: { followerId: student._id },
        io: req.app.get('socketio'),
      });
    }

    student.markModified('studentProfile');
    await student.save();
    await lawyer.save();

    res.json({
      message: alreadyFollowing ? 'Lawyer unfollowed' : 'Lawyer followed',
      user: student.toObject(),
      isFollowing: !alreadyFollowing,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 9. SEND STUDENT CONNECTION REQUEST
exports.sendStudentConnectionRequest = async (req, res) => {
  try {
    const student = await User.findById(req.user._id);
    const targetStudent = await User.findById(req.params.id);

    if (!student || student.role !== 'student') {
      return res.status(403).json({ message: 'Only students can connect with students' });
    }

    if (!targetStudent || targetStudent.role !== 'student') {
      return res.status(404).json({ message: 'Student not found' });
    }

    if (String(student._id) === String(targetStudent._id)) {
      return res.status(400).json({ message: 'You cannot connect with yourself' });
    }

    if (!student.studentProfile) student.studentProfile = {};
    if (!targetStudent.studentProfile) targetStudent.studentProfile = {};
    if (!Array.isArray(student.studentProfile.connectedStudents)) {
      student.studentProfile.connectedStudents = [];
    }
    if (!Array.isArray(student.studentProfile.outgoingConnectionRequests)) {
      student.studentProfile.outgoingConnectionRequests = [];
    }
    if (!Array.isArray(targetStudent.studentProfile.connectionRequests)) {
      targetStudent.studentProfile.connectionRequests = [];
    }

    const targetId = String(targetStudent._id);
    const alreadyConnected = student.studentProfile.connectedStudents.some(
      (id) => String(id) === targetId
    );

    if (alreadyConnected) {
      return res.status(400).json({ message: 'Already connected' });
    }

    const alreadyRequested = student.studentProfile.outgoingConnectionRequests.some(
      (id) => String(id) === targetId
    );

    if (alreadyRequested) {
      return res.status(400).json({ message: 'Request already sent' });
    }

    const incomingFromTarget = student.studentProfile.connectionRequests?.some(
      (id) => String(id) === targetId
    );

    if (incomingFromTarget) {
      return res.status(400).json({ message: 'This student has already sent you a request. Accept it instead.' });
    }

    student.studentProfile.outgoingConnectionRequests.push(targetStudent._id);
    targetStudent.studentProfile.connectionRequests.push(student._id);

    student.markModified('studentProfile');
    targetStudent.markModified('studentProfile');
    await student.save();
    await targetStudent.save();
    await createNotification({
      recipient: targetStudent._id,
      actor: student._id,
      type: 'student_connection_request',
      title: 'New student connection request',
      message: `${getNotificationDisplayName(student, 'A student')} sent you a connection request.`,
      link: '/student-network',
      metadata: { requesterId: student._id },
      io: req.app.get('socketio'),
    });

    res.json({
      message: 'Connection request sent',
      user: student.toObject(),
      requestSent: true,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 10. ACCEPT STUDENT CONNECTION REQUEST
exports.acceptStudentConnectionRequest = async (req, res) => {
  try {
    const student = await User.findById(req.user._id);
    const requester = await User.findById(req.params.id);

    if (!student || student.role !== 'student') {
      return res.status(403).json({ message: 'Only students can accept requests' });
    }

    if (!requester || requester.role !== 'student') {
      return res.status(404).json({ message: 'Student not found' });
    }

    if (!student.studentProfile) student.studentProfile = {};
    if (!requester.studentProfile) requester.studentProfile = {};

    student.studentProfile.connectionRequests = student.studentProfile.connectionRequests || [];
    student.studentProfile.connectedStudents = student.studentProfile.connectedStudents || [];
    requester.studentProfile.connectedStudents = requester.studentProfile.connectedStudents || [];
    requester.studentProfile.outgoingConnectionRequests = requester.studentProfile.outgoingConnectionRequests || [];
    student.connections = Array.isArray(student.connections) ? student.connections : [];
    requester.connections = Array.isArray(requester.connections) ? requester.connections : [];

    const requesterId = String(requester._id);
    const hasIncomingRequest = student.studentProfile.connectionRequests.some(
      (id) => String(id) === requesterId
    );

    if (!hasIncomingRequest) {
      return res.status(400).json({ message: 'No pending request from this student' });
    }

    student.studentProfile.connectionRequests = student.studentProfile.connectionRequests.filter(
      (id) => String(id) !== requesterId
    );

    if (!student.studentProfile.connectedStudents.some((id) => String(id) === requesterId)) {
      student.studentProfile.connectedStudents.push(requester._id);
    }
    if (!student.connections.some((id) => String(id) === requesterId)) {
      student.connections.push(requester._id);
    }

    requester.studentProfile.outgoingConnectionRequests = requester.studentProfile.outgoingConnectionRequests.filter(
      (id) => String(id) !== String(student._id)
    );

    if (!requester.studentProfile.connectedStudents.some((id) => String(id) === String(student._id))) {
      requester.studentProfile.connectedStudents.push(student._id);
    }
    if (!requester.connections.some((id) => String(id) === String(student._id))) {
      requester.connections.push(student._id);
    }

    student.markModified('studentProfile');
    requester.markModified('studentProfile');
    await student.save();
    await requester.save();
    await createNotification({
      recipient: requester._id,
      actor: student._id,
      type: 'student_connection_accepted',
      title: 'Connection request accepted',
      message: `${getNotificationDisplayName(student, 'A student')} accepted your connection request.`,
      link: '/student-network',
      metadata: { studentId: student._id },
      io: req.app.get('socketio'),
    });

    res.json({
      message: 'Connection request accepted',
      user: student.toObject(),
      accepted: true,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 11. GET LAWYER BY ID (Profile View)
exports.getLawyerById = async (req, res) => {
  try {
    const lawyer = await User.findById(req.params.id).select(sanitizeUser);
    if (!lawyer || lawyer.role !== 'lawyer') {
      return res.status(404).json({ message: "Lawyer not found" });
    }
    res.json(lawyer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 12. UPDATE PROFILE (User & Lawyer)
exports.updateProfile = async (req, res) => {
  try {
    // Note: We use findById to ensure we get the Mongoose document instance
    const user = await User.findById(req.user._id);

    if (!user) return res.status(404).json({ message: "User not found" });

    // Update Basic Fields
    if (req.body.firstName) user.firstName = trimString(req.body.firstName);
    if (req.body.lastName) user.lastName = trimString(req.body.lastName);
    if (req.body.email) user.email = trimString(req.body.email);
    if (req.body.age) user.age = req.body.age;
    if (req.body.gender) user.gender = req.body.gender;

    // Update Address (Merge existing with new)
    if (req.body.address) {
      const mergedAddress = {
        ...(user.address?.toObject ? user.address.toObject() : (user.address || {})),
        ...req.body.address,
      };
      const normalizedLocation = user.role === 'lawyer'
        ? await resolveLawyerAddress(mergedAddress, {
          requireCoordinates: hasManualLocationInput(mergedAddress),
        })
        : normalizeAddressPayload(mergedAddress);
      user.address = normalizedLocation.address;
      user.location = normalizedLocation.location;
    }

    // Update Lawyer Specifics
    if (req.body.lawyerProfile && user.role === 'lawyer') {
      const normalizedLawyerProfile = { ...req.body.lawyerProfile };

      if (normalizedLawyerProfile.languages !== undefined) {
        normalizedLawyerProfile.languages = normalizeLanguageList(normalizedLawyerProfile.languages);
      }

      if (normalizedLawyerProfile.specialization !== undefined) {
        normalizedLawyerProfile.specialization = trimString(normalizedLawyerProfile.specialization);
      }

      if (normalizedLawyerProfile.barId !== undefined) {
        normalizedLawyerProfile.barId = trimString(normalizedLawyerProfile.barId);
      }

      if (normalizedLawyerProfile.about !== undefined) {
        normalizedLawyerProfile.about = trimString(normalizedLawyerProfile.about);
      }

      if (normalizedLawyerProfile.experienceYears !== undefined) {
        normalizedLawyerProfile.experienceYears = Number(normalizedLawyerProfile.experienceYears) || 0;
      }

      if (normalizedLawyerProfile.consultationFee !== undefined) {
        normalizedLawyerProfile.consultationFee = Number(normalizedLawyerProfile.consultationFee) || 0;
      }

      user.lawyerProfile = {
        ...user.lawyerProfile,
        ...normalizedLawyerProfile,
        isVerified: false,
      };
    }

    // Update Student Specifics
    if (req.body.studentProfile && user.role === 'student') {
      user.studentProfile = {
        ...user.studentProfile,
        ...req.body.studentProfile,
      };
    }

    await user.save();
    console.log(`🔄 Profile updated for: ${user.phone}`);
    res.json({ message: "Updated", user });
  } catch (error) {
      res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// 13. GET CURRENT LAWYER STUDENT INTERACTION POSTS
exports.getLawyerStudentInteractions = async (req, res) => {
  try {
    const lawyer = await User.findById(req.user._id).select(sanitizeUser);

    if (!lawyer || lawyer.role !== 'lawyer') {
      return res.status(403).json({ message: 'Only lawyers can access student interactions' });
    }

    const internships = (lawyer.lawyerProfile?.internships || [])
      .slice()
      .sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0))
      .map((internship) => ({
        ...formatPublishedInternship(lawyer, internship, { viewerId: req.user._id }),
        applicants: (internship.applications || []).map((application) => ({
          id: application._id,
          studentId: application.studentId,
          name: `${application.firstName || ''} ${application.lastName || ''}`.trim() || 'Student',
          email: application.email || '',
          phone: application.phone || '',
          collegeName: application.collegeName || '',
          degree: application.degree || '',
          yearOfStudy: application.yearOfStudy || '',
          skills: application.skills || [],
          resumeLink: application.resumeLink || '',
          resumeFileName: application.resumeFileName || '',
          coverMessage: application.coverMessage || '',
          linkedIn: application.linkedIn || '',
          portfolio: application.portfolio || '',
          status: application.status || 'pending',
          submittedAt: application.submittedAt,
        })),
      }));

    const jamSessions = (lawyer.lawyerProfile?.jamSessions || [])
      .slice()
      .sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0))
      .map((session) => ({
        ...formatPublishedJamSession(lawyer, session, { viewerId: req.user._id }),
        joinedStudents: (session.participants || []).map((participant) => ({
          id: participant._id,
          studentId: participant.studentId,
          name: participant.name || 'Student',
          email: participant.email || '',
          collegeName: participant.collegeName || '',
          yearOfStudy: participant.yearOfStudy || '',
          status: 'joined',
          joinedAt: participant.joinedAt,
        })),
      }));

    res.json({
      internships,
      jamSessions,
      stats: getLawyerInteractionStats(lawyer),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 14. CREATE LAWYER INTERNSHIP POST
exports.createLawyerInternship = async (req, res) => {
  try {
    const lawyer = await User.findById(req.user._id);

    if (!lawyer || lawyer.role !== 'lawyer') {
      return res.status(403).json({ message: 'Only lawyers can publish internships' });
    }

    const internship = {
      title: req.body.title?.trim(),
      firm: req.body.firm?.trim(),
      specialization: Array.isArray(req.body.specialization)
        ? req.body.specialization.map((item) => String(item).trim()).filter(Boolean)
        : [],
      description: req.body.description?.trim(),
      duration: req.body.duration?.trim(),
      location: req.body.location?.trim(),
      stipend: req.body.stipend?.trim(),
      skills: Array.isArray(req.body.skills)
        ? req.body.skills.map((item) => String(item).trim()).filter(Boolean)
        : [],
      status: 'open',
    };

    if (!internship.title || !internship.description) {
      return res.status(400).json({ message: 'Title and description are required' });
    }

    const currentProfile = lawyer.lawyerProfile?.toObject
      ? lawyer.lawyerProfile.toObject()
      : (lawyer.lawyerProfile || {});
    const currentInternships = Array.isArray(currentProfile.internships) ? currentProfile.internships : [];

    lawyer.set('lawyerProfile', {
      ...currentProfile,
      internships: [internship, ...currentInternships],
    });

    await lawyer.save();

    const savedInternship = lawyer.lawyerProfile?.internships?.[0];
    res.status(201).json({
      message: 'Internship published',
      internship: formatPublishedInternship(lawyer, savedInternship, { viewerId: req.user._id }),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 15. CREATE LAWYER JAM SESSION POST
exports.createLawyerJamSession = async (req, res) => {
  try {
    const lawyer = await User.findById(req.user._id);

    if (!lawyer || lawyer.role !== 'lawyer') {
      return res.status(403).json({ message: 'Only lawyers can publish jam sessions' });
    }

    const jamSession = {
      title: req.body.title?.trim(),
      topic: req.body.topic?.trim(),
      summary: req.body.summary?.trim(),
      schedule: req.body.schedule?.trim(),
      location: req.body.location?.trim(),
    };

    if (!jamSession.title || !jamSession.topic || !jamSession.summary) {
      return res.status(400).json({ message: 'Title, topic, and summary are required' });
    }

    const currentProfile = lawyer.lawyerProfile?.toObject
      ? lawyer.lawyerProfile.toObject()
      : (lawyer.lawyerProfile || {});
    const currentJamSessions = Array.isArray(currentProfile.jamSessions) ? currentProfile.jamSessions : [];

    lawyer.set('lawyerProfile', {
      ...currentProfile,
      jamSessions: [jamSession, ...currentJamSessions],
    });

    await lawyer.save();

    const savedJamSession = lawyer.lawyerProfile?.jamSessions?.[0];
    res.status(201).json({
      message: 'Jam session published',
      jamSession: formatPublishedJamSession(lawyer, savedJamSession, { viewerId: req.user._id }),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 17A. GET STUDENT DISCOVERY DATA
exports.getStudentDiscovery = async (req, res) => {
  try {
    const student = await User.findById(req.user._id).select(sanitizeUser);

    if (!student || student.role !== 'student') {
      return res.status(403).json({ message: 'Only students can access student discovery' });
    }

    const { latitude, longitude } = parseSearchCoordinates(req.query);
    const radiusKm = parseRadiusKm(req.query.radiusKm);
    const limit = parseLimit(req.query.limit, 36);

    const nearbyLawyers = await searchNearbyLawyers({
      latitude,
      longitude,
      radiusKm,
      limit,
    });

    const lawyerIds = nearbyLawyers.map((lawyer) => lawyer._id);
    const distanceLookup = new Map(
      nearbyLawyers.map((lawyer) => [String(lawyer._id), lawyer.distanceKm])
    );

    const lawyers = lawyerIds.length
      ? await User.find({ _id: { $in: lawyerIds } })
        .select(sanitizeUser)
      : [];

    const lawyerMap = new Map(lawyers.map((lawyer) => [String(lawyer._id), lawyer]));
    const orderedLawyers = nearbyLawyers
      .map((lawyer) => lawyerMap.get(String(lawyer._id)))
      .filter(Boolean);

    const feed = buildStudentFeed(orderedLawyers, student, distanceLookup);
    const internships = feed.filter((item) => item.type === 'internship');
    const jamSessions = feed.filter((item) => item.type === 'jam');
    const lawyerCards = nearbyLawyers.map(mapLawyerDiscoveryCard);

    res.json({
      origin: { latitude, longitude },
      radiusKm,
      feed,
      internships,
      jamSessions,
      lawyers: lawyerCards,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// 17B. APPLY TO INTERNSHIP
exports.applyToInternship = async (req, res) => {
  try {
    const student = await User.findById(req.user._id);

    if (!student || student.role !== 'student') {
      return res.status(403).json({ message: 'Only students can apply to internships' });
    }

    const lawyers = await User.find({ role: 'lawyer', 'lawyerProfile.internships.0': { $exists: true } });

    let targetLawyer = null;
    let internshipIndex = -1;

    lawyers.some((lawyer) => {
      internshipIndex = (lawyer.lawyerProfile?.internships || []).findIndex(
        (internship) => String(internship._id) === String(req.params.postId)
      );

      if (internshipIndex >= 0) {
        targetLawyer = lawyer;
        return true;
      }

      return false;
    });

    if (!targetLawyer || internshipIndex < 0) {
      return res.status(404).json({ message: 'Internship not found' });
    }

    if (!student.studentProfile) {
      student.studentProfile = {};
    }

    student.studentProfile.internshipApplications = student.studentProfile.internshipApplications || [];
    const alreadyApplied = student.studentProfile.internshipApplications.some(
      (item) => String(item.postId) === String(req.params.postId)
    );

    if (alreadyApplied) {
      return res.status(400).json({ message: 'You already applied to this internship' });
    }

    const {
      firstName,
      lastName,
      email,
      phone,
      collegeName,
      degree,
      yearOfStudy,
      skills,
      resumeLink,
      resumeFileName,
      coverMessage,
      linkedIn,
      portfolio,
    } = req.body;

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !phone?.trim() || !collegeName?.trim() || !degree?.trim() || !yearOfStudy?.trim()) {
      return res.status(400).json({ message: 'Please fill all required fields' });
    }

    const internship = targetLawyer.lawyerProfile.internships[internshipIndex];
    if ((internship.status || 'open') === 'closed') {
      return res.status(400).json({ message: 'This internship is closed for applications' });
    }
    internship.applications = internship.applications || [];
    internship.applications.unshift({
      studentId: student._id,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      collegeName: collegeName.trim(),
      degree: degree.trim(),
      yearOfStudy: yearOfStudy.trim(),
      skills: Array.isArray(skills) ? skills.map((item) => String(item).trim()).filter(Boolean) : [],
      resumeLink: resumeLink?.trim() || '',
      resumeFileName: resumeFileName?.trim() || '',
      coverMessage: coverMessage?.trim() || '',
      linkedIn: linkedIn?.trim() || '',
      portfolio: portfolio?.trim() || '',
      status: 'pending',
    });

    student.studentProfile.internshipApplications.unshift({
      postId: internship._id,
      lawyerId: targetLawyer._id,
      title: internship.title || 'Internship',
      status: 'applied',
    });

    student.markModified('studentProfile');
    targetLawyer.markModified('lawyerProfile');
    await Promise.all([student.save(), targetLawyer.save()]);

    // 🔔 Send notification when someone applies to an internship
    await createNotification({
      recipient: targetLawyer._id,
      actor: student._id,
      type: 'internship_application',
      title: 'New internship application',
      message: `${getNotificationDisplayName(student, 'A student')} applied to your internship: ${internship.title || 'Untitled'}`,
      link: '/lawyer-dash',
      metadata: { internshipId: internship._id, lawyerId: targetLawyer._id, studentId: student._id },
      io: req.app.get('socketio'),
    });

    res.status(201).json({
      message: 'Application submitted',
      application: {
        postId: internship._id,
        title: internship.title || 'Internship',
        appliedAt: new Date().toISOString(),
      },
      user: student.toObject(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 17C. JOIN JAM SESSION
exports.joinJamSession = async (req, res) => {
  try {
    const student = await User.findById(req.user._id);

    if (!student || student.role !== 'student') {
      return res.status(403).json({ message: 'Only students can join jam sessions' });
    }

    const lawyers = await User.find({ role: 'lawyer', 'lawyerProfile.jamSessions.0': { $exists: true } });

    let targetLawyer = null;
    let sessionIndex = -1;

    lawyers.some((lawyer) => {
      sessionIndex = (lawyer.lawyerProfile?.jamSessions || []).findIndex(
        (session) => String(session._id) === String(req.params.sessionId)
      );

      if (sessionIndex >= 0) {
        targetLawyer = lawyer;
        return true;
      }

      return false;
    });

    if (!targetLawyer || sessionIndex < 0) {
      return res.status(404).json({ message: 'Jam session not found' });
    }

    if (!student.studentProfile) {
      student.studentProfile = {};
    }

    student.studentProfile.joinedJamSessions = student.studentProfile.joinedJamSessions || [];
    const alreadyJoined = student.studentProfile.joinedJamSessions.some(
      (item) => String(item.sessionId) === String(req.params.sessionId)
    );

    if (alreadyJoined) {
      return res.status(400).json({ message: 'You already joined this jam session' });
    }

    const session = targetLawyer.lawyerProfile.jamSessions[sessionIndex];
    session.participants = session.participants || [];

    const participantName = req.body.name?.trim() || getDisplayName(student);
    const participantEmail = req.body.email?.trim() || student.email || '';

    session.participants.unshift({
      studentId: student._id,
      name: participantName,
      email: participantEmail,
      collegeName: student.studentProfile?.collegeName || '',
      yearOfStudy: student.studentProfile?.currentYear || '',
    });

    student.studentProfile.joinedJamSessions.unshift({
      sessionId: session._id,
      lawyerId: targetLawyer._id,
      title: session.title || 'Jam Session',
    });

    student.markModified('studentProfile');
    targetLawyer.markModified('lawyerProfile');
    await Promise.all([student.save(), targetLawyer.save()]);

    // 🔔 Send notification when someone joins a jam session
    await createNotification({
      recipient: targetLawyer._id,
      actor: student._id,
      type: 'jam_session_joined',
      title: 'Student joined jam session',
      message: `${getNotificationDisplayName(student, 'A student')} joined your jam session: ${session.title || 'Untitled'}`,
      link: '/lawyer-dash',
      metadata: { sessionId: session._id, lawyerId: targetLawyer._id, studentId: student._id },
      io: req.app.get('socketio'),
    });

    res.status(201).json({
      message: 'Jam session joined',
      joinedSession: {
        sessionId: session._id,
        title: session.title || 'Jam Session',
        joinedAt: new Date().toISOString(),
      },
      user: student.toObject(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const findLawyerJamSession = async (sessionId) => {
  const lawyers = await User.find({ role: 'lawyer', 'lawyerProfile.jamSessions.0': { $exists: true } });
  let targetLawyer = null;
  let sessionIndex = -1;

  lawyers.some((lawyer) => {
    sessionIndex = (lawyer.lawyerProfile?.jamSessions || []).findIndex(
      (session) => String(session._id) === String(sessionId)
    );

    if (sessionIndex >= 0) {
      targetLawyer = lawyer;
      return true;
    }

    return false;
  });

  return { targetLawyer, sessionIndex };
};

const findLawyerInternship = async (internshipId) => {
  const lawyers = await User.find({ role: 'lawyer', 'lawyerProfile.internships.0': { $exists: true } });
  let targetLawyer = null;
  let internshipIndex = -1;

  lawyers.some((lawyer) => {
    internshipIndex = (lawyer.lawyerProfile?.internships || []).findIndex(
      (internship) => String(internship._id) === String(internshipId)
    );

    if (internshipIndex >= 0) {
      targetLawyer = lawyer;
      return true;
    }

    return false;
  });

  return { targetLawyer, internshipIndex };
};

exports.toggleInternshipLike = async (req, res) => {
  try {
    if (!['student', 'lawyer'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only students and lawyers can react to internships' });
    }

    const { targetLawyer, internshipIndex } = await findLawyerInternship(req.params.postId);
    if (!targetLawyer || internshipIndex < 0) {
      return res.status(404).json({ message: 'Internship not found' });
    }

    const internship = targetLawyer.lawyerProfile.internships[internshipIndex];
    internship.likedBy = Array.isArray(internship.likedBy) ? internship.likedBy : [];
    const alreadyLiked = internship.likedBy.some((id) => String(id) === String(req.user._id));

    if (alreadyLiked) {
      internship.likedBy = internship.likedBy.filter((id) => String(id) !== String(req.user._id));
    } else {
      internship.likedBy.push(req.user._id);
    }

    targetLawyer.markModified('lawyerProfile');
    await targetLawyer.save();

    // 🔔 Send notification when someone likes an internship
    if (String(targetLawyer._id) !== String(req.user._id) && !alreadyLiked) {
      await createNotification({
        recipient: targetLawyer._id,
        actor: req.user._id,
        type: 'post_liked',
        title: 'Internship liked',
        message: `${getNotificationDisplayName(req.user, 'Someone')} liked your internship: ${internship.title || 'Untitled'}`,
        link: `/lawyer-profile/${targetLawyer._id}`,
        metadata: { internshipId: internship._id, lawyerId: targetLawyer._id },
        io: req.app.get('socketio'),
      });
    }

    res.json({
      liked: !alreadyLiked,
      likesCount: internship.likedBy.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.addInternshipComment = async (req, res) => {
  try {
    if (!['student', 'lawyer'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only students and lawyers can comment on internships' });
    }

    const text = String(req.body.text || '').trim();
    if (!text) {
      return res.status(400).json({ message: 'Comment text is required' });
    }

    const { targetLawyer, internshipIndex } = await findLawyerInternship(req.params.postId);
    if (!targetLawyer || internshipIndex < 0) {
      return res.status(404).json({ message: 'Internship not found' });
    }

    const internship = targetLawyer.lawyerProfile.internships[internshipIndex];
    internship.comments = Array.isArray(internship.comments) ? internship.comments : [];
    internship.comments.unshift({
      userId: req.user._id,
      name: getDisplayName(req.user),
      role: req.user.role,
      text,
    });

    targetLawyer.markModified('lawyerProfile');
    await targetLawyer.save();

    // 🔔 Send notification when someone comments on an internship
    if (String(targetLawyer._id) !== String(req.user._id)) {
      await createNotification({
        recipient: targetLawyer._id,
        actor: req.user._id,
        type: 'post_commented',
        title: 'New comment on internship',
        message: `${getNotificationDisplayName(req.user, 'Someone')} commented on your internship: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
        link: `/lawyer-profile/${targetLawyer._id}`,
        metadata: { internshipId: internship._id, commentText: text, lawyerId: targetLawyer._id },
        io: req.app.get('socketio'),
      });
    }

    res.status(201).json({
      comment: formatInteractionComment(internship.comments[0]),
      commentsCount: internship.comments.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.toggleJamSessionLike = async (req, res) => {
  try {
    if (!['student', 'lawyer'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only students and lawyers can react to jam sessions' });
    }

    const { targetLawyer, sessionIndex } = await findLawyerJamSession(req.params.sessionId);
    if (!targetLawyer || sessionIndex < 0) {
      return res.status(404).json({ message: 'Jam session not found' });
    }

    const session = targetLawyer.lawyerProfile.jamSessions[sessionIndex];
    session.likedBy = Array.isArray(session.likedBy) ? session.likedBy : [];
    const alreadyLiked = session.likedBy.some((id) => String(id) === String(req.user._id));

    if (alreadyLiked) {
      session.likedBy = session.likedBy.filter((id) => String(id) !== String(req.user._id));
    } else {
      session.likedBy.push(req.user._id);
    }

    targetLawyer.markModified('lawyerProfile');
    await targetLawyer.save();

    // 🔔 Send notification when someone likes a jam session
    if (String(targetLawyer._id) !== String(req.user._id) && !alreadyLiked) {
      await createNotification({
        recipient: targetLawyer._id,
        actor: req.user._id,
        type: 'post_liked',
        title: 'Jam session liked',
        message: `${getNotificationDisplayName(req.user, 'Someone')} liked your jam session: ${session.title || 'Untitled'}`,
        link: `/lawyer-profile/${targetLawyer._id}`,
        metadata: { sessionId: session._id, lawyerId: targetLawyer._id },
        io: req.app.get('socketio'),
      });
    }

    res.json({
      liked: !alreadyLiked,
      likesCount: session.likedBy.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.addJamSessionComment = async (req, res) => {
  try {
    if (!['student', 'lawyer'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only students and lawyers can comment on jam sessions' });
    }

    const text = String(req.body.text || '').trim();
    if (!text) {
      return res.status(400).json({ message: 'Comment text is required' });
    }

    const { targetLawyer, sessionIndex } = await findLawyerJamSession(req.params.sessionId);
    if (!targetLawyer || sessionIndex < 0) {
      return res.status(404).json({ message: 'Jam session not found' });
    }

    const session = targetLawyer.lawyerProfile.jamSessions[sessionIndex];
    session.comments = Array.isArray(session.comments) ? session.comments : [];
    session.comments.unshift({
      userId: req.user._id,
      name: getDisplayName(req.user),
      role: req.user.role,
      text,
    });

    targetLawyer.markModified('lawyerProfile');
    await targetLawyer.save();

    // 🔔 Send notification when someone comments on a jam session
    if (String(targetLawyer._id) !== String(req.user._id)) {
      await createNotification({
        recipient: targetLawyer._id,
        actor: req.user._id,
        type: 'post_commented',
        title: 'New comment on jam session',
        message: `${getNotificationDisplayName(req.user, 'Someone')} commented on your jam session: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
        link: `/lawyer-profile/${targetLawyer._id}`,
        metadata: { sessionId: session._id, commentText: text, lawyerId: targetLawyer._id },
        io: req.app.get('socketio'),
      });
    }

    res.status(201).json({
      comment: formatInteractionComment(session.comments[0]),
      commentsCount: session.comments.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 17D. TOGGLE INTERNSHIP STATUS
exports.toggleInternshipStatus = async (req, res) => {
  try {
    const lawyer = await User.findById(req.user._id);

    if (!lawyer || lawyer.role !== 'lawyer') {
      return res.status(403).json({ message: 'Only lawyers can manage internships' });
    }

    const internships = lawyer.lawyerProfile?.internships || [];
    const internshipIndex = internships.findIndex(
      (internship) => String(internship._id) === String(req.params.postId)
    );

    if (internshipIndex < 0) {
      return res.status(404).json({ message: 'Internship not found' });
    }

    const internship = internships[internshipIndex];
    internship.status = (internship.status || 'open') === 'open' ? 'closed' : 'open';

    lawyer.markModified('lawyerProfile');
    await lawyer.save();

    res.json({
      message: `Internship ${internship.status}`,
      internship: formatPublishedInternship(lawyer, internship),
      stats: getLawyerInteractionStats(lawyer),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 17E. DELETE INTERNSHIP
exports.deleteLawyerInternship = async (req, res) => {
  try {
    const lawyer = await User.findById(req.user._id);

    if (!lawyer || lawyer.role !== 'lawyer') {
      return res.status(403).json({ message: 'Only lawyers can manage internships' });
    }

    const internships = lawyer.lawyerProfile?.internships || [];
    const internshipIndex = internships.findIndex(
      (internship) => String(internship._id) === String(req.params.postId)
    );

    if (internshipIndex < 0) {
      return res.status(404).json({ message: 'Internship not found' });
    }

    const [removedInternship] = internships.splice(internshipIndex, 1);
    lawyer.markModified('lawyerProfile');
    await lawyer.save();

    if (removedInternship?.applications?.length) {
      const affectedStudentIds = [
        ...new Set(
          removedInternship.applications
            .map((application) => application.studentId && String(application.studentId))
            .filter(Boolean)
        ),
      ];

      if (affectedStudentIds.length) {
        await User.updateMany(
          { _id: { $in: affectedStudentIds } },
          { $pull: { 'studentProfile.internshipApplications': { postId: removedInternship._id } } }
        );
      }
    }

    res.json({
      message: 'Internship deleted',
      deletedPostId: req.params.postId,
      stats: getLawyerInteractionStats(lawyer),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 17F. UPDATE APPLICANT STATUS
exports.updateInternshipApplicantStatus = async (req, res) => {
  try {
    const lawyer = await User.findById(req.user._id);

    if (!lawyer || lawyer.role !== 'lawyer') {
      return res.status(403).json({ message: 'Only lawyers can manage applicants' });
    }

    const nextStatus = String(req.body.status || '').toLowerCase();
    if (!['pending', 'accepted', 'rejected'].includes(nextStatus)) {
      return res.status(400).json({ message: 'Invalid applicant status' });
    }

    const internships = lawyer.lawyerProfile?.internships || [];
    const internship = internships.find((item) => String(item._id) === String(req.params.postId));

    if (!internship) {
      return res.status(404).json({ message: 'Internship not found' });
    }

    const applicant = (internship.applications || []).find(
      (application) => String(application._id) === String(req.params.applicationId)
    );

    if (!applicant) {
      return res.status(404).json({ message: 'Applicant not found' });
    }

    applicant.status = nextStatus;
    lawyer.markModified('lawyerProfile');
    await lawyer.save();

    const student = applicant.studentId ? await User.findById(applicant.studentId) : null;
    if (student?.studentProfile?.internshipApplications?.length) {
      const studentApplication = student.studentProfile.internshipApplications.find(
        (application) => String(application.postId) === String(req.params.postId)
      );

      if (studentApplication) {
        studentApplication.status = nextStatus;
        student.markModified('studentProfile');
        await student.save();

        // 🔔 Send notification when application status changes
        await createNotification({
          recipient: student._id,
          actor: lawyer._id,
          type: 'internship_application_update',
          title: `Internship application ${nextStatus}`,
          message: `Your application for "${internship.title || 'Internship'}" has been ${nextStatus} by ${getNotificationDisplayName(lawyer, 'the lawyer')}.`,
          link: '/student-dash',
          metadata: { internshipId: internship._id, lawyerId: lawyer._id, status: nextStatus },
          io: req.app.get('socketio'),
        });
      }
    }

    res.json({
      message: `Applicant ${nextStatus}`,
      applicant: {
        id: applicant._id,
        status: applicant.status,
      },
      stats: getLawyerInteractionStats(lawyer),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 16. GET ALL PUBLISHED INTERNSHIPS
exports.getPublishedInternships = async (req, res) => {
  try {
    const viewerId = getOptionalViewerId(req);
    const lawyers = await User.find({ role: 'lawyer', 'lawyerProfile.internships.0': { $exists: true } })
      .select(sanitizeUser)
      .sort({ createdAt: -1 });

    const internships = lawyers.flatMap((lawyer) =>
      (lawyer.lawyerProfile?.internships || []).map((internship) =>
        formatPublishedInternship(lawyer, internship, { viewerId })
      )
    ).sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0));

    res.json(internships);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 17. GET ALL PUBLISHED JAM SESSIONS
exports.getPublishedJamSessions = async (req, res) => {
  try {
    const viewerId = getOptionalViewerId(req);
    const lawyers = await User.find({ role: 'lawyer', 'lawyerProfile.jamSessions.0': { $exists: true } })
      .select(sanitizeUser)
      .sort({ createdAt: -1 });

    const jamSessions = lawyers.flatMap((lawyer) =>
      (lawyer.lawyerProfile?.jamSessions || []).map((session) =>
        formatPublishedJamSession(lawyer, session, { viewerId })
      )
    ).sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0));

    res.json(jamSessions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 18. VERIFY LAWYER (Admin Only)
exports.verifyLawyer = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { 'lawyerProfile.isVerified': req.body.isVerified }, { new: true });
    
    // 🔔 Send notification to the lawyer
    if (user) {
      await createNotification({
        recipient: user._id,
        type: 'system',
        title: user.lawyerProfile?.isVerified ? 'Profile verified' : 'Profile verification updated',
        message: user.lawyerProfile?.isVerified 
          ? 'Congratulations! Your profile has been verified by the administrator.' 
          : 'Your verification status has been updated by the administrator.',
        link: '/lawyer-profile/me',
        io: req.app.get('socketio'),
      });
    }

    console.log(`👮 Lawyer ${user.phone} verification set to ${req.body.isVerified}`);
    res.json(user);
  } catch (error) { res.status(500).json({ message: error.message }); }
};
