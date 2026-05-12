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
      pagination: { total: count, page, pages: Math.ceil(count / limit), limit }
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
      'pending_approval', 'pending_payment', 'pending_cash', 'paid',
      'packed', 'ready', 'completed', 'cancelled', 'failed'
    ];

    if (!orderStatus || !allowedStatuses.includes(orderStatus)) {
      return res.status(400).json({ success: false, message: `Invalid status.` });
    }

    const order = await Order.findByPk(id, { include: [{ model: OrderItem, as: 'items' }] });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    // Cancel & Restore Stock Logic
    if (['cancelled', 'failed'].includes(orderStatus) && !['cancelled', 'failed'].includes(order.orderStatus)) {
      const t = await sequelize.transaction();
      try {
        for (const item of order.items) {
          await Product.increment('real_stock', { by: item.quantity, where: { id: item.productId }, transaction: t });
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
      
      // 1. Notify user if Late Request is approved
      if (orderStatus === 'pending_cash' && order.orderStatus === 'pending_approval') {
        await Notification.create({
          userId: order.userId ? String(order.userId) : 'GLOBAL',
          title: '✅ Late Order Approved!',
          message: `Good news! Your late order request has been approved. Please come to the counter to pay and collect.`,
          isRead: false
        });
      }

      // 🚨 2. SECURE OTP LOGIC: Only generate the PIN when the order is marked "Ready"
      if (orderStatus === 'ready' && !order.pickupPin) {
        order.pickupPin = Math.floor(1000 + Math.random() * 9000);
        
        // Push a notification to the customer with their new PIN!
        await Notification.create({
          userId: order.userId ? String(order.userId) : 'GLOBAL',
          title: '🛍️ Order Ready for Pickup!',
          message: `Your order is packed! Your secure pickup PIN is ${order.pickupPin}.`,
          isRead: false
        });
      }

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
// SUBMIT LATE ORDER REQUEST (10-Min Warning Flow)
// ============================================================
exports.requestLateOrder = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { orderAmount, totalAmount, customerEmail, customerPhone, items, customerNote } = req.body;

    if (!items || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Cart is empty.' });
    }

    // Create a special pending order (PIN is intentionally left blank here)
    const order = await Order.create({
      userId: req.user ? req.user.id : null,
      orderAmount: orderAmount,
      totalAmount: totalAmount || orderAmount, 
      paymentType: 'CASH', 
      orderStatus: 'pending_approval',
      customerEmail,
      customerPhone,
      customerNote: customerNote ? `[LATE REQUEST] ${customerNote}` : '[LATE REQUEST]',
      orderToken: 'REQ-' + Math.floor(1000 + Math.random() * 9000),
      cashfreeOrderId: `req_${Date.now()}` 
    }, { transaction: t });

    // Save items and securely lock stock temporarily
    for (const item of items) {
      await OrderItem.create({
        orderId: order.id, productId: item.id, name: item.name, price: item.price, quantity: item.quantity
      }, { transaction: t });

      await Product.decrement('real_stock', {
        by: item.quantity, where: { id: item.id }, transaction: t
      });
    }

    // Ping the Admin Dashboard
    await Notification.create({
      userId: 'GLOBAL',
      title: '🚨 LATE ORDER REQUEST',
      message: `A customer is requesting a last-minute order worth ₹${orderAmount}. Please check the Packing Station!`,
      isRead: false
    }, { transaction: t });

    await t.commit();
    
    const io = req.app.get('io');
    if (io) io.emit('storeUpdated');

    res.status(200).json({ success: true, order });
  } catch (error) {
    await t.rollback();
    console.error('Late Request Error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit late request' });
  }
};

// ============================================================
// ADMIN ACTION: Cancel Order & Restore Stock
// ============================================================
exports.cancelOrderAdmin = async (req, res) => {
  const t = await sequelize.transaction(); 
  
  try {
    const orderId = req.params.id;
    const { cancelReason } = req.body; 

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
          by: item.quantity, where: { id: item.productId }, transaction: t
        });
      }
    }

    order.orderStatus = 'cancelled';
    order.cancelReason = cancelReason; 
    await order.save({ transaction: t });

    let displayToken = order.orderToken && order.orderToken !== 'WAIT' 
      ? order.orderToken : (order.cashfreeOrderId ? order.cashfreeOrderId.slice(-4) : 'Unknown');

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
    res.status(500).json({ success: false, message: 'Server error during cancellation.' });
  }
};