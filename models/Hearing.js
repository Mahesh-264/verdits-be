const mongoose = require('mongoose');

const hearingSchema = new mongoose.Schema(
  {
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, immutable: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true, immutable: true },
    scheduledAt: { type: Date, required: true },
    courtName: { type: String, trim: true, maxlength: 300, default: '' },
    courtroom: { type: String, trim: true, maxlength: 200, default: '' },
    notes: { type: String, trim: true, maxlength: 10000, default: '' },
    status: { type: String, enum: ['scheduled', 'completed', 'adjourned', 'cancelled'], default: 'scheduled' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

hearingSchema.index({ caseId: 1, scheduledAt: 1 });
hearingSchema.index({ teamId: 1, scheduledAt: 1 });

module.exports = mongoose.model('Hearing', hearingSchema);
