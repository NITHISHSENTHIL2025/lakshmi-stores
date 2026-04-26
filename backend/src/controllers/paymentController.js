const Order = require('../models/Order');
const Product = require('../models/Product');
const OrderItem = require('../models/OrderItem');
const crypto = require('crypto');
const axios = require('axios');
const { Op } = require('sequelize');

const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

const formatAMPM = (time24) => {
  if (!time24 || typeof time24 !== 'string' || time24 === 'ASAP' || time24 === 'LATER') return 'ASAP';
  try {
    const [hours, minutes] = time24.split(':');
    const h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayHour = h % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  } catch (err) {
    return 'ASAP';
  }
};

const CASHFREE_BASE_URL = process.env.NODE_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

// ============================================================
// CREATE ORDER (PRODUCTION GRADE)
// ============================================================
exports.createOrder = async (req, res) => {
  try {
    // 🚨 1. GHOST USER CHECK: Prevent crashes if the session expired exactly at checkout
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }

    let bodyData = req.body;

    // 🚨 2. STRINGIFIED JSON CHECK: If frontend accidentally sent a string, parse it safely
    if (typeof bodyData === 'string') {
      try {
        bodyData = JSON.parse(bodyData);
      } catch (e) {
        console.error('⚠️ Could not parse stringified payload:', bodyData);
        bodyData = {};
      }
    }

    const { customerEmail, customerPhone, paymentMethod, pickupTime, customerNote } = bodyData;
    const idempotencyKey = req.headers['x-idempotency-key'];

    console.log('📦 INCOMING CHECKOUT DATA:', JSON.stringify(bodyData, null, 2));

    // 🚨 3. INVINCIBLE PAYLOAD EXTRACTOR
    let rawItems = [];
    
    if (Array.isArray(bodyData)) {
      rawItems = bodyData;
    } else if (bodyData && typeof bodyData === 'object') {
      rawItems = bodyData.items || bodyData.cartItems || bodyData.cart || bodyData.products || bodyData.data;
      
      if (!rawItems || !Array.isArray(rawItems)) {
        const foundArray = Object.values(bodyData).find(val => Array.isArray(val));
        if (foundArray) rawItems = foundArray;
      }
    }

    if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
      console.warn('⚠️ Rejected Order: Cart data is missing or invalid.');
      return res.status(400).json({ success: false, message: 'Your cart is empty or formatted incorrectly. Please refresh.' });
    }

    // 🚨 4. IDEMPOTENCY CHECK
    if (idempotencyKey) {
      const existingOrder = await Order.findOne({ where: { idempotencyKey } });
      if (existingOrder) {
        console.log(`♻️ Idempotency matched! Returning existing order: ${existingOrder.orderToken}`);
        if (existingOrder.paymentType === 'CASH') {
          return res.status(200).json({ success: true, isCash: true, order_id: existingOrder.orderToken });
        } else {
          return res.status(200).json({ success: true, payment_session_id: existingOrder.paymentSessionId });
        }
      }
    }

    let safePhone = '9999999999';
    if (customerPhone) {
      if (!/^[0-9]{10}$/.test(customerPhone.toString())) return res.status(400).json({ success: false, message: 'Invalid phone number.' });
      safePhone = customerPhone.toString();
    }

    let formattedPickupTime = 'ASAP';
    if (pickupTime && typeof pickupTime === 'string' && pickupTime !== 'ASAP' && pickupTime !== 'LATER') {
      const parts = pickupTime.split(':');
      if (parts.length === 2) {
        const hours = parseInt(parts[0], 10);
        if (hours < 8 || hours >= 22) return res.status(400).json({ success: false, message: 'Pickup time must be between 8 AM and 10 PM.' });
        formattedPickupTime = formatAMPM(pickupTime);
      }
    }

    // 🚨 5. ACID DATABASE TRANSACTION
    const t = await sequelize.transaction();

    try {
      const userId = req.user.id;
      const safeEmail = customerEmail || req.user.email || 'customer@lakshmistores.com';
      const exactPaymentType = paymentMethod === 'cash' ? 'CASH' : 'ONLINE';

      let backendCalculatedTotal = 0;
      const finalItemsList = [];

      const sortedItems = [...rawItems].sort((a, b) => String(a.id).localeCompare(String(b.id)));

      for (const item of sortedItems) {
        if (!item || !item.id) continue; 

        const qty = Math.max(1, Math.round(Number(item.quantity || 1))); 
        
        const product = await Product.findByPk(item.id, { transaction: t, lock: t.LOCK.UPDATE });

        if (!product || product.isActive === false) {
          await t.rollback();
          return res.status(400).json({ success: false, message: `An item in your cart is no longer available.` });
        }

        if (product.real_stock < qty) {
          await t.rollback();
          return res.status(400).json({ success: false, message: `Not enough stock for ${product.name}.` });
        }

        backendCalculatedTotal += Number(product.price) * qty;
        finalItemsList.push({ id: product.id, name: product.name, price: product.price, quantity: qty, category: product.category });

        await product.decrement('real_stock', { by: qty, transaction: t });
      }

      if (backendCalculatedTotal < 1) {
        await t.rollback();
        return res.status(400).json({ success: false, message: 'Invalid order total.' });
      }

      const dayString = String(new Date().getDate()).padStart(2, '0');
      const randomHash = crypto.randomBytes(4).toString('hex').toUpperCase();
      const fourDigitToken = `${dayString}-${randomHash.substring(0, 4)}`;
      const cashfreeOrderId = 'ORD_' + crypto.randomBytes(6).toString('hex').toUpperCase();
      const generatedPickupPin = crypto.randomInt(1000, 9999).toString();

      const order = await Order.create({
        userId,
        totalAmount: backendCalculatedTotal,
        orderAmount: backendCalculatedTotal,
        orderStatus: paymentMethod === 'cash' ? 'pending_cash' : 'pending_payment',
        paymentType: exactPaymentType,
        cashfreeOrderId,
        orderToken: fourDigitToken,
        pickupPin: generatedPickupPin,
        pickupTime: formattedPickupTime,
        customerNote: customerNote ? String(customerNote).substring(0, 500) : null,
        customerEmail: safeEmail,
        customerPhone: safePhone,
        idempotencyKey: idempotencyKey || null
      }, { transaction: t });

      const orderItemsData = finalItemsList.map(item => ({
        orderId: order.id, productId: item.id, name: item.name, quantity: item.quantity, price: item.price
      }));
      await OrderItem.bulkCreate(orderItemsData, { transaction: t });

      await t.commit(); 

      if (paymentMethod === 'cash') {
        const io = req.app.get('io');
        if (io) io.emit('storeUpdated');
        return res.status(200).json({ success: true, isCash: true, order_id: fourDigitToken });
      }

      const payload = {
        order_id: cashfreeOrderId,
        order_amount: Number(backendCalculatedTotal),
        order_currency: 'INR',
        customer_details: { customer_id: String(userId).substring(0, 40), customer_email: safeEmail, customer_phone: safePhone },
        order_meta: { return_url: `${process.env.FRONTEND_URL || 'https://lakshmi-stores-six.vercel.app'}/payment-status?order_id=${cashfreeOrderId}` }
      };

      try {
        const response = await axios.post(`${CASHFREE_BASE_URL}/orders`, payload, {
          headers: {
            'x-client-id': process.env.CASHFREE_APP_ID,
            'x-client-secret': process.env.CASHFREE_SECRET_KEY,
            'x-api-version': '2023-08-01',
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });

        order.paymentSessionId = response.data.payment_session_id;
        await order.save();

        return res.status(200).json({ success: true, payment_session_id: response.data.payment_session_id });

      } catch (cfError) {
        const t2 = await sequelize.transaction();
        try {
          for (const item of finalItemsList) {
            await Product.increment('real_stock', { by: item.quantity, where: { id: item.id }, transaction: t2 });
          }
          await Order.update({ orderStatus: 'failed' }, { where: { id: order.id }, transaction: t2 });
          await t2.commit();
        } catch (rollbackErr) {
          await t2.rollback();
        }
        console.error('❌ Cashfree Gateway Error:', cfError?.response?.data || cfError.message);
        return res.status(500).json({ success: false, message: 'Payment gateway error. Please try again.' });
      }

    } catch (dbError) {
      if (t && t.finished !== 'commit') { try { await t.rollback(); } catch (_) {} }
      console.error('❌ Database Transaction Error:', dbError);
      return res.status(500).json({ success: false, message: 'Server error saving order.' });
    }
  } catch (error) {
    console.error('❌ Fatal Checkout Error:', error);
    return res.status(500).json({ success: false, message: 'Server error processing checkout.' });
  }
};

