const Order = require('../models/Order');
const Product = require('../models/Product');
const OrderItem = require('../models/OrderItem');
const Notification = require('../models/Notification'); 
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

    const order = await Order.findByPk(id, {
      include: [{ model: OrderItem, as: 'items' }]
    });
    
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

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

// ============================================================
// ADMIN ACTION: Cancel Order, Restore Stock, Send Notification
// ============================================================
exports.cancelOrderAdmin = async (req, res) => {
  const t = await sequelize.transaction(); 
  
  try {
    const orderId = req.params.id;
    const { cancelReason } = req.body; // 🚨 Catch the reason

    if (!cancelReason) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Cancellation reason is required.' });
    }

    const order = await Order.findByPk(orderId, { include: ['items'], transaction: t });

    if (!order) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (['cancelled', 'completed', 'failed'].includes(order.orderStatus)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: `Order is already ${order.orderStatus}` });
    }

    if (order.items && order.items.length > 0) {
      for (let item of order.items) {
        await Product.increment('real_stock', {
          by: item.quantity,
          where: { id: item.productId },
          transaction: t
        });
      }
    }

    order.orderStatus = 'cancelled';
    order.cancelReason = cancelReason; // 🚨 Save the reason
    await order.save({ transaction: t });

    let displayToken = order.orderToken && order.orderToken !== 'WAIT' 
      ? order.orderToken 
      : (order.cashfreeOrderId ? order.cashfreeOrderId.slice(-4) : 'Unknown');

    await Notification.create({
      userId: order.userId ? String(order.userId) : 'GLOBAL',
      title: 'Order Cancelled ❌',
      message: `Your order #${displayToken} was cancelled. Reason: ${cancelReason}`,
      isRead: false
    }, { transaction: t });

    await t.commit();
    
    const io = req.app.get('io');
    if (io) io.emit('storeUpdated');

    res.status(200).json({ success: true, message: 'Order cancelled and stock restored.' });
  } catch (error) {
    await t.rollback();
    console.error('Cancel Order Error:', error);
    res.status(500).json({ success: false, message: 'Server error during cancellation.' });
  }
};