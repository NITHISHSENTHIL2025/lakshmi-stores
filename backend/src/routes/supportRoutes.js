const express = require('express');
const rateLimit = require('express-rate-limit');
const supportController = require('../controllers/supportController');
const { protect, admin } = require('../middlewares/authMiddleware');

const router = express.Router();

const publicChatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many chat messages. Please wait a moment.' }
});

router.post('/chat', publicChatLimiter, supportController.chat);
router.get('/threads/:id', supportController.getPublicThread);

router.get('/threads', protect, admin, supportController.getThreads);
router.post('/threads/:id/messages', protect, admin, supportController.adminReply);
router.put('/threads/:id/resolve', protect, admin, supportController.resolveThread);

module.exports = router;
