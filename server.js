require('dotenv').config();
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/db');
const { createNotification, getDisplayName } = require('./services/notificationService');

const app = express();
const server = http.createServer(app); 

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => callback(null, true),
        credentials: true
    }
});

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error: Token missing"));

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        socket.userRole = decoded.role;
        next();
    } catch (err) {
        next(new Error("Authentication error: Invalid token"));
    }
});

io.on("connection", (socket) => {
    console.log(`🔗 Connected: ${socket.userId}`);
    socket.join(socket.userId); 

    socket.on("sendMessage", async ({ receiverId, content }) => {
        try {
            const Message = require("./models/Message"); 

            const newMessage = new Message({
                sender: socket.userId,
                receiver: receiverId,
                senderRole: socket.userRole,
                content: content,
                timestamp: new Date()
            });
            await newMessage.save();

            // 🌟 THE ULTIMATE FIX: Populate BOTH the Sender AND Receiver!
            // Now the frontend gets all the data it needs instantly.
            const populated = await newMessage.populate([
                { path: "sender", select: "firstName lastName phone profileImage role lawyerProfile.specialization" },
                { path: "receiver", select: "firstName lastName phone profileImage role lawyerProfile.specialization" }
            ]);

            io.to(socket.userId).emit("newMessage", populated);
            io.to(receiverId).emit("newMessage", populated);
            await createNotification({
                recipient: receiverId,
                actor: socket.userId,
                type: 'new_message',
                title: 'New message received',
                message: `${getDisplayName(populated.sender, 'Someone')} sent you a message.`,
                link: `/chat?partnerId=${socket.userId}`,
                metadata: { messageId: newMessage._id, senderId: socket.userId, receiverId },
                io,
            });

        } catch (err) {
            console.error("Socket Error:", err);
            socket.emit("error", { message: "Message failed to send" });
        }
    });

    socket.on("disconnect", () => {
        console.log("❌ Offline:", socket.userId);
    });

    // 🔔 Real-time Post Notifications
    socket.on("postLiked", async ({ postId, postCreatorId }) => {
        try {
            if (String(postCreatorId) !== String(socket.userId)) {
                io.to(String(postCreatorId)).emit("notification:update", {
                    type: 'post_liked',
                    title: 'Your post was liked',
                    actor: socket.userId,
                });
            }
        } catch (err) {
            console.error("Socket Error (postLiked):", err);
        }
    });

    socket.on("postCommented", async ({ postId, postCreatorId, comment }) => {
        try {
            if (String(postCreatorId) !== String(socket.userId)) {
                io.to(String(postCreatorId)).emit("notification:update", {
                    type: 'post_commented',
                    title: 'New comment on your post',
                    actor: socket.userId,
                    comment: comment.substring(0, 50),
                });
            }
        } catch (err) {
            console.error("Socket Error (postCommented):", err);
        }
    });

    // 🔔 Real-time Follow/Connection Notifications
    socket.on("lawyerFollowed", async ({ lawyerId }) => {
        try {
            if (String(lawyerId) !== String(socket.userId)) {
                io.to(String(lawyerId)).emit("notification:update", {
                    type: 'follow_accepted',
                    title: 'You have a new follower',
                    actor: socket.userId,
                });
            }
        } catch (err) {
            console.error("Socket Error (lawyerFollowed):", err);
        }
    });

    socket.on("connectionRequested", async ({ targetStudentId }) => {
        try {
            io.to(String(targetStudentId)).emit("notification:update", {
                type: 'student_connection_request',
                title: 'New student connection request',
                actor: socket.userId,
            });
        } catch (err) {
            console.error("Socket Error (connectionRequested):", err);
        }
    });

    socket.on("appointmentStatusChanged", async ({ studentId, status }) => {
        try {
            const notificationType = status === 'accepted' ? 'appointment_accepted' : 'appointment_rejected';
            io.to(String(studentId)).emit("notification:update", {
                type: notificationType,
                title: status === 'accepted' ? 'Lawyer accepted your request' : 'Lawyer rejected your request',
                actor: socket.userId,
            });
        } catch (err) {
            console.error("Socket Error (appointmentStatusChanged):", err);
        }
    });
});

app.set("socketio", io);
app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: (o, cb) => cb(null, true), credentials: true }));

app.use((req, res, next) => {
    console.log(`--- [${new Date().toLocaleTimeString()}] ${req.method} ${req.url} ---`);
    next();
});

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/posts', require('./routes/postsRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/chat', require('./routes/chatRoutes')); 
app.use('/api/appointments', require('./routes/appointmentRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));

app.use((err, req, res, next) => {
    console.error("❌ SERVER CRASH PREVENTED ❌");
    console.error(err.stack);
    res.status(500).json({ message: "Internal Server Error" });
});

const PORT = process.env.PORT || 5000;
connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📡 Socket.io engine ready for Real-time Chat`);
    });
});
