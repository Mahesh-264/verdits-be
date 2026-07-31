const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
  lawyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String,
  email: String,
  phone: String,
  joinedAt: { type: Date, default: Date.now },
}, { _id: true });

const teamRequestSchema = new mongoose.Schema({
  lawyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String,
  email: String,
  phone: String,
  requestedAt: { type: Date, default: Date.now },
}, { _id: true });

const teamCaseSchema = new mongoose.Schema({
  clientName: String,
  caseTitle: String,
  caseDetails: String,
  basicInfo: String,
  courtName: String,
  hearingDate: Date,
  documents: [
    {
      name: String,
      url: String,
    },
  ],
  status: {
    type: String,
    enum: ['new', 'in_progress', 'hearing_scheduled', 'closed'],
    default: 'new',
  },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  addedByName: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { _id: true });

const teamSchema = new mongoose.Schema({
  teamCode: { type: String, uppercase: true, trim: true, unique: true, required: true },
  firmName: { type: String, required: true },
  seniorLawyerName: { type: String, required: true },
  maxTeamSize: { type: Number, min: 2, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [teamMemberSchema],
  pendingRequests: [teamRequestSchema],
  cases: [teamCaseSchema],
}, { timestamps: true });

teamSchema.index({ owner: 1 });
teamSchema.index({ 'members.lawyerId': 1 });
teamSchema.index({ 'pendingRequests.lawyerId': 1 });

module.exports = mongoose.model('Team', teamSchema);
