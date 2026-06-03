const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Product, Order, OrderItem, User, Notification, StoreSetting, ItemRequest, SupportThread, SupportMessage } = require('../models');

const STORE_CLOSE_TIME = process.env.STORE_CLOSE_TIME || '10:00 PM';
const PICKUP_READY_MINUTES = parseInt(process.env.PICKUP_READY_MINUTES || '10', 10);

const THREAD_STATUS = {
  AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved'
};

// ============================================================
// 🧠 V4 ULTIMATE NLP ENGINE (Sentiment, Bi-Grams, & Deep Context)
// ============================================================

// 1. Dictionaries & Knowledge Graph
const STOP_WORDS = new Set(['a', 'an', 'the', 'is', 'at', 'which', 'on', 'for', 'of', 'to', 'in', 'and', 'my', 'me', 'i', 'can', 'you', 'do', 'have', 'please', 'tell', 'what', 'where', 'how', 'much', 'many', 'will', 'are', 'am', 'was', 'were', 'it', 'this', 'that']);

const SYNONYMS = {
  'coke': 'coca cola', 'thumbs up': 'thums up', 'veggies': 'vegetables', 'dal': 'lentils', 
  'atta': 'flour', 'chini': 'sugar', 'paani': 'water', 'cost': 'price', 'rate': 'price', 
  'rupees': 'price', 'where is my order': 'status', 'track': 'status', 'hi': 'hello', 
  'hey': 'hello', 'hiii': 'hello', 'hii': 'hello', 'details': 'items', 'list': 'items'
};

const NEGATIVE_SENTIMENT = /\b(bad|worst|terrible|hate|stupid|fuck|shit|angry|upset|frustrated|useless|scam|fake)\b/i;

// 2. Advanced Text Normalization & Bi-Gram Generation
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
  .filter(word => word.length > 1); // Keep stop words initially for bi-grams

const getBigrams = (tokens) => {
  let bigrams = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
};

