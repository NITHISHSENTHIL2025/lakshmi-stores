const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, admin } = require('../middlewares/authMiddleware');

// ============================================================
// GET /users/me — Customer: fetch own wallet & khata info
// ============================================================
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'name', 'email', 'phone', 'walletBalance', 'isKhataAllowed', 'khataBalance']
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    res.json({
      success: true,
      walletBalance: user.walletBalance || 0,
      isKhataAllowed: user.isKhataAllowed || false,
      khataBalance: user.khataBalance || 0
    });
  } catch (error) {
    console.error('❌ /users/me error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================================
// GET /users/all — Admin: fetch all users (sensitive fields excluded)
// ============================================================
router.get('/all', protect, admin, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: {
        // Never send password hashes, OTPs, or reset tokens over the wire
        exclude: [
          'password', 'otp', 'otpExpiry', 'resetPasswordToken',
          'resetPasswordExpire', 'refreshToken', 'lockUntil',
          'loginAttempts', 'otpAttempts', 'lastOtpSentAt'
        ]
      },
      order: [['createdAt', 'DESC']]
    });
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('❌ /users/all error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
});

// ============================================================
// PUT /users/update-wallet — Admin: adjust wallet or toggle khata
// ============================================================
router.put('/update-wallet', protect, admin, async (req, res) => {
  try {
    const { userId, email, addAmount, toggleKhata, clearKhata } = req.body;

    let user = null;
    if (email) user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user && userId) user = await User.findByPk(userId);

    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (addAmount !== undefined) {
      const amount = parseFloat(addAmount);
      if (isNaN(amount)) {
        return res.status(400).json({ success: false, message: 'addAmount must be a valid number.' });
      }
      user.walletBalance = Number(user.walletBalance || 0) + amount;
    }

    if (toggleKhata !== undefined) {
      if (typeof toggleKhata !== 'boolean') {
        return res.status(400).json({ success: false, message: 'toggleKhata must be a boolean.' });
      }
      user.isKhataAllowed = toggleKhata;
    }

    if (clearKhata === true) {
      user.khataBalance = 0;
    }

    await user.save();

    // Return only safe fields
    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      walletBalance: user.walletBalance,
      isKhataAllowed: user.isKhataAllowed,
      khataBalance: user.khataBalance
    };

    res.json({ success: true, user: safeUser });
  } catch (error) {
    console.error('❌ /update-wallet error:', error);
    res.status(500).json({ success: false, message: 'Failed to update wallet.' });
  }
});

module.exports = router;