// ============================================================
// VERIFY PAYMENT 
// ============================================================
exports.verifyPayment = async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ success: false, message: 'order_id is required.' });

    const order = await Order.findOne({
      where: { cashfreeOrderId: order_id, userId: req.user.id.toString() },
      include: [{ model: OrderItem, as: 'items' }]
    });

    if (!order) return res.status(404).json({ success: false, message: 'Order not found or unauthorized.' });
    if (order.orderStatus === 'paid') return res.status(200).json({ success: true, message: 'Payment already verified.' });

    const response = await axios.get(`${CASHFREE_BASE_URL}/orders/${order_id}`, {
      headers: {
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': '2023-08-01'
      },
      timeout: 10000
    });

    if (response.data.order_status === 'PAID') {
      order.orderStatus = 'paid';
      await order.save();
      const io = req.app.get('io');
      if (io) io.emit('storeUpdated');
      return res.status(200).json({ success: true, message: 'Payment verified successfully.' });
    } else {
      if (order.orderStatus === 'pending_payment') {
        const t = await sequelize.transaction();
        try {
          const [updatedRows] = await Order.update(
            { orderStatus: 'failed' }, 
            { where: { id: order.id, orderStatus: 'pending_payment' }, transaction: t }
          );
          if (updatedRows > 0) {
            for (const item of order.items) {
              await Product.increment('real_stock', { by: item.quantity, where: { id: item.productId }, transaction: t });
            }
          }
          await t.commit();
        } catch (err) {
          await t.rollback();
        }
        const io = req.app.get('io');
        if (io) io.emit('storeUpdated');
      }
      return res.status(400).json({ success: false, message: 'Payment was not completed.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Payment verification failed.' });
  }
};

