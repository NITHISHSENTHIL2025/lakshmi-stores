const express = require('express');
const router = express.Router();
const { sendRestockEta, getMyNotifications, markAsRead } = require('../controllers/notificationController');
const { protect, admin } = require('../middlewares/authMiddleware'); // Adjust path if your middleware is elsewhere

// ADMIN ROUTE: Send ETA alert
router.post('/send-eta', protect, admin, sendRestockEta);

// CUSTOMER ROUTES: Read and fetch alerts
router.get('/mine', protect, getMyNotifications);
router.put('/:id/read', protect, markAsRead);

module.exports = router;