const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { DataTypes, Op } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;
const Order = require('../models/Order');
const { protect, admin } = require('../middlewares/authMiddleware');

// ============================================================
// MODELS (defined inline as they are store-specific config tables)
// ============================================================
const StoreSetting = sequelize.define('StoreSetting', {
  id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
  isOpen: { type: DataTypes.BOOLEAN, defaultValue: true },
  closingWarningActive: { type: DataTypes.BOOLEAN, defaultValue: false },
  warningStartTime: { type: DataTypes.DATE, allowNull: true }
});

const ItemRequest = sequelize.define('ItemRequest', {
  itemName: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  requestCount: { type: DataTypes.INTEGER, defaultValue: 1 }
});

const initializeStoreDB = async () => {
  try {
    // Only sync in non-production environments to prevent accidental data loss
    if (process.env.NODE_ENV !== 'production') {
      await StoreSetting.sync({ alter: true });
      await ItemRequest.sync({ alter: true });
    }
    await StoreSetting.findOrCreate({
      where: { id: 1 },
      defaults: { isOpen: true, closingWarningActive: false }
    });
    console.log('✅ Store settings ready.');
  } catch (error) {
    console.error('❌ Store settings DB error:', error);
  }
};
initializeStoreDB();

// ============================================================
// RATE LIMITER — For the public item request endpoint
// ============================================================
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many item requests. Please try again later.' }
});

// ============================================================
// INPUT VALIDATION HELPER
// ============================================================
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }
  next();
};

// ============================================================
// ROUTES
// ============================================================

// PUBLIC: Check if store is open
router.get('/status', async (req, res) => {
  try {
    const status = await StoreSetting.findByPk(1);
    res.json({
      isOpen: status ? status.isOpen : true,
      closingWarningActive: status ? status.closingWarningActive : false,
      warningStartTime: status ? status.warningStartTime : null
    });
  } catch (error) {
    console.error('❌ Store status error:', error);
    res.status(500).json({ success: false, message: 'Could not fetch store status.' });
  }
});

// ADMIN: Toggle store open/closed
router.post('/status', protect, admin, async (req, res) => {
  try {
    const { isOpen } = req.body;
    if (typeof isOpen !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isOpen must be a boolean.' });
    }

    if (isOpen === false) {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      const pendingCount = await Order.count({
        where: {
          orderStatus: { [Op.in]: ['pending_payment', 'pending_cash'] },
          createdAt: { [Op.gte]: fiveMinsAgo }
        }
      });
      if (pendingCount > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot close shop. ${pendingCount} customer(s) are currently checking out. Please wait up to 5 minutes.`
        });
      }
    }

    await StoreSetting.update(
      { isOpen, closingWarningActive: false, warningStartTime: null },
      { where: { id: 1 } }
    );
    res.json({ success: true, isOpen });
  } catch (error) {
    console.error('❌ Store toggle error:', error);
    res.status(500).json({ success: false, message: 'Failed to update store status.' });
  }
});

// ADMIN: Trigger 10-minute closing warning
router.post('/trigger-warning', protect, admin, async (req, res) => {
  try {
    await StoreSetting.update(
      { closingWarningActive: true, warningStartTime: new Date() },
      { where: { id: 1 } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Trigger warning error:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger warning.' });
  }
});

// ADMIN: View all item requests
router.get('/requests', protect, admin, async (req, res) => {
  try {
    const requests = await ItemRequest.findAll({ order: [['updatedAt', 'DESC']] });
    res.json({ data: requests });
  } catch (error) {
    console.error('❌ Fetch requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch requests.' });
  }
});

// PUBLIC: Customer submits a missing item request (sanitized + rate limited)
router.post(
  '/requests',
  requestLimiter,
  [
    body('itemName')
      .trim()
      .escape()
      .notEmpty().withMessage('Item name is required.')
      .isLength({ min: 2, max: 100 }).withMessage('Item name must be 2–100 characters.')
  ],
  handleValidation,
  async (req, res) => {
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
      console.error('❌ Item request error:', error);
      res.status(500).json({ success: false, message: 'Failed to submit request.' });
    }
  }
);

// ADMIN: Delete a resolved item request
router.delete('/requests/:id', protect, admin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid request ID.' });
    }
    await ItemRequest.destroy({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Delete request error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete request.' });
  }
});

module.exports = router;