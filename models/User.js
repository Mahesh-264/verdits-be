const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  phone: { type: String, unique: true, required: true },
  password: { type: String, required: false, select: false }, // optional for pure OTP users
  role: { type: String, enum: ['user', 'lawyer', 'student', 'admin'], default: 'user' },
  profileImage: { type: String, default: "" },
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
  studentProfile: {
    collegeName: String,
    collegeEmail: String,
    bio: String,
    currentYear: String,
    specializations: [String],
    skills: [String],
    internships: [
      {
        role: String,
        org: String,
        period: String,
        description: String,
      }
    ],
    followingLawyers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    connectedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    connectionRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    outgoingConnectionRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  }
}, { timestamps: true });

// Virtual for full name
userSchema.virtual('name').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Ensure virtuals are included in JSON and Object output
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

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
