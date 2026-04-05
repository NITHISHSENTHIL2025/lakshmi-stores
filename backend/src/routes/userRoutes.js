const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, admin } = require('../middlewares/authMiddleware');

// GET: Customer fetches their own secure wallet balance
// 🚨 SECURE: Now requires a valid token (protect)
router.get('/me', protect, async (req, res) => {
  try {
    // 🚨 SECURE FIX: Never trust the frontend's email. 
    // Extract the exact user ID from the verified JWT token.
    const userId = req.user.id; 

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.json({ 
      success: true, 
      walletBalance: user.walletBalance || 0,
      isKhataAllowed: user.isKhataAllowed || false,
      khataBalance: user.khataBalance || 0
    });
  } catch (error) {
    console.error("Error in /me:", error);
    res.status(500).json({ success: false, message: "Database Error" });
  }
});

// GET: Admin fetches all users (for Khata management)
// 🚨 SECURE: Only Admins can view the user list
router.get('/all', protect, admin, async (req, res) => {
  try {
    const users = await User.findAll({ order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: users });
  } catch (error) {
    console.error("❌ CRITICAL DB ERROR in /users/all :", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT: Admin adds change to Wallet (Sillarai) or toggles Khata
// 🚨 SECURE: Only Admins can modify wallet balances
router.put('/update-wallet', protect, admin, async (req, res) => {
  try {
    const { userId, email, addAmount, toggleKhata, clearKhata } = req.body;
    
    // Admins are allowed to specify the target user by email or ID here
    let user;
    if (email) user = await User.findOne({ where: { email: email } });
    if (!user && userId) user = await User.findByPk(userId);
    
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (addAmount) user.walletBalance = Number(user.walletBalance || 0) + Number(addAmount);
    if (toggleKhata !== undefined) user.isKhataAllowed = toggleKhata;
    if (clearKhata) user.khataBalance = 0;

    await user.save();
    res.json({ success: true, user });
  } catch (error) {
    console.error("Error in /update-wallet:", error);
    res.status(500).json({ success: false, message: "Failed to update wallet" });
  }
});

module.exports = router;