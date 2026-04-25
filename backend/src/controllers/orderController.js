const Order = require('../models/Order');
const Product = require('../models/Product');
const OrderItem = require('../models/OrderItem');
const { Op } = require('sequelize');

const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

// ============================================================
// GET ALL ORDERS — Admin only, paginated
// ============================================================
exports.getAllOrders = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const { count, rows: orders } = await Order.findAndCountAll({
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      include: [{ model: OrderItem, as: 'items' }]
    });

    res.status(200).json({
      success: true,
      data: orders,
      pagination: {
        total: count,
        page,
        pages: Math.ceil(count / limit),
        limit
      }
    });
  } catch (error) {
    console.error('❌ getAllOrders error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching orders.' });
  }
};

// ============================================================
// GET MY ORDERS — Customer sees only their own orders
// ============================================================
exports.getMyOrders = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authorized.' });
    }

    const orders = await Order.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      include: [{ model: OrderItem, as: 'items' }]
    });

    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error('❌ getMyOrders error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching your orders.' });
  }
};

// ============================================================
// UPDATE ORDER STATUS — Admin only, strict whitelist
// ============================================================
exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { orderStatus } = req.body;

    const allowedStatuses = [
      'pending_payment', 'pending_cash', 'paid',
      'packed', 'ready', 'completed', 'cancelled', 'failed'
    ];

    if (!orderStatus || !allowedStatuses.includes(orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${allowedStatuses.join(', ')}`
      });
    }

    // 🚨 PRODUCTION FIX: Include OrderItems so we can restore stock if cancelled
    const order = await Order.findByPk(id, {
      include: [{ model: OrderItem, as: 'items' }]
    });
    
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    // 🚨 PRODUCTION FIX: Safely restore stock if admin moves order to Cancelled/Failed
    if (['cancelled', 'failed'].includes(orderStatus) && !['cancelled', 'failed'].includes(order.orderStatus)) {
      const t = await sequelize.transaction();
      try {
        for (const item of order.items) {
          await Product.increment('real_stock', { 
            by: item.quantity, 
            where: { id: item.productId }, 
            transaction: t 
          });
        }
        order.orderStatus = orderStatus;
        await order.save({ transaction: t });
        await t.commit();
      } catch (err) {
        await t.rollback();
        console.error('❌ Stock restore failed on admin cancel:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to restore stock during cancellation.' });
      }
    } else {
      order.orderStatus = orderStatus;
      await order.save();
    }

    const io = req.app.get('io');
    if (io) io.emit('storeUpdated');

    res.status(200).json({ success: true, order });
  } catch (error) {
    console.error('❌ updateOrderStatus error:', error);
    res.status(500).json({ success: false, message: 'Server error updating order status.' });
  }
};