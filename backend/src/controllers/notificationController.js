const Notification = require('../models/Notification');
const { Op } = require('sequelize');

// ADMIN ACTION: Send the ETA
exports.sendRestockEta = async (req, res) => {
  try {
    const { requestId, userId, itemName, eta } = req.body;

    if (!itemName || !eta) {
      return res.status(400).json({ success: false, message: 'Missing fields.' });
    }

    // 🚨 THE FIX: If userId is missing, make it a GLOBAL broadcast to everyone!
    const targetUserId = userId ? String(userId) : 'GLOBAL';

    await Notification.create({
      userId: targetUserId,
      title: 'Restock Alert! 📦',
      message: `Great news! ${itemName} will be back in stock ${eta}. Get your cart ready!`,
      isRead: false
    });

    res.status(200).json({ success: true, message: 'Notification sent successfully!' });
  } catch (error) {
    console.error('ETA Error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// CUSTOMER ACTION: Fetch their notifications
exports.getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.findAll({
      where: { 
        // 🚨 Fetch alerts meant specifically for this user OR Global store alerts
        userId: { [Op.or]: [String(req.user.id), 'GLOBAL'] } 
      },
      order: [['createdAt', 'DESC']],
      limit: 20
    });
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
  }
};

// CUSTOMER ACTION: Mark as read
exports.markAsRead = async (req, res) => {
  try {
    await Notification.update(
      { isRead: true }, 
      { where: { id: req.params.id } } // Just update it by ID
    );
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
};