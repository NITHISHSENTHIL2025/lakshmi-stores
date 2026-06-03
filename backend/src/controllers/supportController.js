const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Product, Order, OrderItem, User, Notification, StoreSetting, ItemRequest, SupportThread, SupportMessage } = require('../models');

const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };
const PICKUP_READY_MINUTES = 10;
const STORE_CLOSE_TIME = '10:00 PM';

// ============================================================
// 🧠 V5 NLP ENGINE (Contextual Memory & FAQ Support)
// ============================================================

const STOP_WORDS = new Set(['a', 'an', 'the', 'is', 'at', 'which', 'on', 'for', 'of', 'to', 'in', 'and', 'my', 'me', 'i', 'can', 'you', 'do', 'have', 'please', 'tell', 'what', 'where', 'how', 'much', 'many', 'will', 'are', 'am', 'was', 'were', 'it', 'this', 'that', 'there', 'any', 'ok', 'okay']);

const SYNONYMS = {
  'coke': 'coca cola', 'thumbs up': 'thums up', 'veggies': 'vegetables', 'dal': 'lentils', 
  'cost': 'price', 'rate': 'price', 'where is my order': 'status', 'track': 'status', 
  'hi': 'hello', 'hey': 'hello', 'hiii': 'hello', 'hii': 'hello', 'details': 'items'
};

const expandSynonyms = (text) => {
  let expanded = String(text).toLowerCase();
  for (const [slang, trueWord] of Object.entries(SYNONYMS)) {
    expanded = expanded.replace(new RegExp(`\\b${slang}\\b`, 'g'), trueWord);
  }
  return expanded;
};

const getTokens = (text) => expandSynonyms(text)
  .replace(/[^a-z0-9 ]/g, ' ')
  .split(' ')
  .filter(word => !STOP_WORDS.has(word) && word.length > 1);

