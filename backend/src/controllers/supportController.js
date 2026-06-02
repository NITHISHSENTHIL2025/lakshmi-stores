const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const Product = require('../models/Product');
const Order = require('../models/Order');
const OrderItem = require('../models/OrderItem');
const User = require('../models/User');
const Notification = require('../models/Notification');
const StoreSetting = require('../models/StoreSetting');
const ItemRequest = require('../models/ItemRequest');
const SupportThread = require('../models/SupportThread');
const SupportMessage = require('../models/SupportMessage');

const STORE_CLOSE_TIME = process.env.STORE_CLOSE_TIME || '10:00 PM';
const PICKUP_READY_MINUTES = parseInt(process.env.PICKUP_READY_MINUTES || '10', 10);

const THREAD_STATUS = {
  AI: 'ai_answering',
  NEEDS_ADMIN: 'needs_admin',
  HUMAN_ACTIVE: 'human_active',
  RESOLVED: 'resolved'
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'at', 'available', 'can', 'close', 'closing',
  'counter', 'do', 'fresh', 'get', 'have', 'hours', 'i', 'in', 'is', 'it', 'left',
  'now', 'of', 'open', 'pickup', 'pick', 'please', 'shop', 'stock', 'store',
  'there', 'time', 'up', 'we', 'what', 'when', 'you'
]);

const truncate = (value = '', max = 180) => {
  const clean = String(value).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
};

const normalize = (value = '') => (
  String(value).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
);

const getTokens = (value = '') => normalize(value).split(' ').filter(Boolean);

const getMeaningfulTokens = (value = '') => (
  getTokens(value).filter((token) => token.length > 1 && !STOP_WORDS.has(token))
);

const sanitizeItemName = (value = '') => (
  normalize(value).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
);

const getOptionalUser = async (req) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    return await User.findByPk(decoded.id, {
      attributes: ['id', 'name', 'email', 'phone', 'role', 'isVerified']
    });
  } catch (error) {
    return null;
  }
};

const serializeThread = async (thread) => {
  const messages = await SupportMessage.findAll({
    where: { threadId: thread.id },
    order: [['createdAt', 'ASC']]
  });

  return {
    ...thread.toJSON(),
    messages
  };
};

const emitSupportUpdate = (req, thread) => {
  const io = req.app.get('io');
  if (!io) return;
  io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
};

const notifyAdmin = async (req, thread, reason, customerMessage) => {
  const customerLabel = thread.customerName || thread.customerEmail || 'Customer';
  await Notification.create({
    userId: 'GLOBAL',
    title: 'Customer needs help',
    message: `${customerLabel}: ${truncate(customerMessage, 120)}`,
    isRead: false
  });

  const io = req.app.get('io');
  if (io) {
    io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.NEEDS_ADMIN, reason });
    io.emit('storeUpdated');
  }
};

const getOrCreateThread = async (threadId, user) => {
  let thread = null;
  if (threadId) thread = await SupportThread.findByPk(threadId);

  if (!thread) {
    thread = await SupportThread.create({
      userId: user ? String(user.id) : null,
      customerName: user?.name || null,
      customerEmail: user?.email || null,
      customerPhone: user?.phone || null,
      status: THREAD_STATUS.AI,
      aiEnabled: true
    });
  }

  if (thread.status === THREAD_STATUS.RESOLVED) {
    await thread.update({
      status: THREAD_STATUS.AI,
      aiEnabled: true,
      resolvedAt: null,
      handledBy: null,
      escalationReason: null
    });
  }

  if (user && !thread.userId) {
    await thread.update({
      userId: String(user.id),
      customerName: user.name || thread.customerName,
      customerEmail: user.email || thread.customerEmail,
      customerPhone: user.phone || thread.customerPhone
    });
  }

  return thread;
};

const appendMessage = async (thread, senderType, body, senderName = null, metadata = null) => {
  const message = await SupportMessage.create({
    threadId: thread.id,
    senderType,
    senderName,
    body,
    metadata
  });

  await thread.update({
    lastMessagePreview: truncate(body, 500),
    lastCustomerMessageAt: senderType === 'customer' ? new Date() : thread.lastCustomerMessageAt,
    lastAdminMessageAt: senderType === 'admin' ? new Date() : thread.lastAdminMessageAt
  });

  return message;
};

const getStoreStatus = async () => {
  const setting = await StoreSetting.findByPk(1);
  return {
    isOpen: setting ? setting.isOpen : true,
    closingWarningActive: setting ? setting.closingWarningActive : false
  };
};

