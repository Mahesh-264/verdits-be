const Message = require("../models/Message");
const User = require("../models/User");
const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");
const mongoose = require("mongoose");

// --- Helper: Cloudinary Upload ---
const uploadToCloudinary = (buffer, messageType) => {
  return new Promise((resolve, reject) => {
    const resourceType = (messageType === 'audio' || messageType === 'video') ? 'video' : 'image';
    const stream = cloudinary.uploader.upload_stream(
      { folder: "legal_chat_media", resource_type: resourceType },
      (err, result) => {
        if (result) resolve({ url: result.secure_url, publicId: result.public_id });
        else reject(err);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
};

// 🟢 1. SEND MESSAGE
exports.sendMessage = async (req, res) => {
  try {
    const { receiverId, messageType, content } = req.body;
    const newMessageData = {
      sender: req.user.id,
      receiver: receiverId,
      senderRole: req.user.role,
      messageType: messageType || 'text',
      content,
      timestamp: new Date()
    };

    if (req.file) {
      const { url, publicId } = await uploadToCloudinary(req.file.buffer, newMessageData.messageType);
      newMessageData.mediaUrl = url;
      newMessageData.mediaPublicId = publicId;
    }

    const message = await Message.create(newMessageData);
    
    // 🚨 FIX IS HERE: Added 'name' and 'profileImage'
    const populated = await message.populate("sender", "name phone profileImage role lawyerProfile.specialization");

    const io = req.app.get("socketio");
    if (io) {
      io.to(req.user.id.toString()).emit("newMessage", populated);
      io.to(receiverId.toString()).emit("newMessage", populated);
    }
    res.status(201).json({ success: true, message: populated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🟡 2. GET CONVERSATIONS
exports.getConversations = async (req, res) => {
  try {
    const myId = new mongoose.Types.ObjectId(req.user.id);
    const chatList = await Message.aggregate([
      { $match: { $or: [{ sender: myId }, { receiver: myId }] } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: { $cond: [{ $eq: ["$sender", myId] }, "$receiver", "$sender"] },
          lastMessage: { $first: "$content" },
          lastMessageType: { $first: "$messageType" },
          timestamp: { $first: "$timestamp" },
          unreadCount: {
            $sum: { $cond: [{ $and: [{ $eq: ["$receiver", myId] }, { $eq: ["$read", false] }] }, 1, 0] }
          }
        }
      },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "contactInfo" } },
      { $unwind: "$contactInfo" },
      {
        $project: {
          _id: 1, lastMessage: 1, lastMessageType: 1, timestamp: 1, unreadCount: 1,
          contact: {
            _id: "$contactInfo._id",
            name: "$contactInfo.name",               // 🚨 FIX IS HERE: Included name
            profileImage: "$contactInfo.profileImage", // 🚨 FIX IS HERE: Included profileImage
            phone: "$contactInfo.phone",
            role: "$contactInfo.role",
            specialization: "$contactInfo.lawyerProfile.specialization"
          }
        }
      },
      { $sort: { timestamp: -1 } }
    ]);
    res.status(200).json({ success: true, chatList });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🔵 3. GET HISTORY
exports.getHistory = async (req, res) => {
  try {
    const myId = new mongoose.Types.ObjectId(req.user.id);
    const partnerId = new mongoose.Types.ObjectId(req.params.partnerId);
    const messages = await Message.find({
      $or: [{ sender: myId, receiver: partnerId }, { sender: partnerId, receiver: myId }]
    }).sort({ timestamp: 1 });
    res.status(200).json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🟠 4. MARK READ
exports.markRead = async (req, res) => {
  try {
    await Message.updateMany(
      { sender: req.params.partnerId, receiver: req.user.id, read: false },
      { $set: { read: true } }
    );
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🔴 5. SINGLE DELETE
exports.deleteMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.sender.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    if (message.mediaPublicId) {
      const type = (message.messageType === 'audio' || message.messageType === 'video') ? 'video' : 'image';
      await cloudinary.uploader.destroy(message.mediaPublicId, { resource_type: type });
    }

    await Message.findByIdAndDelete(req.params.id);

    const io = req.app.get("socketio");
    if (io) {
      io.to(message.sender.toString()).emit("messageDeleted", req.params.id);
      io.to(message.receiver.toString()).emit("messageDeleted", req.params.id);
    }
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🔥 6. BATCH DELETE (Multiple Selection)
exports.deleteBatch = async (req, res) => {
  try {
    const { ids } = req.body; 
    const myId = req.user.id;

    const messages = await Message.find({ _id: { $in: ids }, sender: myId });
    
    if (messages.length === 0) return res.status(404).json({ success: false, message: "No messages found" });

    const cloudinaryDeletions = messages
      .filter(m => m.mediaPublicId)
      .map(m => {
        const type = (m.messageType === 'audio' || m.messageType === 'video') ? 'video' : 'image';
        return cloudinary.uploader.destroy(m.mediaPublicId, { resource_type: type });
      });
    
    await Promise.all(cloudinaryDeletions);

    await Message.deleteMany({ _id: { $in: ids }, sender: myId });

    const io = req.app.get("socketio");
    if (io) {
      messages.forEach(m => {
        io.to(m.sender.toString()).emit("messageDeleted", m._id);
        io.to(m.receiver.toString()).emit("messageDeleted", m._id);
      });
    }

    res.status(200).json({ success: true, deletedIds: ids });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};