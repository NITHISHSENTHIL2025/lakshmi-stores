const express = require('express');
const { createOrder, verifyPayment, cashfreeWebhook } = require('../controllers/paymentController');
const validate = require('../middlewares/validate'); 
const { createOrderSchema } = require('../validations/orderValidation'); 
const { protect } = require('../middlewares/authMiddleware'); 

const router = express.Router();

// 🚨 SECURE: Must be logged in AND pass schema validation to create an order
router.post('/create-order', protect, validate(createOrderSchema), createOrder);

// 🚨 AUDIT FIX: Removed 'protect' middleware. 
// Verification relies on the secure Order ID from Cashfree, not a login cookie.
router.post('/verify', verifyPayment); 

// 🚨 PUBLIC WEBHOOK: Open to the internet so Cashfree can ping it directly!
router.post('/webhook', cashfreeWebhook);

module.exports = router;