const mongoose = require('mongoose');

const caseMessageSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    hearingRef: {
      hearingDate: { type: Date, default: null },
      courtName: { type: String, default: '' },
      hearingDetails: { type: String, default: '' },
      nextHearingDate: { type: Date, default: null },
    },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

caseMessageSchema.index({ caseId: 1, createdAt: 1 });

module.exports = mongoose.model('CaseMessage', caseMessageSchema);
