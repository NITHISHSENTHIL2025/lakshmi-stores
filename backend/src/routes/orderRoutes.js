const express = require('express');
const router = express.Router();
const { getAllOrders, getMyOrders, updateOrderStatus, cancelOrderAdmin } = require('../controllers/orderController');
const { protect, admin } = require('../middlewares/authMiddleware');

router.get('/my-orders', protect, getMyOrders);
router.get('/', protect, admin, getAllOrders);
router.put('/:id/cancel', protect, admin, cancelOrderAdmin); // 🚨 New Cancel Route
router.put('/:id/status', protect, admin, updateOrderStatus);

module.exports = router;