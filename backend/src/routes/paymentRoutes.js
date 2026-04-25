const express = require('express');
const { createOrder, verifyPayment } = require('../controllers/paymentController');
const validate = require('../middlewares/validate');
const { createOrderSchema } = require('../validations/orderValidation');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

// Create order — must be authenticated
router.post('/create-order', protect, validate(createOrderSchema), createOrder);

// Verify payment — must be authenticated (user can only verify their own orders)
router.post('/verify', protect, verifyPayment);

// Note: The /webhook route has been intentionally moved to server.js 
// so it can parse the raw body Buffer before express.json() hits it!

module.exports = router;