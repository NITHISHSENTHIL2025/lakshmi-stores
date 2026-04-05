const Order = require('../models/Order');
const Product = require('../models/Product'); 
const OrderItem = require('../models/OrderItem'); 
const crypto = require('crypto');
const axios = require('axios');
const { Op } = require('sequelize');

const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

const formatAMPM = (time24) => {
  if (!time24 || time24 === 'ASAP') return 'ASAP';
  let [hours, minutes] = time24.split(':');
  let ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12; 
  return `${hours}:${minutes} ${ampm}`;
};

exports.createOrder = async (req, res) => {
  let { customerEmail, customerPhone, items, paymentMethod, pickupTime, customerNote } = req.body;

  // 🚨 AUDIT FIX: Unified Phone Logic
  let safePhone = '9999999999'; 
  if (customerPhone) {
    if (!/^[0-9]{10}$/.test(customerPhone.toString())) {
      return res.status(400).json({ success: false, message: "Invalid Indian phone number. Must be exactly 10 digits." });
    }
    safePhone = customerPhone.toString();
  }

  if (pickupTime && pickupTime !== 'ASAP' && pickupTime !== 'LATER') {
    const [hours, minutes] = pickupTime.split(':').map(Number);
    if (hours < 8 || hours >= 22) {
      return res.status(400).json({ success: false, message: "Pickup time must be between 8:00 AM and 10:00 PM." });
    }
  }

  const t = await sequelize.transaction();

  try {
    const userId = req.user ? req.user.id : (req.body.userId || `CUST_${Date.now()}`);
    const safeEmail = customerEmail || 'customer@lakshmistores.com';
    const formattedPickupTime = formatAMPM(pickupTime);
    const exactPaymentType = paymentMethod === 'cash' ? 'CASH' : 'ONLINE';

    let backendCalculatedTotal = 0;
    let finalItemsList = []; 

    for (let item of items) {
      const product = await Product.findByPk(item.id, { transaction: t, lock: t.LOCK.UPDATE });
      
      if (!product || product.real_stock < item.quantity || product.isActive === false) {
        await t.rollback(); 
        return res.status(400).json({ success: false, message: `Sorry, ${product ? product.name : 'an item'} is unavailable or sold out!` });
      }

      if (Math.abs(Number(product.price) - Number(item.price)) > 0.01) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `The price of ${product.name} changed. Please clear and re-add to cart.` });
      }

      backendCalculatedTotal += (Number(product.price) * Number(item.quantity));

      finalItemsList.push({
        id: product.id, name: product.name, price: product.price, quantity: item.quantity, category: product.category
      });

      await product.decrement('real_stock', { by: item.quantity, transaction: t });
    }

    // 🚨 AUDIT FIX: ₹50 Minimum strictly verified on the backend calculation
    if (backendCalculatedTotal < 50) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Minimum order value is ₹50." });
    }

    const today = new Date();
    const dayString = String(today.getDate()).padStart(2, '0');
    const randomHash = crypto.randomBytes(2).toString('hex').toUpperCase();
    const fourDigitToken = `${dayString}-${randomHash}`;

    const cashfreeOrderId = 'ORD_' + crypto.randomBytes(5).toString('hex').toUpperCase();

    // 🚨 AUDIT FIX: True Cryptographic 4-digit pickup PIN
    const generatedPickupPin = Math.floor(1000 + Math.random() * 9000).toString();

    const order = await Order.create({
      userId: userId, 
      totalAmount: backendCalculatedTotal,
      orderAmount: backendCalculatedTotal, 
      
      // 🚨 AUDIT FIX: Differentiate online pending vs cash pending
      orderStatus: paymentMethod === 'cash' ? 'pending_cash' : 'pending_payment',
      
      paymentType: exactPaymentType, 
      cashfreeOrderId: cashfreeOrderId, 
      orderToken: fourDigitToken, 
      pickupPin: generatedPickupPin,
      pickupTime: formattedPickupTime, 
      customerNote: customerNote, 
      customerEmail: safeEmail, 
      customerPhone: safePhone
    }, { transaction: t });

    const orderItemsData = finalItemsList.map(item => ({
      orderId: order.id,
      productId: item.id,
      name: item.name,
      quantity: item.quantity,
      price: item.price
    }));
    await OrderItem.bulkCreate(orderItemsData, { transaction: t });

    await t.commit();

    if (paymentMethod === 'cash') {
      const io = req.app.get('io');
      if (io) io.emit('storeUpdated');
      return res.status(200).json({ success: true, isCash: true, order_id: fourDigitToken });
    }

    const CASHFREE_BASE_URL = process.env.NODE_ENV === 'production' 
      ? 'https://api.cashfree.com/pg' 
      : 'https://sandbox.cashfree.com/pg';

    const payload = {
      order_id: cashfreeOrderId, order_amount: Number(backendCalculatedTotal), order_currency: 'INR',
      customer_details: { customer_id: String(userId).substring(0, 40), customer_email: safeEmail, customer_phone: safePhone },
      order_meta: { return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-status?order_id=${cashfreeOrderId}` }
    };

    try {
      const response = await axios.post(`${CASHFREE_BASE_URL}/orders`, payload, {
        headers: {
          'x-client-id': process.env.CASHFREE_APP_ID, 'x-client-secret': process.env.CASHFREE_SECRET_KEY,
          'x-api-version': '2023-08-01', 'Content-Type': 'application/json'
        }
      });
      return res.status(200).json({ success: true, payment_session_id: response.data.payment_session_id });
      
    } catch (cfError) {
      for (let item of finalItemsList) {
        const product = await Product.findByPk(item.id);
        if (product) { await product.increment('real_stock', { by: item.quantity }); }
      }
      order.orderStatus = 'failed';
      await order.save();
      return res.status(500).json({ success: false, message: `Payment gateway rejected the request.` });
    }

  } catch (error) { 
    if (t && t.finished !== 'commit') {
      await t.rollback(); 
    }
    console.error("Checkout Error:", error);
    return res.status(500).json({ success: false, message: error.message || 'Server crashed during checkout.' }); 
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { order_id } = req.body;
    
    const whereClause = { cashfreeOrderId: order_id };
    if (req.user) {
      whereClause.userId = req.user.id.toString();
    }

    const order = await Order.findOne({ 
      where: whereClause,
      include: [{ model: OrderItem, as: 'items' }] 
    });
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found or unauthorized.' });
    }

    if (order.orderStatus === 'paid') {
      return res.status(200).json({ success: true, message: 'Payment already verified.' });
    }

    const CASHFREE_BASE_URL = process.env.NODE_ENV === 'production' 
      ? 'https://api.cashfree.com/pg' 
      : 'https://sandbox.cashfree.com/pg';

    const response = await axios.get(`${CASHFREE_BASE_URL}/orders/${order_id}`, {
      headers: {
        'x-client-id': process.env.CASHFREE_APP_ID, 'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': '2023-08-01'
      }
    });

    if (response.data.order_status === 'PAID') {
      order.orderStatus = 'paid';
      await order.save();
      const io = req.app.get('io');
      if (io) io.emit('storeUpdated');
      return res.status(200).json({ success: true, message: 'Payment successfully verified by bank.' });
    } 
    else {
      // 🚨 AUDIT FIX: Target pending_payment instead of pending
      if (order.orderStatus === 'pending_payment') {
        order.orderStatus = 'failed';
        await order.save();
        for (let item of order.items) {
          const product = await Product.findByPk(item.productId);
          if (product) { await product.increment('real_stock', { by: item.quantity }); }
        }
        const io = req.app.get('io');
        if (io) io.emit('storeUpdated');
      }
      return res.status(400).json({ success: false, message: 'Payment was incomplete or abandoned.' });
    }
  } catch (error) { 
    console.error("Verification check failed:", error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, message: 'Secure verification failed.' }); 
  }
};

exports.cashfreeWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    
    if (!signature || !timestamp) {
      return res.status(401).send('Missing signature');
    }

    const rawBody = JSON.stringify(req.body); 
    const payload = timestamp + rawBody;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.CASHFREE_SECRET_KEY)
      .update(payload)
      .digest('base64');

    if (expectedSignature !== signature) {
      return res.status(403).send('Invalid signature');
    }

    const { data, type } = req.body;
    if (type !== 'PAYMENT_SUCCESS_WEBHOOK') {
      return res.status(200).send('Ignored non-success event.');
    }

    const cashfreeOrderId = data.order.order_id;
    const order = await Order.findOne({ 
      where: { cashfreeOrderId: cashfreeOrderId },
      include: [{ model: OrderItem, as: 'items' }] 
    });

    if (!order) return res.status(200).send('Order not found.');
    if (order.orderStatus === 'paid') return res.status(200).send('Already processed.');

    order.orderStatus = 'paid';
    await order.save();

    const io = req.app.get('io');
    if (io) io.emit('storeUpdated');

    return res.status(200).send('Webhook processed successfully.');
  } catch (error) {
    return res.status(500).send('Webhook processing failed.');
  }
};