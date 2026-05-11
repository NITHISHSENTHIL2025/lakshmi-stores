const Notification = require('../models/Notification');
// const ItemRequest = require('../models/ItemRequest'); // Import if you want to update request status

// ADMIN ACTION: Send the ETA
exports.sendRestockEta = async (req, res) => {
  try {
    const { requestId, userId, itemName, eta } = req.body;

    if (!userId || !itemName || !eta) {
      return res.status(400).json({ success: false, message: 'Missing fields.' });
    }

    // Create the in-app notification
    await Notification.create({
      userId,
      title: 'Restock Alert! 📦',
      message: `The ${itemName} you requested will be back in stock ${eta}. Get your cart ready!`,
      isRead: false
    });

    // Optional: await ItemRequest.update({ status: 'Notified' }, { where: { id: requestId } });

    res.status(200).json({ success: true, message: 'Notification sent.' });
  } catch (error) {
    console.error('ETA Error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// CUSTOMER ACTION: Fetch their notifications
exports.getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.findAll({
      where: { userId: req.user.id },
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
    await Notification.update({ isRead: true }, { where: { id: req.params.id, userId: req.user.id } });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
};