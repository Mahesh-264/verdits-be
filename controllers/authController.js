const User = require('../models/User');
const Otp = require('../models/Otp');
const jwt = require('jsonwebtoken');

const sanitizeUser = '-password -refreshToken -otp';

const getDisplayName = (user) => {
  if (!user) return 'Lawyer';
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.name || 'Lawyer';
};

const formatPublishedInternship = (lawyer, internship) => ({
  id: internship._id,
  lawyerId: lawyer._id,
  lawyerName: getDisplayName(lawyer),
  profileImage: lawyer.profileImage || '',
  avatar: getDisplayName(lawyer).charAt(0).toUpperCase(),
  title: internship.title || 'Internship',
  firm: internship.firm || lawyer.address?.city || lawyer.address?.district || 'Lawin',
  specialization: internship.specialization || [],
  description: internship.description || '',
  duration: internship.duration || 'Not specified',
  location: internship.location || lawyer.address?.city || lawyer.address?.district || 'Not specified',
  stipend: internship.stipend || 'Not specified',
  skills: internship.skills || [],
  createdAt: internship.createdAt,
  postedAt: internship.createdAt ? `Posted ${new Date(internship.createdAt).toLocaleDateString()}` : 'Recently posted',
});

const formatPublishedJamSession = (lawyer, session) => ({
  id: session._id,
  lawyerId: lawyer._id,
  author: getDisplayName(lawyer),
  profileImage: lawyer.profileImage || '',
  avatar: getDisplayName(lawyer).charAt(0).toUpperCase(),
  title: session.title || 'Jam Session',
  topic: session.topic || 'General Discussion',
  summary: session.summary || '',
  schedule: session.schedule || '',
  createdAt: session.createdAt,
  time: session.createdAt ? new Date(session.createdAt).toLocaleDateString() : 'Recently posted',
  meta: lawyer.lawyerProfile?.specialization || 'Lawyer',
  participants: 'Open for students',
  comments: '0 comments',
});

const generateTokens = (id, role) => {
  console.log(`🎫 Tokens requested for: ${id} [${role}]`);
  const accessToken = jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '1y' });
  return { accessToken, refreshToken };
};

// 1. REGISTER
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, role, address, barId, specialization, experienceYears, about, languages, consultationFee, collegeName, collegeEmail, otp } = req.body;
    
    if (phone && await User.findOne({ phone })) return res.status(400).json({ message: 'Phone exists' });
    if (email && await User.findOne({ email })) return res.status(400).json({ message: 'Email exists' });

    // Removed OTP validation for User and Student as per requirement

    const userData = { firstName, lastName, email, phone, password, role, address };
    
    if (role === 'lawyer') {
      userData.lawyerProfile = { 
        barId, specialization, experienceYears, about, languages, consultationFee,
        isVerified: false 
      };
    } else if (role === 'student') {
      userData.studentProfile = {
        collegeName, collegeEmail
      };
    }
    
    const user = await User.create(userData);
    const { accessToken, refreshToken } = generateTokens(user._id, user.role);
    user.refreshToken = refreshToken;
    await user.save();

    res.status(201).json({ accessToken, user });
  } catch (error) { 
    res.status(500).json({ message: error.message }); 
  }
};

// 2. LOGIN
exports.login = async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    let user;
    if (email) {
      console.log("🚀 Login request:", email);
      user = await User.findOne({ email }).select('+password');
    } else if (phone) {
      console.log("🚀 Login request:", phone);
      user = await User.findOne({ phone }).select('+password');
    }
    
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = generateTokens(user._id, user.role);
    user.refreshToken = refreshToken;
    await user.save();

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: true, sameSite: 'none' });
    console.log("✅ Login Successful.");
    res.json({ accessToken, user });
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
    const user = await User.findOne({ phone, otp, otpExpires: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ message: "Invalid/Expired OTP" });

    user.otp = undefined; user.otpExpires = undefined;
    const { accessToken, refreshToken } = generateTokens(user._id, user.role);
    user.refreshToken = refreshToken;
    await user.save();
    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: true, sameSite: 'none' });
    res.json({ accessToken, user });
  } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. REFRESH TOKEN
