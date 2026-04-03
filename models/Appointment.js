import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  lawyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  status: {
    type: String,
    enum: ["pending", "accepted", "rejected"],
    default: "pending"
  }
}, { timestamps: true });

export default mongoose.model("Appointment", appointmentSchema);