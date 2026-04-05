const jwt = require('jsonwebtoken');
const User = require('../models/User'); 

if (!process.env.JWT_SECRET) {
  console.error("🔴 FATAL ERROR: JWT_SECRET is missing from environment variables!");
  process.exit(1);
}

const protect = async (req, res, next) => {
  try {
    // 🚨 Extract token from SECURE COOKIES instead of Headers
    const token = req.cookies.accessToken;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized, no token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = await User.findByPk(decoded.id, {
      attributes: { exclude: ['password', 'otp', 'refreshToken'] }
    });

    if (!req.user) {
      return res.status(401).json({ success: false, message: 'User no longer exists.' });
    }

    next();
  } catch (error) {
    console.error("Token verification failed:", error.message);
    return res.status(401).json({ success: false, message: 'Not authorized, token failed or expired.' });
  }
};

const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next(); 
  } else {
    res.status(403).json({ success: false, message: 'Access denied. Admins only.' });
  }
};

module.exports = { protect, admin };