const findBestProduct = (products, text) => {
  const query = normalize(text);
  const queryTokens = new Set(getTokens(text));

  let best = null;
  let bestScore = 0;

  products.forEach((product) => {
    const name = normalize(product.name);
    const nameTokens = getTokens(product.name).filter((token) => token.length > 1);
    let score = 0;

    if (name && query.includes(name)) score += 6;
    nameTokens.forEach((token) => {
      if (queryTokens.has(token)) score += token.length > 3 ? 2 : 1;
    });

    if (score > bestScore) {
      best = product;
      bestScore = score;
    }
  });

  return bestScore > 0 ? best : null;
};

const answerProductQuestion = (product, storeStatus) => {
  const realStock = Number(product.real_stock || 0);
  const buffer = Number(product.buffer ?? 2);
  const availableStock = Math.max(0, realStock - buffer);
  const unit = product.isSoldByWeight ? 'kg' : 'available';

  if (availableStock > 0) {
    const stockText = product.isSoldByWeight
      ? `${availableStock} kg`
      : `${availableStock} ${unit}`;
    const pickupText = storeStatus.isOpen
      ? ` We are open until ${STORE_CLOSE_TIME}, and pickup is usually ready in about ${PICKUP_READY_MINUTES} minutes.`
      : ' Pickup is paused because the shop is currently closed.';
    const warningText = storeStatus.closingWarningActive
      ? ' The closing warning is active, so please place the order now if you need it today.'
      : '';

    return `Yes, ${product.name} is in stock. We have ${stockText} right now.${pickupText}${warningText}`;
  }

  if (realStock > 0) {
    return `${product.name} is extremely low right now. Online stock is protected by the store buffer, so please let the counter confirm before promising it.`;
  }

  if (product.restockEta) {
    return `${product.name} is out of stock right now. Expected restock: ${product.restockEta}.`;
  }

  return `${product.name} is out of stock right now. I can still note the demand for the store team if you want.`;
};

const answerStoreQuestion = (storeStatus) => {
  if (!storeStatus.isOpen) {
    return `The shop is closed right now. Normal pickup will resume when the shutter is opened by the store team.`;
  }

  if (storeStatus.closingWarningActive) {
    return `The shop is open but closing soon. Please order immediately if you want pickup today. Most pickup orders are ready in about ${PICKUP_READY_MINUTES} minutes.`;
  }

  return `Yes, pickup is available now. We are open until ${STORE_CLOSE_TIME}, and most orders are ready in about ${PICKUP_READY_MINUTES} minutes.`;
};

const answerOrderQuestion = async (user) => {
  if (!user) {
    return 'I can check your latest order once you log in. For privacy, I cannot show order details without your account.';
  }

  const order = await Order.findOne({
    where: { userId: String(user.id) },
    order: [['createdAt', 'DESC']],
    include: [{ model: OrderItem, as: 'items' }]
  });

  if (!order) return 'I do not see any orders on your account yet.';

  const token = order.orderToken && order.orderToken !== 'WAIT'
    ? order.orderToken
    : order.cashfreeOrderId?.slice(-4) || 'latest';

  const status = String(order.orderStatus || '').toLowerCase();
  const itemCount = order.items?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0;

  const statusText = {
    pending_payment: 'payment is still pending',
    pending_cash: 'it is waiting for cash payment at the counter',
    pending_approval: 'it is waiting for store approval',
    paid: 'it is received and waiting to be packed',
    packed: 'it is packed and will be called soon',
    ready: 'it is ready for pickup',
    completed: 'it has been completed',
    cancelled: 'it was cancelled',
    failed: 'payment failed'
  }[status] || `current status is ${status || 'unknown'}`;

  return `Your order #${token} has ${itemCount} item(s), and ${statusText}. If anything is missing or wrong, I will bring the store manager into this chat.`;
};

const recordMissingItemRequest = async (text) => {
  const candidate = sanitizeItemName(getMeaningfulTokens(text).slice(0, 4).join(' '));
  if (candidate.length < 2 || candidate.length > 100) return null;

  const [request, created] = await ItemRequest.findOrCreate({
    where: { itemName: candidate },
    defaults: { requestCount: 1 }
  });

  if (!created) {
    request.requestCount += 1;
    await request.save();
  }

  return candidate;
};

const classifyEscalation = (text) => {
  const clean = normalize(text);
  const rules = [
    { reason: 'missing_item', pattern: /\b(missing|missed|short|not received|did not receive)\b/ },
    { reason: 'refund_or_wallet', pattern: /\b(refund|wallet|charged|money|cashback)\b/ },
    { reason: 'wrong_or_damaged_item', pattern: /\b(wrong|damaged|spoiled|expired|broken|leaking|bad quality)\b/ },
    { reason: 'delivery_or_pickup_problem', pattern: /\b(complaint|problem|issue|manager|owner|human|help me)\b/ },
    { reason: 'cancel_request', pattern: /\b(cancel my order|cancel order)\b/ }
  ];

  return rules.find((rule) => rule.pattern.test(clean))?.reason || null;
};