const getSimilarity = (a, b) => {
  if (a.length === 0 || b.length === 0) return 0;
  const matrix = Array(a.length + 1).fill().map(() => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return 1 - (matrix[a.length][b.length] / Math.max(a.length, b.length));
};

// 1. Refined Intent Classifier
const analyzeCustomerNeed = (text) => {
  const cleanText = expandSynonyms(text);
  const tokens = getTokens(cleanText);
  
  const analysis = { intent: 'unknown', extractedTokens: tokens, score: 0 };

  const scores = { 
    escalate: 0, order_status: 0, store_status: 0, 
    store_info: 0, greeting: 0, product_search: 0, 
    faq_return: 0, faq_offers: 0, context_login: 0 
  };

  // Specific Context Overrides
  if (/\b(already logged in|i am logged in)\b/.test(cleanText)) scores.context_login += 50;
  if (/\b(return policy|refund policy|exchange policy)\b/.test(cleanText)) scores.faq_return += 50;
  if (/\b(offer|offers|discount|discounts|sale|promo)\b/.test(cleanText)) scores.faq_offers += 50;

  // Standard Intents
  if (/\b(missing|not received|damaged|wrong|spoiled|manager|human|complaint|cancel)\b/.test(cleanText)) scores.escalate += 20;
  if (/\b(order|status|track|token|pin|items)\b/.test(cleanText)) scores.order_status += 10;
  if (/\b(open|close|closing|closed|hours|time)\b/.test(cleanText)) scores.store_status += 25; // Boosted to override order
  if (/\b(store name|who are you|location|address)\b/.test(cleanText)) scores.store_info += 10;
  if (/^(hello|hey|morning|evening|thanks|yes|no)$/i.test(cleanText.trim())) scores.greeting += 10;
  if (/\b(price|cost|rate|stock|buy)\b/.test(cleanText)) scores.product_search += 5;

  for (const [intent, score] of Object.entries(scores)) {
    if (score > analysis.score) {
      analysis.score = score;
      analysis.intent = intent;
    }
  }

  // Fallback Logic
  if (analysis.score === 0) {
    if (tokens.length <= 2) analysis.intent = 'greeting'; // Absorbs short junk text
    else analysis.intent = 'product_search';
  }

  return analysis;
};

const findBestProductMatch = (products, searchTokens) => {
  let bestMatch = { product: null, score: 0, isFuzzy: false };
  const searchString = searchTokens.join(' ');

  products.forEach(product => {
    const prodString = product.name.toLowerCase();
    const prodTokens = prodString.split(' ');
    let currentScore = 0;

    if (searchString.includes(prodString) || prodString.includes(searchString)) {
      currentScore = 100;
    } else {
      searchTokens.forEach(searchWord => {
        prodTokens.forEach(prodWord => {
          const similarity = getSimilarity(searchWord, prodWord);
          if (similarity === 1) currentScore += 20;
          else if (similarity > 0.8) currentScore += 10;
        });
      });
    }

    if (currentScore > bestMatch.score) {
      bestMatch.score = currentScore;
      bestMatch.product = product;
      bestMatch.isFuzzy = currentScore < 100 && currentScore > 10;
    }
  });

  return bestMatch;
};

// ============================================================
// RESPONSE GENERATION
// ============================================================
const generateElaboratedResponse = async (analysis, user) => {
  
  if (analysis.intent === 'escalate') {
    return { type: 'escalate', reason: 'Customer requested human support/complaint.', reply: "I am genuinely sorry you are facing an issue. I am alerting the store owner immediately so they can look into your account and fix this for you. Please hold on just a moment." };
  }

  if (analysis.intent === 'faq_return') {
    return { type: 'answer', reply: "Our Return & Refund Policy: If an item is damaged or incorrect, please bring it back to the counter within 24 hours for a replacement or a direct refund to your wallet. If you need a refund right now, just type 'manager'." };
  }

  if (analysis.intent === 'faq_offers') {
    return { type: 'answer', reply: "We regularly update our catalog with direct discounts! All prices you see on the digital store already have our daily savings applied. Keep an eye on the top banners for seasonal promo codes." };
  }

  if (analysis.intent === 'context_login') {
    if (user) {
      const order = await Order.findOne({ where: { userId: String(user.id) }, order: [['createdAt', 'DESC']], include: [{ model: OrderItem, as: 'items' }] });
      if (!order) return { type: 'answer', reply: "I see you are logged in! However, I checked your account and couldn't find any recent orders." };
      const itemString = order.items.map(item => `• ${item.quantity}x ${item.name}`).join('\n');
      return { type: 'answer', reply: `I see you are logged in! Here is your latest order details:\n\n**Status:** ${order.orderStatus.toUpperCase()}\n**Total:** ₹${order.orderAmount}\n**Items:**\n${itemString}` };
    }
    return { type: 'answer', reply: "My system still doesn't see an active session for you. Try refreshing the page, or logging out and logging back in!" };
  }

  if (analysis.intent === 'greeting') {
    return { type: 'answer', reply: "Hello! 👋 I am the Lakshmi Stores digital assistant. How can I help you with your groceries today?" };
  }

  if (analysis.intent === 'store_info') {
    return { type: 'answer', reply: "This is **Lakshmi Stores**! We are your local, fast-pickup grocery store." };
  }

  if (analysis.intent === 'store_status') {
    const store = await StoreSetting.findByPk(1);
    if (!store || !store.isOpen) return { type: 'answer', reply: 'Currently, the shutter is down and **we are closed**. We will resume accepting express pickup orders as soon as the store team opens the counter!' };
    if (store.closingWarningActive) return { type: 'answer', reply: `We are currently **Open**, but the store team has activated the closing warning! Normal hours end at **${STORE_CLOSE_TIME}**. Please finalize your cart immediately.` };
    return { type: 'answer', reply: `We are currently **Open** and accepting orders. Once placed, your order will be packed and ready for pickup within **${PICKUP_READY_MINUTES} minutes**.` };
  }

  if (analysis.intent === 'order_status') {
    if (!user) return { type: 'answer', reply: 'I would love to give you an update! Please log in to your account first so I can securely retrieve your details.' };
    const order = await Order.findOne({ where: { userId: String(user.id) }, order: [['createdAt', 'DESC']], include: [{ model: OrderItem, as: 'items' }] });
    if (!order) return { type: 'answer', reply: 'I checked your history, but there are no past orders to display.' };
    
    const token = order.orderToken !== 'WAIT' ? order.orderToken : order.cashfreeOrderId.slice(-4);
    const itemString = order.items.map(item => `• ${item.quantity}x ${item.name}`).join('\n');
    return { type: 'answer', reply: `Your latest order (**#${token}**) is currently **${order.orderStatus.toUpperCase()}**.\n\n**Items:**\n${itemString}\n**Total:** ₹${order.orderAmount}\n\nIf you need to report an issue, please type "manager".` };
  }

  if (analysis.intent === 'product_search' && analysis.extractedTokens.length > 0) {
    const products = await Product.findAll({ where: { isActive: true } });
    const { product, score, isFuzzy } = findBestProductMatch(products, analysis.extractedTokens);

    if (product && score >= 15) {
      const safeStock = Math.max(0, (product.real_stock || 0) - (product.buffer ?? 2));
      let prefix = isFuzzy ? `I believe you are looking for **${product.name}**! ` : `I checked our shelves for **${product.name}**. `;

      if (safeStock > 0) return { type: 'answer', reply: `${prefix}We have about **${safeStock} available** right now. The price is **₹${product.price}**. You can add it to your cart directly from the store page!` };
      return { type: 'answer', reply: `${prefix}Unfortunately, we are completely **Out of Stock** right now. ${product.restockEta ? `Expected restock: **${product.restockEta}**.` : ''}` };
    }

    // Completely Disabled the auto-logging to prevent junk database entries
    const candidate = analysis.extractedTokens.slice(0, 3).join(' ');
    return { type: 'answer', reply: `I searched the live catalog, but unfortunately, we don't currently sell **"${candidate}"**. If you want me to request the manager to stock it, just type "manager"!` };
  }

  return { type: 'answer', reply: "I didn't quite catch that. You can ask me to check the price of specific groceries, track your orders, or check our store timings." };
};

// ============================================================
// ROUTING HELPERS & ENDPOINT
// ============================================================
const getOptionalUser = async (req) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    return await User.findByPk(decoded.id, { attributes: ['id', 'name', 'email', 'phone', 'role', 'isVerified'] });
  } catch (error) { return null; }
};

