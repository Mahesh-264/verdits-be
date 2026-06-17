const Notification = require('../models/Notification');

const createNotification = async ({
  recipient,
  actor = null,
  type = 'system',
  title,
  message,
  link = '',
  metadata = {},
  io = null,
}) => {
  if (!recipient || !title || !message) return null;

  const notification = await Notification.create({
    recipient,
    actor,
    type,
    title,
    message,
    link,
    metadata,
  });

  const populated = await notification.populate(
    'actor',
    'firstName lastName profileImage role lawyerProfile.specialization'
  );

  if (io) {
    io.to(String(recipient)).emit('notification:new', populated);
  }

  return populated;
};

const getDisplayName = (user, fallback = 'Someone') => {
  if (!user) return fallback;
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.name || fallback;
};

module.exports = {
  createNotification,
  getDisplayName,
};
