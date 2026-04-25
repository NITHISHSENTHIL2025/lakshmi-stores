const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const {
  register, login, getMe, verifyOtp, refresh, logout,
  logoutAllDevices, resendOtp, forgotPassword, resetPassword
} = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

// ============================================================
// RATE LIMITERS
// ============================================================

// General auth actions (login, register, verify)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' }
});

// Email-sending actions (OTP resend, forgot password) — strict to prevent cost abuse
const strictMailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many email requests. Please try again in an hour.' }
});

// ============================================================
// VALIDATION ERROR HANDLER
// ============================================================
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg,
      errors: errors.array()
    });
  }
  next();
};

// ============================================================
// ROUTES
// ============================================================

router.post('/register',
  authLimiter,
  [
    body('name').trim().escape().notEmpty().withMessage('Name is required').isLength({ max: 100 }).withMessage('Name too long'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('phone').trim().matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone number is required'),
    body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be 8–128 characters')
      .matches(/(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()])/)
      .withMessage('Password must contain uppercase, lowercase, number, and special character')
  ],
  validate,
  register
);

router.post('/login', authLimiter, login);
router.post('/verify-otp', authLimiter, verifyOtp);

router.post('/refresh', refresh);
router.post('/logout', logout);
router.post('/logout-all', protect, logoutAllDevices);

router.post('/resend-otp', strictMailLimiter, resendOtp);
router.post('/forgot-password', strictMailLimiter, forgotPassword);

router.put('/reset-password/:token', authLimiter, resetPassword);

router.get('/me', protect, getMe);

module.exports = router;