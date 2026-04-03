const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  try {
    let token = req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null;
    console.log("🛡️ Authenticating request...");
    if (!token) return res.status(401).json({ message: "Not authorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    if (!req.user) return res.status(401).json({ message: "User not found" });
    next();
  } catch (error) { 
    console.warn("⚠️ Auth Failed:", error.message);
    res.status(401).json({ message: "Token expired" }); 
  }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    console.log(`👮 Role Check: User[${req.user.role}] vs Allowed[${roles}]`);
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: "Forbidden" });
    next();
  };
};