const User = require('../models/User');
const jwt = require('jsonwebtoken');

const generateTokens = (id, role) => {
  console.log(`🎫 Tokens requested for: ${id} [${role}]`);
  const accessToken = jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '1y' });
  return { accessToken, refreshToken };
};

// 1. REGISTER
exports.register = async (req, res) => {
  try {
    const { name, phone, password, role, address, barId, specialization, experienceYears, about, languages, consultationFee } = req.body;
    
    if (await User.findOne({ phone })) return res.status(400).json({ message: 'Phone exists' });

    const userData = { name, phone, password, role, address };
    
    if (role === 'lawyer') {
      userData.lawyerProfile = { 
        barId, specialization, experienceYears, about, languages, consultationFee,
        isVerified: false 
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
    console.log("🚀 Login request:", req.body.phone);
    const { phone, password } = req.body;
    const user = await User.findOne({ phone }).select('+password');
    
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = generateTokens(user._id, user.role);
    user.refreshToken = refreshToken;
    await user.save();

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: true, sameSite: 'none' });
    console.log("✅ Login Successful.");
    res.json({ accessToken, user }); // Simplified response
  } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. SEND OTP
exports.sendOTP = async (req, res) => {
  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const user = await User.findOneAndUpdate(
      { phone: req.body.phone },
      { otp, otpExpires: Date.now() + 600000 },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    console.log(`📡 OTP for ${req.body.phone}: ${otp}`);
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
    
    // Base Query: Must be a lawyer
    let query = { role: 'lawyer' }; 

    // Filter by District
    if (district) query['address.district'] = district;

    // Filter by Specialization (Regex for flexible matching)
    if (specialization) {
        // e.g., "Family" matches "Family Law", "family", "Family/Marital"
        query['lawyerProfile.specialization'] = { $regex: specialization, $options: 'i' };
    }
    
    const lawyers = await User.find(query).select('-password -refreshToken -otp');
    res.json(lawyers);
  } catch (error) { 
    res.status(500).json({ message: error.message }); 
  }
};

// 7. GET LAWYER BY ID (Profile View)
exports.getLawyerById = async (req, res) => {
  try {
    const lawyer = await User.findById(req.params.id).select('-password -refreshToken -otp');
    if (!lawyer || lawyer.role !== 'lawyer') {
      return res.status(404).json({ message: "Lawyer not found" });
    }
    res.json(lawyer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 8. UPDATE PROFILE (User & Lawyer)
exports.updateProfile = async (req, res) => {
  try {
    // Note: We use findById to ensure we get the Mongoose document instance
    const user = await User.findById(req.user._id);

    if (!user) return res.status(404).json({ message: "User not found" });

    // Update Basic Fields
    if (req.body.name) user.name = req.body.name;
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

    await user.save();
    console.log(`🔄 Profile updated for: ${user.phone}`);
    res.json({ message: "Updated", user });
  } catch (error) { 
      res.status(500).json({ message: error.message }); 
  }
};

// 9. VERIFY LAWYER (Admin Only)
exports.verifyLawyer = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { 'lawyerProfile.isVerified': req.body.isVerified }, { new: true });
    console.log(`👮 Lawyer ${user.phone} verification set to ${req.body.isVerified}`);
    res.json(user);
  } catch (error) { res.status(500).json({ message: error.message }); }
};