// 3. Mathematical Typo Tolerance (Levenshtein + Similarity Ratio)
const getSimilarity = (a, b) => {
  if (a.length === 0) return 0;
  if (b.length === 0) return 0;
  const matrix = Array(a.length + 1).fill().map(() => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  const distance = matrix[a.length][b.length];
  return 1 - (distance / Math.max(a.length, b.length));
};

// 4. Deep Intent Classifier & Sentiment Analyzer
const analyzeCustomerNeed = (text) => {
  const cleanText = expandSynonyms(text);
  const tokens = getTokens(cleanText);
  const bigrams = getBigrams(tokens);
  const meaningfulTokens = tokens.filter(t => !STOP_WORDS.has(t));
  
  const analysis = {
    intent: 'product_search',
    sentiment: 'neutral',
    isFrustrated: false,
    extractedTokens: meaningfulTokens,
    score: 0
  };

  // Sentiment Check
  if (NEGATIVE_SENTIMENT.test(cleanText) || (text === text.toUpperCase() && text.length > 10)) {
    analysis.sentiment = 'negative';
    analysis.isFrustrated = true;
    analysis.intent = 'escalate';
    return analysis; // Immediate bypass for angry customers
  }

  const scores = { escalate: 0, order_history: 0, order_status: 0, store_status: 0, store_info: 0, greeting: 0, product_search: 0 };

  // Unigram Scoring
  meaningfulTokens.forEach(t => {
    if (['missing', 'refund', 'return', 'wallet', 'damaged', 'wrong', 'manager', 'human', 'complaint', 'cancel'].includes(t)) scores.escalate += 10;
    if (['order', 'track', 'status', 'token', 'pin'].includes(t)) scores.order_status += 5;
    if (['items', 'detailed', 'bought', 'history'].includes(t)) scores.order_history += 6;
    if (['open', 'close', 'closing', 'hours', 'time'].includes(t)) scores.store_status += 5;
    if (['name', 'address', 'location', 'contact'].includes(t)) scores.store_info += 5;
    if (['hello', 'hey', 'morning', 'evening', 'thanks', 'okay', 'yes', 'no'].includes(t)) scores.greeting += 4;
    if (['price', 'cost', 'rate', 'stock'].includes(t)) scores.product_search += 4;
  });

  // Bi-Gram Scoring (Contextual understanding)
  bigrams.forEach(bg => {
    if (['last order', 'my order', 'order details'].includes(bg)) scores.order_history += 10;
    if (['store name', 'who are', 'about you'].includes(bg)) scores.store_info += 10;
    if (['how much', 'do you'].includes(bg)) scores.product_search += 5;
  });

  // Determine top intent
  for (const [intent, score] of Object.entries(scores)) {
    if (score > analysis.score) {
      analysis.score = score;
      analysis.intent = intent;
    }
  }

  // Fallback to greeting if utterance is extremely short and has low confidence
  if (analysis.score < 5 && tokens.length <= 2) {
    if (['ok', 'okay', 'thanks', 'yes', 'no', 'cool'].includes(tokens[0])) analysis.intent = 'greeting';
  }

  return analysis;
};

// 5. Intelligent Product Extractor (Finds the actual entity)
const findBestProductMatch = (products, searchTokens) => {
  let bestMatch = { product: null, score: 0, isFuzzy: false };
  const searchString = searchTokens.join(' ');

  products.forEach(product => {
    const prodString = product.name.toLowerCase();
    const prodTokens = prodString.split(' ');
    let currentScore = 0;

    // Exact Substring Match (Highest Priority)
    if (searchString.includes(prodString) || prodString.includes(searchString)) {
      currentScore = 100;
    } else {
      // Deep Fuzzy Evaluation per token
      searchTokens.forEach(searchWord => {
        prodTokens.forEach(prodWord => {
          const similarity = getSimilarity(searchWord, prodWord);
          if (similarity === 1) currentScore += 20; // Exact word
          else if (similarity > 0.8) currentScore += 10; // Very close typo (e.g. Sprite -> Sptite)
          else if (similarity > 0.6) currentScore += 5; // Loose typo
        });
      });
    }

    if (currentScore > bestMatch.score) {
      bestMatch.score = currentScore;
      bestMatch.product = product;
      bestMatch.isFuzzy = currentScore < 100 && currentScore > 10; // It was a typo correction
    }
  });

  return bestMatch;
};

// ============================================================
// ELABORATED CONCIERGE RESPONSES
// ============================================================
const generateElaboratedResponse = async (analysis, user) => {
  
  // 1. Extreme Empathy Matrix
  if (analysis.intent === 'escalate' || analysis.isFrustrated) {
    return { 
      type: 'escalate', 
      reason: analysis.isFrustrated ? 'System detected high customer frustration.' : 'Customer explicitly requested support/refund.',
      reply: "I am genuinely sorry you are facing this issue, and I completely understand your frustration. Resolving this is our top priority. I am alerting the store owner immediately so they can look into your account and fix this for you. Please hold on just a moment while they join the chat." 
    };
  }

  // 2. Warm Greetings
  if (analysis.intent === 'greeting') {
    return { type: 'answer', reply: "Hello there! 👋 Welcome to **Lakshmi Stores**. I am your personal digital concierge. Whether you need to check if your favorite snacks are in stock, track your recent order, or check our store hours, I am here to help. What can I do for you today?" };
  }

  // 3. Brand Identity
  if (analysis.intent === 'store_info') {
    return { type: 'answer', reply: "You are chatting with the assistant for **Lakshmi Stores**! We pride ourselves on being your fastest, most reliable local grocery and daily essentials counter. We prepare all orders for express pickup so you can skip the line entirely." };
  }

  // 4. Order Tracking (High Detail)
  if (analysis.intent === 'order_status') {
    if (!user) return { type: 'answer', reply: 'I would love to give you an update on your order! However, for your privacy and security, I need you to log in to your account first so I can retrieve your specific details.' };
    const order = await Order.findOne({ where: { userId: String(user.id) }, order: [['createdAt', 'DESC']] });
    if (!order) return { type: 'answer', reply: 'I just thoroughly checked our system, but it looks like you haven\'t placed any recent orders with us yet. When you are ready, browse the catalog and place an order!' };
    
    const token = order.orderToken !== 'WAIT' ? order.orderToken : order.cashfreeOrderId.slice(-4);
    const statusFormatted = order.orderStatus.replace('_', ' ').toUpperCase();
    return { type: 'answer', reply: `I found your order! Your latest order **#${token}** is currently marked as: **${statusFormatted}**.\n\nThe total bill comes to **₹${order.orderAmount}**. If you need to know exactly what items are inside this order, just ask me for the "order details", or if something is wrong, type "manager".` };
  }

  // 5. Order History (Itemized)
  if (analysis.intent === 'order_history') {
    if (!user) return { type: 'answer', reply: 'I can certainly pull up your receipt, but please log in first so I can securely access your account history.' };
    const order = await Order.findOne({ where: { userId: String(user.id) }, order: [['createdAt', 'DESC']], include: [{ model: OrderItem, as: 'items' }] });
    if (!order) return { type: 'answer', reply: 'I checked your history, but there are no past orders to display.' };
    
    const token = order.orderToken !== 'WAIT' ? order.orderToken : order.cashfreeOrderId.slice(-4);
    const itemString = order.items.map(item => `• ${item.quantity}x ${item.name}`).join('\n');

    return { type: 'answer', reply: `Here is the detailed receipt for your most recent order (**#${token}**):\n\n**Items Packed:**\n${itemString}\n\n**Grand Total:** ₹${order.orderAmount}\n\nIf you need to return any of these items or report an issue, please let me know and I will immediately connect you with the store owner.` };
  }

  // 6. Store Operations
  if (analysis.intent === 'store_status') {
    const store = await StoreSetting.findByPk(1);
    if (!store || !store.isOpen) return { type: 'answer', reply: 'Currently, the shutter is down and **we are closed** for the time being. We will resume accepting express pickup orders as soon as the store team opens the counter. We hope to serve you soon!' };
    if (store.closingWarningActive) return { type: 'answer', reply: `We are currently **Open**, but please hurry—the store team has activated the closing warning! Normal operating hours end at **${STORE_CLOSE_TIME}**. If you need anything for tonight, please finalize your cart immediately.` };
    return { type: 'answer', reply: `Good news! We are currently **Open** and accepting orders. Once you place your order online, our team usually has it perfectly packed and ready for pickup within **${PICKUP_READY_MINUTES} minutes**.` };
  }

  // 7. Advanced Product Concierge
  if (analysis.extractedTokens.length > 0) {
    const products = await Product.findAll({ where: { isActive: true } });
    const { product, score, isFuzzy } = findBestProductMatch(products, analysis.extractedTokens);

    if (product && score >= 15) {
      const safeStock = Math.max(0, (product.real_stock || 0) - (product.buffer ?? 2));
      const unit = product.isSoldByWeight ? 'KG' : 'piece';
      
      let prefix = isFuzzy ? `I believe you are looking for **${product.name}**! ` : `I checked our shelves for **${product.name}**. `;

      if (safeStock > 5) {
        return { type: 'answer', reply: `${prefix}We are fully stocked with roughly **${safeStock} available** right now. The current price is **₹${product.price} per ${unit}**. You can add it to your cart directly from the store page!` };
      } else if (safeStock > 0) {
        return { type: 'answer', reply: `${prefix}We do have it, but you should hurry! We only have about **${safeStock} left in stock**. It is priced at **₹${product.price} per ${unit}**.` };
      } else {
        return { type: 'answer', reply: `${prefix}We usually carry this, but unfortunately, we are completely **Out of Stock** right now. ${product.restockEta ? `We expect our next delivery: **${product.restockEta}**.` : 'I have noted your interest so the store manager knows to order more!'}` };
      }
    }

    // Intelligent Fallback (Garbage Filtered)
    const candidate = analysis.extractedTokens.slice(0, 3).join(' ');
    if (candidate.length > 2) {
      await ItemRequest.findOrCreate({ where: { itemName: candidate }, defaults: { requestCount: 1 } });
      return { type: 'answer', reply: `I scoured our live catalog, but unfortunately, we don't currently sell **"${candidate}"**. However, I have automatically logged this as a formal request to the store manager. If enough people ask for it, we will start stocking it!` };
    }
  }

  // 8. Absolute Fallback
  return { type: 'answer', reply: "I want to make sure I give you the most accurate information, but I didn't quite catch that. Could you try rephrasing? You can ask me to check the price of specific groceries, track your orders, or check our store timings." };
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
  await Notification.create({ userId: 'GLOBAL', title: 'Customer Needs Assistance', message: `${thread.customerName || 'Customer'}: ${String(customerMessage).slice(0, 100)}...`, isRead: false });
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

    // 🚨 RUN THE V4 ULTIMATE NLP ENGINE
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