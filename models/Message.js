const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // 🟢 FIX 1: Added 'vendor' and 'doctor' to match your other app roles
  senderRole: {
    type: String,
    required: true,
    enum: ['user', 'lawyer', 'admin', 'vendor', 'doctor'], 
  },
  // 🟢 FIX 2: Added 'video' so Cloudinary video uploads don't crash the DB
  messageType: {
    type: String,
    enum: ['text', 'image', 'audio', 'video'], 
    default: 'text'
  },
  content: { 
    type: String, 
    required: function() { return this.messageType === 'text'; } 
  },
  mediaUrl: String,      // Cloudinary URL
  mediaPublicId: String, // For Cloudinary deletions
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
});

module.exports = mongoose.model('Message', MessageSchema);