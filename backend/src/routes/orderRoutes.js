const express = require('express');
const router = express.Router();
const { getAllOrders, getMyOrders, updateOrderStatus } = require('../controllers/orderController');
const { protect, admin } = require('../middlewares/authMiddleware');

// Customer: view their own orders
router.get('/my-orders', protect, getMyOrders);

// Admin: view all orders (paginated)
router.get('/', protect, admin, getAllOrders);

// Admin: update order status
router.put('/:id/status', protect, admin, updateOrderStatus);

module.exports = router;