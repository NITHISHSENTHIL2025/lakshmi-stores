const Order = require('../models/Order');
const OrderItem = require('../models/OrderItem'); // 🚨 CRITICAL: Must import OrderItem!

// ==========================================================
// 🚨 TIER 3 FIX: MEMORY CRASH PREVENTION + ITEM JOINING
// ==========================================================
exports.getAllOrders = async (req, res) => {
  try {
    // Only fetch the 200 most recent orders to keep the Admin Dashboard blazing fast.
    const orders = await Order.findAll({ 
      order: [['createdAt', 'DESC']],
      limit: 200,
      // 🚨 CRITICAL FIX: Tell SQL to join the OrderItems table!
      include: [{ model: OrderItem, as: 'items' }] 
    });
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error("GET Orders Error:", error);
    res.status(500).json({ success: false, message: 'Server Error fetching orders' });
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    const orders = await Order.findAll({ 
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      // 🚨 CRITICAL FIX: Tell SQL to join the OrderItems table!
      include: [{ model: OrderItem, as: 'items' }] 
    });

    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error("GET My Orders Error:", error);
    res.status(500).json({ success: false, message: 'Server Error fetching orders' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { orderStatus } = req.body;

    // 🚨 FINAL AUDIT FIX: Aggressive Whitelist Validation
    // Absolutely no arbitrary strings allowed. Protects against injection!
    const allowedStatuses = ['pending_payment', 'pending_cash', 'paid', 'packed', 'ready', 'completed', 'cancelled', 'failed'];
    
    if (!allowedStatuses.includes(orderStatus)) {
      return res.status(400).json({ 
        success: false, 
        message: `Security Block: Invalid status. Must be one of: ${allowedStatuses.join(', ')}` 
      });
    }

    const order = await Order.findByPk(id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    order.orderStatus = orderStatus;
    await order.save();

    const io = req.app.get('io');
    if (io) io.emit('storeUpdated');

    res.status(200).json({ success: true, order });
  } catch (error) {
    console.error('Update Order Status Error:', error);
    res.status(500).json({ success: false, message: 'Server error updating order' });
  }
};