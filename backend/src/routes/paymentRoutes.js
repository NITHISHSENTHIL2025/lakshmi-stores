const express = require('express');
const { createOrder, verifyPayment } = require('../controllers/paymentController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

// 🚨 FIX: Removed the buggy 'validate(createOrderSchema)' middleware. 
// The controller now safely handles all payload extraction and validation internally!
router.post('/create-order', protect, createOrder);

// Verify payment — must be authenticated
router.post('/verify', protect, verifyPayment);

// Note: The /webhook route has been intentionally moved to server.js 
// so it can parse the raw body Buffer before express.json() hits it!

module.exports = router;