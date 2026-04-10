require('dotenv').config();
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/db');

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
                { path: "sender", select: "name phone profileImage role lawyerProfile.specialization" },
                { path: "receiver", select: "name phone profileImage role lawyerProfile.specialization" }
            ]);

            io.to(socket.userId).emit("newMessage", populated);
            io.to(receiverId).emit("newMessage", populated);

        } catch (err) {
            console.error("Socket Error:", err);
            socket.emit("error", { message: "Message failed to send" });
        }
    });

    socket.on("disconnect", () => {
        console.log("❌ Offline:", socket.userId);
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
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/chat', require('./routes/chatRoutes')); 
app.use('/api/appointments', require('./routes/appointmentRoutes'));

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
