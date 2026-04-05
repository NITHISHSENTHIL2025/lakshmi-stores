const express = require('express');
const router = express.Router();
const { DataTypes, Op } = require('sequelize'); 
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;
const Order = require('../models/Order');

// 🚨 IMPORT YOUR NEW SECURITY BOUNCERS
const { protect, admin } = require('../middlewares/authMiddleware');

// 1. DEFINE TABLES
const StoreSetting = sequelize.define('StoreSetting', {
  id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
  isOpen: { type: DataTypes.BOOLEAN, defaultValue: true },
  closingWarningActive: { type: DataTypes.BOOLEAN, defaultValue: false },
  warningStartTime: { type: DataTypes.DATE, allowNull: true }
});

const ItemRequest = sequelize.define('ItemRequest', {
  itemName: { type: DataTypes.STRING, allowNull: false, unique: true },
  requestCount: { type: DataTypes.INTEGER, defaultValue: 1 }
});

// 2. SAFELY INITIALIZE DB
const initializeStoreDB = async () => {
  try {
    await StoreSetting.sync({ alter: true });
    await ItemRequest.sync({ alter: true });
    
    await StoreSetting.findOrCreate({ 
      where: { id: 1 }, 
      defaults: { isOpen: true, closingWarningActive: false } 
    });
    console.log("✅ Store Settings DB Ready & Secured!");
  } catch (error) {
    console.error("Failed to sync store DB:", error);
  }
};
initializeStoreDB();

// --- REAL API ROUTES ---

// 🟢 GET: Check if shop is open. (Must remain PUBLIC so customers can load the homepage)
router.get('/status', async (req, res) => {
  try {
    const status = await StoreSetting.findByPk(1);
    res.json({ 
      isOpen: status ? status.isOpen : true,
      closingWarningActive: status ? status.closingWarningActive : false,
      warningStartTime: status ? status.warningStartTime : null
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'DB Error' });
  }
});

// 🔴 POST: Admin toggles Shutter. (SECURED: protect + admin)
router.post('/status', protect, admin, async (req, res) => {
  try {
    const { isOpen } = req.body;

    // 🚨 AUDIT FIX: Checks 'pending_payment' AND 'pending_cash' 
    if (isOpen === false) {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      const pendingPayments = await Order.count({ 
        where: { 
          orderStatus: { [Op.in]: ['pending_payment', 'pending_cash'] },
          createdAt: { [Op.gte]: fiveMinsAgo } 
        } 
      });

      if (pendingPayments > 0) {
        return res.status(400).json({ 
          success: false, 
          message: `Cannot close shop! ${pendingPayments} customer(s) are currently checking out. Please wait up to 5 minutes.` 
        });
      }
    }

    await StoreSetting.update({ 
      isOpen, 
      closingWarningActive: false, 
      warningStartTime: null 
    }, { where: { id: 1 } });
    
    res.json({ success: true, isOpen });
  } catch (error) {
    res.status(500).json({ success: false, message: 'DB Error' });
  }
});

// 🔴 POST: Admin triggers 10 Minute Warning. (SECURED: protect + admin)
router.post('/trigger-warning', protect, admin, async (req, res) => {
  try {
    await StoreSetting.update({ 
      closingWarningActive: true, 
      warningStartTime: new Date() 
    }, { where: { id: 1 } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'DB Error' });
  }
});

// 🔴 GET: Admin views Missing Item Requests. (SECURED: protect + admin)
router.get('/requests', protect, admin, async (req, res) => {
  try {
    const requests = await ItemRequest.findAll({ order: [['updatedAt', 'DESC']] });
    res.json({ data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: 'DB Error' });
  }
});

// 🟢 POST: Customer requests a missing item. (PUBLIC so anyone searching can request it)
router.post('/requests', async (req, res) => {
  try {
    const { itemName } = req.body;
    const [reqItem, created] = await ItemRequest.findOrCreate({
      where: { itemName },
      defaults: { requestCount: 1 }
    });
    
    if (!created) {
      reqItem.requestCount += 1;
      await reqItem.save();
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'DB Error' });
  }
});

// 🔴 DELETE: Admin clears a request after buying stock. (SECURED: protect + admin)
router.delete('/requests/:id', protect, admin, async (req, res) => {
  try {
    await ItemRequest.destroy({ where: { id: req.params.id }});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'DB Error' });
  }
});

module.exports = router;