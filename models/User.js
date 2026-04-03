const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true }, // Added field
  phone: { type: String, unique: true, required: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['user', 'lawyer', 'admin'], default: 'user' },
  profileImage: { type: String, default: "" }, // Added for lawyer photo
  address: {
    latitude: Number,
    longitude: Number,
    pincode: String,
    state: String,
    district: String,
    city: String, // Added city for location filtering
    country: { type: String, default: "India" },
  },
  refreshToken: String,
  otp: { type: String, select: false },
  otpExpires: { type: Date, select: false },
  lawyerProfile: {
    barId: String,
    specialization: String, // e.g., "Criminal", "Civil"
    experienceYears: Number,
    about: String, // Added for the "About" section in profile
    successRate: { type: Number, default: 0 }, // Added for UI
    casesHandled: { type: Number, default: 0 }, // Added for UI
    languages: [String], // e.g., ["Hindi", "English"]
    consultationFee: { type: Number, default: 500 }, // Added fee
    isVerified: { type: Boolean, default: false }
  },
}, { timestamps: true });



// Hash password before saving
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  console.log(`🔐 Hashing password for: ${this.phone}`);
  this.password = await bcrypt.hash(this.password, 12);
});

// Helper for Login
userSchema.methods.matchPassword = async function(enteredPassword) {
  console.log(`🔑 Comparing password for: ${this.phone}`);
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);