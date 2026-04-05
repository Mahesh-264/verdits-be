const express = require('express');
const Appointment = require('../models/Appointment');

const router = express.Router();

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

  res.json(populatedAppointment);
});

// Get lawyer appointments
router.get('/:lawyerId', async (req, res) => {
  const data = await Appointment.find({
    lawyerId: req.params.lawyerId
  })
    .populate(populateAppointment)
    .sort({ createdAt: -1 });

  res.json(data);
});

// Accept / Reject
router.put('/:id', async (req, res) => {
  const status = normalizeStatus(req.body.status);

  if (!status) {
    return res.status(400).json({ message: 'Invalid appointment status' });
  }

  const updated = await Appointment.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true }
  ).populate(populateAppointment);

  res.json(updated);
});

module.exports = router;
