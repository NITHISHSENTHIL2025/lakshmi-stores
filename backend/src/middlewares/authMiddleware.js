const jwt = require('jsonwebtoken');
const User = require('../models/User');

if (!process.env.JWT_ACCESS_SECRET) {
  console.error('🔴 FATAL: JWT_ACCESS_SECRET is missing from environment variables!');
  process.exit(1);
}

// ============================================================
// PROTECT — Verifies the access token cookie
// Uses JWT_ACCESS_SECRET (separate from refresh secret)
// ============================================================
const protect = async (req, res, next) => {
  try {
    const token = req.cookies.accessToken;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized. Please log in.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Session expired. Please refresh your token.' });
      }
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }

    const user = await User.findByPk(decoded.id, {
      attributes: { exclude: ['password', 'otp', 'otpExpiry', 'resetPasswordToken', 'resetPasswordExpire', 'refreshToken'] }
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists.' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ success: false, message: 'Account not verified.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('❌ Auth middleware error:', error.message);
    return res.status(401).json({ success: false, message: 'Authorization failed.' });
  }
};

// ============================================================
// ADMIN — Must come after protect middleware
// ============================================================
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Access denied. Admins only.' });
  }
};

module.exports = { protect, admin };