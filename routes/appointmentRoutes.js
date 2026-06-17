const express = require('express');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { createNotification, getDisplayName } = require('../services/notificationService');

const router = express.Router();
router.use(protect);

const populateAppointment = [
  {
    path: 'userId',
    select: 'firstName lastName profileImage phone'
  },
  {
    path: 'lawyerId',
    select: 'firstName lastName profileImage phone lawyerProfile.specialization'
  }
];

const normalizeStatus = (status) => {
  if (!status) return undefined;

  const formattedStatus = String(status).toLowerCase();
  if (['pending', 'accepted', 'rejected'].includes(formattedStatus)) {
    return formattedStatus;
  }

  return undefined;
};

// Create request
router.post('/', async (req, res) => {
  const { userId, lawyerId } = req.body;
  const requesterId = req.user?._id;

  if (String(requesterId) !== String(userId)) {
    return res.status(403).json({ message: 'You can only create appointments for your own account' });
  }

  const existingAppointment = await Appointment.findOne({
    userId,
    lawyerId
  });

  if (existingAppointment) {
    const populatedExistingAppointment = await Appointment.findById(existingAppointment._id).populate(populateAppointment);
    return res.json(populatedExistingAppointment);
  }

  const appointment = await Appointment.create({
    userId,
    lawyerId
  });

  const populatedAppointment = await Appointment.findById(appointment._id).populate(populateAppointment);
  const client = await User.findById(userId).select('firstName lastName role profileImage');

  await createNotification({
    recipient: lawyerId,
    actor: userId,
    type: 'appointment_request',
    title: 'New appointment request',
    message: `${getDisplayName(client, 'A user')} requested an appointment with you.`,
    link: '/lawyer-dash',
    metadata: { appointmentId: appointment._id },
    io: req.app.get('socketio'),
  });

  res.json(populatedAppointment);
});

// Get lawyer appointments
router.get('/:lawyerId', async (req, res) => {
  const isLawyerOwner = req.user.role === 'lawyer' && String(req.user._id) === String(req.params.lawyerId);
  const isClient = req.user.role === 'user';

  if (!isLawyerOwner && !isClient) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const query = { lawyerId: req.params.lawyerId };
  if (isClient) {
    query.userId = req.user._id;
  }

  const data = await Appointment.find(query)
    .populate(populateAppointment)
    .sort({ createdAt: -1 });

  res.json(data);
});

// Accept / Reject
router.put('/:id', async (req, res) => {
  if (req.user.role !== 'lawyer') {
    return res.status(403).json({ message: 'Only lawyers can update appointment status' });
  }

  const status = normalizeStatus(req.body.status);

  if (!status) {
    return res.status(400).json({ message: 'Invalid appointment status' });
  }

  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) {
    return res.status(404).json({ message: 'Appointment not found' });
  }

  if (String(appointment.lawyerId) !== String(req.user._id)) {
    return res.status(403).json({ message: 'You can only update your own appointments' });
  }

  const updated = await Appointment.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true }
  ).populate(populateAppointment);

  const lawyer = updated.lawyerId;
  const notificationType = status === 'accepted' ? 'appointment_accepted' : 'appointment_rejected';
  const notificationTitle = status === 'accepted'
    ? 'Lawyer accepted your request'
    : 'Lawyer rejected your request';

  await createNotification({
    recipient: updated.userId?._id || updated.userId,
    actor: updated.lawyerId?._id || updated.lawyerId,
    type: notificationType,
    title: notificationTitle,
    message: `${getDisplayName(lawyer, 'Your lawyer')} ${status} your appointment request.`,
    link: `/lawyer-profile/${updated.lawyerId?._id || updated.lawyerId}`,
    metadata: { appointmentId: updated._id, status },
    io: req.app.get('socketio'),
  });

  res.json(updated);
});

module.exports = router;
