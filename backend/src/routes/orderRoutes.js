const express = require('express');
const router = express.Router();

// I am assuming these are your controller function names based on standard conventions. 
// Adjust them if you named them differently in your orderController!
const { 
  getAllOrders, 
  getMyOrders, 
  updateOrderStatus 
} = require('../controllers/orderController');

// 🚨 1. Import your Security Bouncers
const { protect, admin } = require('../middlewares/authMiddleware');

// 🟡 PROTECTED: Customers must be logged in to see their own live tracking
// (In your orderController, ensure 'getMyOrders' uses `req.user.id` to filter the DB!)
router.get('/my-orders', protect, getMyOrders);

// 🔴 SECURE: Only Admins can view the master list of all store orders
router.get('/', protect, admin, getAllOrders);

// 🔴 SECURE: Only Admins can change a status (e.g., from 'paid' to 'packed')
router.put('/:id/status', protect, admin, updateOrderStatus);

module.exports = router;