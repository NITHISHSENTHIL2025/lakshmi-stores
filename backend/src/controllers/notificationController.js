const { Op } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

exports.sendRestockEta = async (req, res) => {
  try {
    const { requestId, userId, itemName, eta } = req.body;

    if (!itemName || !eta) {
      return res.status(400).json({ success: false, message: 'Missing fields.' });
    }

    const Notification = sequelize.models.Notification;
    const Product = sequelize.models.Product;
    const ItemRequest = sequelize.models.ItemRequest;

    // 1. Send the Global Bell Notification
    if (Notification) {
      await Notification.create({
        userId: 'GLOBAL',
        title: 'Restock Alert! 📦',
        message: `Great news! ${itemName} will be back in stock ${eta}. Get your cart ready!`,
        isRead: false
      });
    }

    // 2. 🚨 THE MAGIC FIX: Update the actual product so the UI changes!
    if (Product) {
      await Product.update(
        { restockEta: eta },
        { where: { name: itemName } }
      );
    }

    // 3. Clear the request from the Admin dashboard
    if (ItemRequest) {
      await ItemRequest.destroy({ where: { itemName: itemName } });
    }

    // 4. Tell all customer screens to refresh instantly!
    const io = req.app.get('io');
    if (io) io.emit('storeUpdated');

    res.status(200).json({ success: true, message: 'Notification sent successfully!' });
  } catch (error) {
    console.error('ETA Error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

exports.getMyNotifications = async (req, res) => {
  try {
    const Notification = sequelize.models.Notification;
    const notifications = await Notification.findAll({
      where: { 
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

exports.markAsRead = async (req, res) => {
  try {
    const Notification = sequelize.models.Notification;
    await Notification.update({ isRead: true }, { where: { id: req.params.id } });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
};