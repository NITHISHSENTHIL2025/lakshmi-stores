const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Product, Order, OrderItem, User, Notification, StoreSetting, ItemRequest, SupportThread, SupportMessage } = require('../models');

const STORE_CLOSE_TIME = process.env.STORE_CLOSE_TIME || '10:00 PM';
const PICKUP_READY_MINUTES = parseInt(process.env.PICKUP_READY_MINUTES || '10', 10);

const THREAD_STATUS = {
  AI: 'ai_answering',
  NEEDS_ADMIN: 'needs_admin',
  HUMAN_ACTIVE: 'human_active',
  RESOLVED: 'resolved'
};

// ============================================================
// 🧠 SUPERB ADVANCED NLP ENGINE (Zero External Dependencies)
// ============================================================

// 1. Stop Words (Noise Reduction)
const STOP_WORDS = new Set(['a', 'an', 'the', 'is', 'at', 'which', 'on', 'for', 'of', 'to', 'in', 'and', 'my', 'me', 'i', 'can', 'you', 'do', 'have', 'please', 'tell', 'what', 'where', 'how', 'much', 'many', 'will']);

// 2. Knowledge Graph: Synonym Mapping (Context Understanding)
const SYNONYMS = {
  'coke': 'coca cola', 
  'thumbs up': 'thums up', 
  'veggies': 'vegetables',
  'dal': 'lentils', 
  'atta': 'flour', 
  'chini': 'sugar', 
  'paani': 'water',
  'cost': 'price', 
  'rate': 'price', 
  'rupees': 'price',
  'where is my order': 'status', 
  'where is order': 'status', 
  'track': 'status'
};

// 3. Text Normalization & Expansion
const expandSynonyms = (text) => {
  let expanded = String(text).toLowerCase();
  for (const [slang, trueWord] of Object.entries(SYNONYMS)) {
    expanded = expanded.replace(new RegExp(`\\b${slang}\\b`, 'g'), trueWord);
  }
  return expanded;
};

const tokenize = (text) => expandSynonyms(text)
  .replace(/[^a-z0-9 ]/g, ' ')
  .split(' ')
  .filter(word => !STOP_WORDS.has(word) && word.length > 1);

// 4. Levenshtein Distance (Typo Tolerance Algorithm)
const getEditDistance = (a, b) => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array(a.length + 1).fill().map(() => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
};

// 5. Advanced Confidence Scorer for Intents
const classifyIntent = (text) => {
  const clean = expandSynonyms(text);
  const scores = { escalate: 0, order_status: 0, store_status: 0, product_search: 0 };

  if (/\b(missing|missed|not received|refund|wallet|money|damaged|wrong|spoiled|manager|human|complaint|cancel)\b/.test(clean)) scores.escalate += 10;
  if (/\b(order|status|track|token|pin)\b/.test(clean)) scores.order_status += 5;
  if (/\b(open|close|closing|hours|time|collect)\b/.test(clean)) scores.store_status += 5;
  if (/\b(price|cost|rate)\b/.test(clean)) scores.product_search += 3;

  let topIntent = 'product_search'; 
  let maxScore = 0;
  
  for (const [intent, score] of Object.entries(scores)) {
    if (score > maxScore) { maxScore = score; topIntent = intent; }
  }

  return { intent: topIntent, tokens: tokenize(clean) };
};

// 6. N-Gram & Fuzzy Product Matcher
const findBestProductMatch = (products, searchTokens) => {
  let bestProduct = null;
  let highestScore = 0;
  const searchString = searchTokens.join(' ');

  products.forEach(product => {
    const productTokens = tokenize(product.name);
    const prodString = productTokens.join(' ');
    let score = 0;

    if (searchString.includes(prodString) || prodString.includes(searchString)) score += 20;

    searchTokens.forEach(searchWord => {
      productTokens.forEach(prodWord => {
        if (searchWord === prodWord) {
          score += 10; 
        } else {
          const distance = getEditDistance(searchWord, prodWord);
          const similarityRatio = 1 - (distance / Math.max(searchWord.length, prodWord.length));
          
          if (similarityRatio > 0.8) score += 8; 
          else if (similarityRatio > 0.6) score += 4; 
        }
      });
    });

    if (score > highestScore) {
      highestScore = score;
      bestProduct = product;
    }
  });

  return highestScore >= 8 ? bestProduct : null;
};

