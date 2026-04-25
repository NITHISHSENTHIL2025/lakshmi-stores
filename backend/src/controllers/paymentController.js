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
  const [hours, minutes] = time24.split(':');
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

const CASHFREE_BASE_URL = process.env.NODE_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

// ============================================================
// CREATE ORDER
// ============================================================
exports.createOrder = async (req, res) => {
  const { customerEmail, customerPhone, items, paymentMethod, pickupTime, customerNote } = req.body;
  const idempotencyKey = req.headers['x-idempotency-key'];

  // 🚨 PRODUCTION FIX: Swiggy-Level Idempotency Check
  // Prevents double-charging if the user double-taps the pay button
  if (idempotencyKey) {
    const existingOrder = await Order.findOne({ where: { idempotencyKey } });
    if (existingOrder) {
      console.log(`♻️ Idempotency key matched! Returning existing order: ${existingOrder.orderToken}`);
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

  if (pickupTime && pickupTime !== 'ASAP' && pickupTime !== 'LATER') {
    const [hours] = pickupTime.split(':').map(Number);
    if (hours < 8 || hours >= 22) return res.status(400).json({ success: false, message: 'Pickup time must be between 8 AM and 10 PM.' });
  }

  const t = await sequelize.transaction();

  try {
    const userId = req.user.id;
    const safeEmail = customerEmail || 'customer@lakshmistores.com';
    const formattedPickupTime = formatAMPM(pickupTime);
    const exactPaymentType = paymentMethod === 'cash' ? 'CASH' : 'ONLINE';

    let backendCalculatedTotal = 0;
    const finalItemsList = [];

    // Sort to prevent Deadlocks
    const sortedItems = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));

    for (const item of sortedItems) {
      const qty = Math.round(Number(item.quantity));
      if (qty < 1) {
        await t.rollback();
        return res.status(400).json({ success: false, message: 'Invalid quantity.' });
      }

      const product = await Product.findByPk(item.id, { transaction: t, lock: t.LOCK.UPDATE });

      if (!product || product.isActive === false) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `Item no longer available.` });
      }

      if (product.real_stock < qty) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `Not enough stock for ${product.name}.` });
      }

      if (Math.abs(Number(product.price) - Number(item.price)) > 0.01) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `Price mismatch for ${product.name}. Please refresh.` });
      }

      backendCalculatedTotal += Number(product.price) * qty;
      finalItemsList.push({ id: product.id, name: product.name, price: product.price, quantity: qty, category: product.category });

      await product.decrement('real_stock', { by: qty, transaction: t });
    }

    if (backendCalculatedTotal < 50) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Minimum order value is ₹50.' });
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
      customerNote: customerNote ? customerNote.substring(0, 500) : null,
      customerEmail: safeEmail,
      customerPhone: safePhone,
      idempotencyKey: idempotencyKey || null // Save the key for future deduplication
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
      order_meta: { return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-status?order_id=${cashfreeOrderId}` }
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

      // Save the session ID so idempotency can return it if needed later
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
      return res.status(500).json({ success: false, message: 'Payment gateway error. Please try again.' });
    }

  } catch (error) {
    if (t && t.finished !== 'commit') { try { await t.rollback(); } catch (_) {} }
    return res.status(500).json({ success: false, message: 'Server error during checkout.' });
  }
};

// ============================================================
// VERIFY PAYMENT 
// ============================================================
exports.verifyPayment = async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) {
      return res.status(400).json({ success: false, message: 'order_id is required.' });
    }

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
          console.error('❌ Stock restore failed in verifyPayment:', err.message);
        }
        
        const io = req.app.get('io');
        if (io) io.emit('storeUpdated');
      }
      return res.status(400).json({ success: false, message: 'Payment was not completed.' });
    }
  } catch (error) {
    console.error('❌ Payment verification error:', error.response?.data || error.message);
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
    console.error('❌ Webhook processing error:', error);
    return res.status(500).send('Webhook processing failed.');
  }
};