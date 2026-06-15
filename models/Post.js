const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['general', 'internship', 'jam'],
      default: 'general',
    },
    content: { type: String, required: true, trim: true },
    media: [{ type: String }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    visibility: {
      type: String,
      enum: ['public', 'connections'],
      default: 'public',
    },
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: String,
        role: String,
        text: { type: String, trim: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    tags: [{ type: String }],
    title: { type: String, trim: true },
    location: { type: String, trim: true },
    stipend: { type: String, trim: true },
    duration: { type: String, trim: true },
    schedule: { type: String, trim: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sourceModel: { type: String, default: 'Post' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Post', postSchema);