const getAssistantDecision = async (text, user) => {
  const clean = normalize(text);
  const escalationReason = classifyEscalation(text);
  if (escalationReason) {
    return {
      type: 'escalate',
      reason: escalationReason,
      priority: 'urgent',
      reply: 'I am sorry about that. This needs the store manager, so I am bringing them into this chat now. Please hold on for a moment.'
    };
  }

  const products = await Product.findAll({
    where: { isActive: true },
    order: [['name', 'ASC']]
  });
  const storeStatus = await getStoreStatus();
  const matchedProduct = findBestProduct(products, text);

  const stockIntent = /\b(do you have|have|stock|available|left|in stock|out of stock|fresh)\b/.test(clean);
  if (matchedProduct) {
    return {
      type: 'answer',
      reply: answerProductQuestion(matchedProduct, storeStatus),
      metadata: { productId: matchedProduct.id }
    };
  }

  if (stockIntent) {
    const itemName = await recordMissingItemRequest(text);
    return {
      type: 'answer',
      reply: itemName
        ? `I could not find "${itemName}" in the live catalog. I have noted it for the store team so they can stock it or add a restock ETA.`
        : 'I could not find that item in the live catalog. Try the product name, for example "paneer" or "onion".'
    };
  }

  const orderIntent = /\b(order|status|token|pin|payment)\b/.test(clean);
  if (orderIntent) {
    return { type: 'answer', reply: await answerOrderQuestion(user) };
  }

  const storeIntent = /\b(open|close|closing|hours|pickup|pick up|collect|counter|time)\b/.test(clean);
  if (storeIntent) {
    return { type: 'answer', reply: answerStoreQuestion(storeStatus) };
  }

  return {
    type: 'answer',
    reply: 'Hi, I am the Lakshmi Stores assistant. Ask me about item stock, pickup timing, or your latest order. If something went wrong with an order, I will bring the store manager into this chat.'
  };
};

exports.chat = async (req, res) => {
  try {
    const message = truncate(req.body.message || '', 1000);
    const threadId = req.body.threadId || null;

    if (!message || message.length < 1) {
      return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    const user = await getOptionalUser(req);
    const thread = await getOrCreateThread(threadId, user);

    await appendMessage(thread, 'customer', message, user?.name || 'Customer');

    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({
        status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status,
        priority: thread.priority || 'urgent'
      });
      emitSupportUpdate(req, thread);
      return res.json({ success: true, thread: await serializeThread(thread) });
    }

    const decision = await getAssistantDecision(message, user);
    await appendMessage(thread, 'assistant', decision.reply, 'Lakshmi Assistant', decision.metadata || null);

    if (decision.type === 'escalate') {
      await thread.update({
        status: THREAD_STATUS.NEEDS_ADMIN,
        priority: decision.priority,
        escalationReason: decision.reason,
        aiEnabled: false
      });
      await notifyAdmin(req, thread, decision.reason, message);
    } else {
      await thread.update({
        status: THREAD_STATUS.AI,
        priority: 'normal',
        aiEnabled: true
      });
    }

    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) {
    console.error('Support chat error:', error);
    res.status(500).json({ success: false, message: 'Support assistant failed to respond.' });
  }
};

exports.getPublicThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) {
    console.error('Fetch support thread error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch support thread.' });
  }
};

exports.getThreads = async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};

    if (status === 'active') where.status = { [Op.ne]: THREAD_STATUS.RESOLVED };
    else if (status) where.status = status;

    const threads = await SupportThread.findAll({
      where,
      order: [['updatedAt', 'DESC']],
      limit: 50
    });

    const data = await Promise.all(threads.map(serializeThread));
    res.json({ success: true, data });
  } catch (error) {
    console.error('Fetch support threads error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch support threads.' });
  }
};

exports.adminReply = async (req, res) => {
  try {
    const message = truncate(req.body.message || '', 1000);
    if (!message) return res.status(400).json({ success: false, message: 'Message is required.' });

    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await appendMessage(thread, 'admin', message, req.user?.name || 'Store Manager');
    await thread.update({
      status: THREAD_STATUS.HUMAN_ACTIVE,
      aiEnabled: false,
      handledBy: req.user?.name || 'Store Manager',
      priority: 'normal'
    });

    emitSupportUpdate(req, thread);
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) {
    console.error('Admin support reply error:', error);
    res.status(500).json({ success: false, message: 'Failed to send reply.' });
  }
};

exports.resolveThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await appendMessage(thread, 'system', 'Conversation marked resolved by the store team.', 'System');
    await thread.update({
      status: THREAD_STATUS.RESOLVED,
      aiEnabled: false,
      resolvedAt: new Date(),
      priority: 'normal'
    });

    emitSupportUpdate(req, thread);
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) {
    console.error('Resolve support thread error:', error);
    res.status(500).json({ success: false, message: 'Failed to resolve thread.' });
  }
};
