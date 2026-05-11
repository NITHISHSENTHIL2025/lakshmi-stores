const express = require('express');
const router = express.Router();
// 🚨 Imported the new cancelOrderAdmin function
const { getAllOrders, getMyOrders, updateOrderStatus, cancelOrderAdmin } = require('../controllers/orderController');
const { protect, admin } = require('../middlewares/authMiddleware');

// Customer: view their own orders
router.get('/my-orders', protect, getMyOrders);

// Admin: view all orders (paginated)
router.get('/', protect, admin, getAllOrders);

// Admin: explicitly cancel order & notify
router.put('/:id/cancel', protect, admin, cancelOrderAdmin);

// Admin: update order status
router.put('/:id/status', protect, admin, updateOrderStatus);

module.exports = router;