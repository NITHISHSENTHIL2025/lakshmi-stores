const express = require('express');
const router = express.Router();
const { getAllOrders, getMyOrders, updateOrderStatus, cancelOrderAdmin, requestLateOrder } = require('../controllers/orderController');
const { protect, admin } = require('../middlewares/authMiddleware');

router.get('/my-orders', protect, getMyOrders);
router.get('/', protect, admin, getAllOrders);

// 🚨 New Late Request Route (Customer Protected)
router.post('/request-late', protect, requestLateOrder); 

router.put('/:id/cancel', protect, admin, cancelOrderAdmin); 
router.put('/:id/status', protect, admin, updateOrderStatus);

module.exports = router;