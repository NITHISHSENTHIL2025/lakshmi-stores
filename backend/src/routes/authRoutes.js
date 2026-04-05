const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator'); 
const { register, login, getMe, verifyOtp, refresh, logout, resendOtp, forgotPassword, resetPassword } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

// 🟢 Realistic Limiter (Login, Register)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 🚨 Reduced from 500 to 100 for safety
  message: { success: false, message: 'Too many attempts. Try again in 15 minutes.' }
});

// 🔴 Strict Limiter (Email Spam)
const strictMailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 🚨 Kept low to prevent racking up massive email API bills
  message: { success: false, message: 'Too many email requests. Try again in an hour.' }
});

// 🚨 Middleware to catch validation errors
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }
  next();
};

// 🚨 Data Sanitization Array
router.post('/register', 
  authLimiter,
  [
    body('name').trim().escape().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('phone').trim().escape().isLength({ min: 10 }).withMessage('Valid phone required'),
    
    // 🚨 FINAL AUDIT FIX: Matched to the 8-character rule in the controller!
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  ],
  validate,
  register
);

router.post('/login', authLimiter, login);
router.post('/verify-otp', authLimiter, verifyOtp);
router.post('/refresh', refresh); 
router.post('/logout', logout);   

// 🚨 Apply the Strict Limiter to Email Routes
router.post('/resend-otp', strictMailLimiter, resendOtp); 
router.post('/forgot-password', strictMailLimiter, forgotPassword); 

router.put('/reset-password/:token', authLimiter, resetPassword);          
router.get('/me', protect, getMe);

module.exports = router;