exports.refresh = async (req, res) => {
  const token = req.cookies.refreshToken;
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
    if (specialization) {
        // e.g., "Family" matches "Family Law", "family", "Family/Marital"
        query['lawyerProfile.specialization'] = { $regex: specialization, $options: 'i' };
    }
    
    const lawyers = await User.find(query).select(sanitizeUser);
    res.json(lawyers);
  } catch (error) { 
    res.status(500).json({ message: error.message }); 
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

    const lawyerId = String(lawyer._id);
    const alreadyFollowing = student.studentProfile.followingLawyers.some(
      (id) => String(id) === lawyerId
    );

    if (alreadyFollowing) {
      student.studentProfile.followingLawyers = student.studentProfile.followingLawyers.filter(
        (id) => String(id) !== lawyerId
      );
    } else {
      student.studentProfile.followingLawyers.push(lawyer._id);
    }

    student.markModified('studentProfile');
    await student.save();

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

    requester.studentProfile.outgoingConnectionRequests = requester.studentProfile.outgoingConnectionRequests.filter(
      (id) => String(id) !== String(student._id)
    );

    if (!requester.studentProfile.connectedStudents.some((id) => String(id) === String(student._id))) {
      requester.studentProfile.connectedStudents.push(student._id);
    }

    student.markModified('studentProfile');
    requester.markModified('studentProfile');
    await student.save();
    await requester.save();

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
    if (req.body.firstName) user.firstName = req.body.firstName;
    if (req.body.lastName) user.lastName = req.body.lastName;
    if (req.body.email) user.email = req.body.email;
    if (req.body.age) user.age = req.body.age;
    if (req.body.gender) user.gender = req.body.gender;

    // Update Address (Merge existing with new)
    if (req.body.address) {
        user.address = { ...user.address, ...req.body.address };
    }

    // Update Lawyer Specifics
    if (req.body.lawyerProfile && user.role === 'lawyer') {
      user.lawyerProfile = { 
          ...user.lawyerProfile, 
          ...req.body.lawyerProfile, 
          isVerified: false // Reset verification on profile edit
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
      res.status(500).json({ message: error.message }); 
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
      .map((internship) => formatPublishedInternship(lawyer, internship));

    const jamSessions = (lawyer.lawyerProfile?.jamSessions || [])
      .slice()
      .sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0))
      .map((session) => formatPublishedJamSession(lawyer, session));

    res.json({ internships, jamSessions });
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
      internship: formatPublishedInternship(lawyer, savedInternship),
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
      jamSession: formatPublishedJamSession(lawyer, savedJamSession),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 16. GET ALL PUBLISHED INTERNSHIPS
exports.getPublishedInternships = async (req, res) => {
  try {
    const lawyers = await User.find({ role: 'lawyer', 'lawyerProfile.internships.0': { $exists: true } })
      .select(sanitizeUser)
      .sort({ createdAt: -1 });

    const internships = lawyers.flatMap((lawyer) =>
      (lawyer.lawyerProfile?.internships || []).map((internship) => formatPublishedInternship(lawyer, internship))
    ).sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0));

    res.json(internships);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 17. GET ALL PUBLISHED JAM SESSIONS
exports.getPublishedJamSessions = async (req, res) => {
  try {
    const lawyers = await User.find({ role: 'lawyer', 'lawyerProfile.jamSessions.0': { $exists: true } })
      .select(sanitizeUser)
      .sort({ createdAt: -1 });

    const jamSessions = lawyers.flatMap((lawyer) =>
      (lawyer.lawyerProfile?.jamSessions || []).map((session) => formatPublishedJamSession(lawyer, session))
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
    console.log(`👮 Lawyer ${user.phone} verification set to ${req.body.isVerified}`);
    res.json(user);
  } catch (error) { res.status(500).json({ message: error.message }); }
};