const serializeThread = async (thread) => {
  const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
  return { ...thread.toJSON(), messages };
};

const notifyAdmin = async (req, thread, reason, customerMessage) => {
  await Notification.create({ userId: 'GLOBAL', title: 'Customer Needs Assistance', message: `${thread.customerName || 'Customer'}: ${String(customerMessage).slice(0, 100)}...`, isRead: false });
  const io = req.app.get('io');
  if (io) { io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.NEEDS_ADMIN, reason }); io.emit('storeUpdated'); }
};

const appendMessage = async (thread, senderType, body, senderName = null) => {
  const msg = await SupportMessage.create({ threadId: thread.id, senderType, senderName, body });
  await thread.update({ lastMessagePreview: String(body).slice(0, 500), lastCustomerMessageAt: senderType === 'customer' ? new Date() : thread.lastCustomerMessageAt });
  return msg;
};

exports.chat = async (req, res) => {
  try {
    const message = String(req.body.message || '').trim().slice(0, 1000);
    if (!message) return res.status(400).json({ success: false, message: 'Message is required.' });

    const user = await getOptionalUser(req);
    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    
    if (!thread) {
      thread = await SupportThread.create({ userId: user ? String(user.id) : null, customerName: user?.name, customerEmail: user?.email, customerPhone: user?.phone, status: THREAD_STATUS.AI, aiEnabled: true });
    } else if (thread.status === THREAD_STATUS.RESOLVED) {
      await thread.update({ status: THREAD_STATUS.AI, aiEnabled: true, resolvedAt: null, handledBy: null, escalationReason: null });
    }

    await appendMessage(thread, 'customer', message, user?.name || 'Customer');

    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({ status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
      return res.json({ success: true, thread: await serializeThread(thread) });
    }

    const analysis = analyzeCustomerNeed(message);
    const decision = await generateElaboratedResponse(analysis, user);

    if (decision.reply) await appendMessage(thread, 'assistant', decision.reply, 'Lakshmi Assistant');

    if (decision.type === 'escalate') {
      await thread.update({ status: THREAD_STATUS.NEEDS_ADMIN, priority: 'urgent', escalationReason: decision.reason, aiEnabled: false });
      await notifyAdmin(req, thread, decision.reason, message);
    } else {
      await thread.update({ status: THREAD_STATUS.AI, priority: 'normal', aiEnabled: true });
    }

    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) {
    console.error('NLP Engine error:', error);
    res.status(500).json({ success: false, message: 'Support assistant failed to respond.' });
  }
};

exports.getPublicThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to fetch thread.' }); }
};

exports.getThreads = async (req, res) => {
  try {
    const { status } = req.query;
    const where = status === 'active' ? { status: { [Op.ne]: THREAD_STATUS.RESOLVED } } : (status ? { status } : {});
    const threads = await SupportThread.findAll({ where, order: [['updatedAt', 'DESC']], limit: 50 });
    res.json({ success: true, data: await Promise.all(threads.map(serializeThread)) });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to fetch threads.' }); }
};

exports.adminReply = async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ success: false, message: 'Message is required.' });
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await appendMessage(thread, 'admin', message, req.user?.name || 'Store Manager');
    await thread.update({ status: THREAD_STATUS.HUMAN_ACTIVE, aiEnabled: false, handledBy: req.user?.name });
    
    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to send reply.' }); }
};

exports.resolveThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await appendMessage(thread, 'system', 'Conversation marked resolved by the store team.', 'System');
    await thread.update({ status: THREAD_STATUS.RESOLVED, aiEnabled: false, resolvedAt: new Date() });

    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to resolve thread.' }); }
};