// ============================================================
// DECISION ENGINE
// ============================================================
const processNLPDecision = async (message, user) => {
  const classification = classifyIntent(message);

  if (classification.intent === 'escalate') {
    return { type: 'escalate', reason: 'System detected complaint/refund intent.', reply: 'I am so sorry about this. Let me bring the store manager into this chat right now to help you. Please hold on a moment.' };
  }

  if (classification.intent === 'order_status') {
    if (!user) return { type: 'answer', reply: 'I can track your order instantly if you log in! For security, I cannot share order details with guest accounts.' };
    const order = await Order.findOne({ where: { userId: String(user.id) }, order: [['createdAt', 'DESC']], include: [{ model: OrderItem, as: 'items' }] });
    if (!order) return { type: 'answer', reply: 'I checked your account but could not find any recent active orders.' };
    
    const token = order.orderToken !== 'WAIT' ? order.orderToken : order.cashfreeOrderId.slice(-4);
    const statusFormatted = order.orderStatus.replace('_', ' ').toUpperCase();
    return { type: 'answer', reply: `Your latest order #${token} is currently: **${statusFormatted}**. The total amount is ₹${order.orderAmount}. If you have an issue with it, just let me know and I'll get the manager.` };
  }

  if (classification.intent === 'store_status') {
    const store = await StoreSetting.findByPk(1);
    if (!store || !store.isOpen) return { type: 'answer', reply: 'The shop is currently closed. We will resume taking orders when the store opens tomorrow!' };
    if (store.closingWarningActive) return { type: 'answer', reply: `We are open, but closing very soon! If you want to place an order, please do it immediately. Normal hours end at ${STORE_CLOSE_TIME}.` };
    return { type: 'answer', reply: `We are open! You can place an order online and pick it up at the counter. Orders are usually packed and ready in about ${PICKUP_READY_MINUTES} minutes.` };
  }

  const products = await Product.findAll({ where: { isActive: true } });
  const matchedProduct = findBestProductMatch(products, classification.tokens);

  if (matchedProduct) {
    const safeStock = Math.max(0, (matchedProduct.real_stock || 0) - (matchedProduct.buffer ?? 2));
    if (safeStock > 0) {
      return { type: 'answer', reply: `Yes, we have **${matchedProduct.name}**! It costs ₹${matchedProduct.price} per ${matchedProduct.isSoldByWeight ? 'KG' : 'item'}. We have roughly ${safeStock} available in stock right now.` };
    } else {
      return { type: 'answer', reply: `We do carry **${matchedProduct.name}**, but it looks like we are Out of Stock right now. ${matchedProduct.restockEta ? `Expected restock: ${matchedProduct.restockEta}.` : 'I will notify the team you asked about it!'}` };
    }
  }

  if (classification.tokens.length > 0) {
    const candidate = classification.tokens.slice(0, 3).join(' ');
    await ItemRequest.findOrCreate({ where: { itemName: candidate }, defaults: { requestCount: 1 } });
    return { type: 'answer', reply: `I searched the live catalog but couldn't find "${candidate}". I have automatically submitted a request to the store manager to stock this item!` };
  }

  return { type: 'answer', reply: "Hi! I am the Lakshmi Stores assistant. You can ask me about item availability (e.g., 'price of sprite'), store hours, or track your latest order." };
};

// ============================================================
// ROUTING HELPERS
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
  await Notification.create({ userId: 'GLOBAL', title: 'Customer needs help', message: `${thread.customerName || 'Customer'}: ${String(customerMessage).slice(0, 100)}...`, isRead: false });
  const io = req.app.get('io');
  if (io) { io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.NEEDS_ADMIN, reason }); io.emit('storeUpdated'); }
};

const appendMessage = async (thread, senderType, body, senderName = null) => {
  const msg = await SupportMessage.create({ threadId: thread.id, senderType, senderName, body });
  await thread.update({ lastMessagePreview: String(body).slice(0, 500), lastCustomerMessageAt: senderType === 'customer' ? new Date() : thread.lastCustomerMessageAt });
  return msg;
};

// ============================================================
// MAIN CHAT ENDPOINT
// ============================================================
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

    // 🚨 RUN THE SUPERB NLP ENGINE
    const decision = await processNLPDecision(message, user);

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

// ============================================================
// ADMIN ROUTES
// ============================================================
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