// ============================================================
// CASHFREE WEBHOOK 
// ============================================================
exports.cashfreeWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    if (!signature || !timestamp) return res.status(401).send('Missing signature headers.');

    let rawBody;
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf8');
    } else {
      rawBody = JSON.stringify(req.body); 
    }

    const payload = timestamp + rawBody;
    const expectedSignature = crypto.createHmac('sha256', process.env.CASHFREE_SECRET_KEY).update(payload).digest('base64');

    let signaturesMatch = false;
    try {
      signaturesMatch = crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
    } catch (_) {
      signaturesMatch = false;
    }

    if (!signaturesMatch) return res.status(403).send('Invalid signature.');

    const parsedData = JSON.parse(rawBody);
    const { data, type } = parsedData;

    if (type !== 'PAYMENT_SUCCESS_WEBHOOK') return res.status(200).send('Non-success event ignored.');

    const cashfreeOrderId = data.order.order_id;
    const order = await Order.findOne({
      where: { cashfreeOrderId },
      include: [{ model: OrderItem, as: 'items' }]
    });

    if (!order) return res.status(200).send('Order not found — skipped.');
    if (order.orderStatus === 'paid') return res.status(200).send('Already processed.');

    order.orderStatus = 'paid';
    await order.save();

    const io = req.app.get('io');
    if (io) io.emit('storeUpdated');

    return res.status(200).send('Webhook processed.');
  } catch (error) {
    return res.status(500).send('Webhook processing failed.');
  }
};