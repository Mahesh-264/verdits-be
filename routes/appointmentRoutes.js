import express from "express";
import Appointment from "../models/Appointment.js";

const router = express.Router();

// Create request
router.post("/", async (req, res) => {
  const { userId, lawyerId } = req.body;

  const appointment = await Appointment.create({
    userId,
    lawyerId
  });

  res.json(appointment);
});

// Get lawyer appointments
router.get("/:lawyerId", async (req, res) => {
  const data = await Appointment.find({
    lawyerId: req.params.lawyerId
  });

  res.json(data);
});

// Accept / Reject
router.put("/:id", async (req, res) => {
  const { status } = req.body;

  const updated = await Appointment.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true }
  );

  res.json(updated);
});

export default router;