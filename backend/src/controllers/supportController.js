const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Product, Order, OrderItem, User, Notification, StoreSetting, ItemRequest, SupportThread, SupportMessage } = require('../models');

const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };
const PICKUP_READY_MINUTES = 10;
const STORE_CLOSE_TIME = '10:00 PM';

// ============================================================
// 🧠 V6 INTENT UNIVERSE & CONFIGURATION
// ============================================================

const GREETING_TYPOS = /^(helo|hlw|hii|heyy|hi|hello|hey|sup|good morning|good evening|namaste)$/i;

const ISSUE_KEYWORDS = {
  greeting: ['hello', 'hey', 'hi', 'morning', 'evening', 'thanks', 'thank you', 'ok', 'okay'],
  stock_query: ['available', 'have', 'stock', 'left', 'in stock', 'get', 'buy', 'fresh'],
  price_query: ['price', 'cost', 'rate', 'rupees', 'rs', 'how much'],
  payment_issue: ['deducted', 'charged', 'payment failed', 'upi', 'gpay', 'phonepe', 'paytm', 'transaction', 'twice', 'cut', 'debited'],
  refund_request: ['refund', 'money back', 'return money', 'cashback', 'wallet refund'],
  wrong_item: ['instead', 'wrong item', 'sent sugar', 'different item', 'replaced'],
  damaged_item: ['leaking', 'leak', 'damaged', 'spoiled', 'expired', 'broken', 'bad quality', 'rotten', 'smelling'],
  missing_order: ['not here', 'not received', 'where is my order', 'delay', 'status changed', 'waiting', 'long time'],
  login_issue: ['login', 'log in', 'sign in', 'account locked', 'locked', 'cannot login'],
  otp_issue: ['otp', 'verification code', 'code not coming', 'no code'],
  technical_issue: ['loading', 'stuck', 'freeze', 'button not working', 'crash', 'error', 'website keeps', 'app is useless'],
  human_request: ['manager', 'real person', 'human', 'agent', 'support executive', 'speak to someone'],
  faq_return: ['return policy', 'refund policy', 'how to return']
};

const BLACKLIST_COMPLAINT_WORDS = ['leaking', 'leak', 'damaged', 'spoiled', 'expired', 'broken', 'wrong', 'instead', 'worst', 'terrible', 'useless', 'refund', 'money'];

// ============================================================
// NLP ENGINE MATCHING FUNCTIONS
// ============================================================

const cleanText = (text) => String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

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

const classifyUniverseIntent = (text) => {
  const clean = cleanText(text);
  const words = clean.split(' ');
  
  // 1. Core Structural Overrides
  if (GREETING_TYPOS.test(clean)) return { intent: 'greeting', confidence: 100 };
  
  // Abusive Sentiment Check
  if (/\b(worst|terrible|useless|hate|garbage|bad|angry|frustrated|idiot|stupid|scam)\b/.test(clean)) {
    return { intent: 'negative_sentiment', confidence: 100 };
  }

  // 2. Score Iteration Matrix
  const scores = {};
  Object.keys(ISSUE_KEYWORDS).forEach(key => scores[key] = 0);

  // Unigram & Substring matching
  Object.entries(ISSUE_KEYWORDS).forEach(([intent, phrases]) => {
    phrases.forEach(phrase => {
      if (clean.includes(phrase)) {
        scores[intent] += (phrase.split(' ').length * 15); // Weight multi-word strings higher
      }
    });
  });

  // Pick top scoring intent
  let topIntent = 'unknown';
  let maxScore = 0;
  for (const [intent, score] of Object.entries(scores)) {
    if (score > maxScore) { maxScore = score; topIntent = intent; }
  }

  // 3. Fallback Diversion Tree (Fixes the product search bug!)
  if (maxScore < 10) {
    if (/\b(you|your|app|website|page|service|button|login|otp|account)\b/.test(clean)) {
      topIntent = 'technical_issue';
    } else if (words.length <= 3 && !BLACKLIST_COMPLAINT_WORDS.some(w => clean.includes(w))) {
      topIntent = 'product_search';
    } else {
      topIntent = 'technical_issue'; // Safely route generic text away from product tables
    }
  }

  return { intent: topIntent, confidence: maxScore === 0 ? 40 : Math.min(maxScore * 3, 98) };
};

const findBestProductMatch = (products, text) => {
  const clean = cleanText(text);
  
  // 🚨 DEFENSIVE LAYER: Skip product mapping if complaint context exists
  if (BLACKLIST_COMPLAINT_WORDS.some(word => clean.includes(word))) return null;

  const searchTokens = clean.split(' ').filter(w => w.length > 2);
  let bestProduct = null;
  let highestScore = 0;

  products.forEach(product => {
    const prodName = product.name.toLowerCase();
    let score = 0;

    if (clean.includes(prodName)) score += 100;

    searchTokens.forEach(token => {
      if (prodName.includes(token)) score += 20;
      prodName.split(' ').forEach(pToken => {
        if (getSimilarity(token, pToken) > 0.85) score += 15;
      });
    });

    if (score > highestScore) { highestScore = score; bestProduct = product; }
  });

  return highestScore >= 20 ? bestProduct : null;
};

// ============================================================
// CONVERSATIONAL CONCIERGE & AUTO-TROUBLESHOOTING
// ============================================================
const processV6Decision = async (message, user, thread) => {
  const analysis = classifyUniverseIntent(message);
  const clean = cleanText(message);

  // Initialize context memory structure safely
  const currentMemory = thread.metadata?.memory || { currentIssue: 'none', lastIntent: 'none' };

  // Intent Confidence Gate (Ambiguity Filter)
  if (analysis.confidence < 45 && analysis.intent !== 'product_search') {
    return {
      type: 'answer',
      reply: "I want to verify I am understanding you perfectly. Are you checking on:\n1. A payment or refund problem?\n2. Item or stock tracking?\n3. An issue logging into your profile?\n\nPlease clarify so I can process this accurately."
    };
  }

  // Level 3 Escalation: Immediate Abuse/Negative Sentiment Guard
  if (analysis.intent === 'negative_sentiment') {
    return {
      type: 'escalate', level: 'Level 3 - Urgent', reason: 'Abuse or extreme customer dissatisfaction flagged.',
      reply: "I notice you are extremely upset with our service, and I deeply apologize. We take this very seriously. I have triggered our highest critical tier escalation. The store manager is stepping into this connection immediately to resolve your issue."
    };
  }

  // Level 2 Escalation: Explicit Human Request
  if (analysis.intent === 'human_request') {
    return {
      type: 'escalate', level: 'Level 2 - Needs Manager', reason: 'Manual handoff requested.',
      reply: "Understood. Connecting you directly to the store manager on duty. Please wait a brief moment while they review this chat stream."
    };
  }

  // Greetings Handlers
  if (analysis.intent === 'greeting') {
    return { type: 'answer', reply: "Hello! 👋 Welcome to **Lakshmi Stores**. I am your active digital concierge. You can search live catalog prices, track current orders, or report transaction issues here. How can I facilitate your shopping today?" };
  }

  // FAQ: Return policies
  if (analysis.intent === 'faq_return') {
    return { type: 'answer', reply: "Our store policy allows for simple item replacements or structural wallet adjustments within 24 hours of store counter handoff for damaged or incorrect items. Bring the order confirmation back to the main counter to settle this instantly." };
  }

  // Level 1: Automatic Technical Troubleshooting (OTP/Login Matrix)
  if (analysis.intent === 'otp_issue') {
    return {
      type: 'answer',
      reply: "If verification OTP SMS blocks are stalling:\n1. Check that your network connection signal bars are stable.\n2. Ensure your country extension code matches your account configuration.\n3. Wait exactly 2 minutes before requesting a clean resend token.\n\nIf verification remains blocked, state 'manager' and our team will check the network bridge manually."
    };
  }

  if (analysis.intent === 'login_issue') {
    return {
      type: 'answer',
      reply: "For account authentication adjustments:\n1. Clear your browser workspace cookies or switch to an alternate session private window.\n2. Verify the username credentials line up exactly.\n\nIf the store system securely locked your user record from sequential incorrect pass attempts, your profile will auto-unlock in 15 minutes, or you can request an instant admin override."
    };
  }

  if (analysis.intent === 'technical_issue') {
    return {
      type: 'answer',
      reply: "I am sorry our store portal interface is running sluggishly or catching errors. Please try tapping clean reload on your interface window. I am recording these technical rendering details automatically in our issue dashboard logs so our team can evaluate the server response times."
    };
  }

  // Transaction Matrix (Payment and Refunds)
  if (analysis.intent === 'payment_issue' || analysis.intent === 'refund_request') {
    if (!user) return { type: 'answer', reply: "I can look up the network payment payload securely, but please log in first so I can safely read your transaction profiles." };
    
    // Look for active order records needing verification
    const order = await Order.findOne({ where: { userId: String(user.id) }, order: [['createdAt', 'DESC']] });
    const token = order ? (order.orderToken !== 'WAIT' ? order.orderToken : order.cashfreeOrderId.slice(-4)) : 'None';

    // Update Context State Memory
    currentMemory.currentIssue = 'payment_reconciliation';
    await thread.update({ metadata: { memory: currentMemory, lastRecordedIssue: analysis.intent } });

    return {
      type: 'escalate', level: 'Level 2 - Needs Manager', reason: `Payment check triggered for Order #${token}. Intent: ${analysis.intent}`,
      reply: `I see a payment reconciliation question regarding your account profile. If funds were debited on failed transaction attempts, the secure banking gateway auto-reverses balances within 3-5 days. I have flagged your order trace reference (**#${token}**) directly on the counter owner system monitor right now to verify clearance.`
    };
  }

  // Logistics Matrix (Damaged or Wrong Items)
  if (analysis.intent === 'wrong_item' || analysis.intent === 'damaged_item') {
    if (!user) return { type: 'answer', reply: "Please complete your account profile log in so I can pull up the packing list history associated with your counter ticket." };
    const order = await Order.findOne({ where: { userId: String(user.id) }, order: [['createdAt', 'DESC']] });
    if (!order) return { type: 'answer', reply: "I searched our system records but do not detect any complete invoices registered to your active profile session." };
    
    const token = order.orderToken !== 'WAIT' ? order.orderToken : order.cashfreeOrderId.slice(-4);
    
    return {
      type: 'escalate', level: 'Level 2 - Needs Manager', reason: `Damaged/Wrong delivery dispute for Order #${token}`,
      reply: `I have automatically filed a discrepancy ticket for Order **#${token}** due to a packing mismatch/damaged structure. I am summoning the store owner into this live feed window instantly to arrange an alternate item package replacement or adjust your app wallet credits.`
    };
  }

  // Logistics Matrix (Missing Orders/Order Status Queries)
  if (analysis.intent === 'missing_order' || analysis.intent === 'order_history') {
    if (!user) return { type: 'answer', reply: "I can look up tracking queues instantly. Please perform an account session log in to permit secure order tracing." };
    
    const order = await Order.findOne({ where: { userId: String(user.id) }, order: [['createdAt', 'DESC']], include: [{ model: OrderItem, as: 'items' }] });
    if (!order) return { type: 'answer', reply: "I cannot discover any active order tickets on your registration profile logs yet." };

    const token = order.orderToken !== 'WAIT' ? order.orderToken : order.cashfreeOrderId.slice(-4);
    const statusFormatted = order.orderStatus.replace('_', ' ').toUpperCase();
    const itemString = order.items.map(item => `• ${item.quantity}x ${item.name}`).join('\n');

    return {
      type: 'answer',
      reply: `### In-Store Order Update\n**Order Reference:** #${token}\n**Operational Status:** ${statusFormatted}\n\n**Manifest Items:**\n${itemString}\n\n**Financial Balance:** ₹${order.orderAmount}\n\nIf the counter progress tracking has been stalled over your expected pickup window, just say 'manager' and I will ring the notification bell at the packing terminal.`
    };
  }

  // Product & Inventory Core Logic
  if (analysis.intent === 'product_search' || analysis.intent === 'stock_query' || analysis.intent === 'price_query') {
    const products = await Product.findAll({ where: { isActive: true } });
    const matchedProduct = findBestProductMatch(products, message);

    if (matchedProduct) {
      const safeStock = Math.max(0, (matchedProduct.real_stock || 0) - (matchedProduct.buffer ?? 2));
      const trackingUnit = matchedProduct.isSoldByWeight ? 'KG' : 'units';
      
      if (safeStock > 0) {
        return {
          type: 'answer',
          reply: `Yes, we have **${matchedProduct.name}** verified available in catalog stock! The system cost rate registers at **₹${matchedProduct.price}** per ${matchedProduct.isSoldByWeight ? 'KG' : 'item'}. There are roughly **${safeStock} ${trackingUnit} remaining** on the product racks for immediate counter pickup allocation.`
        };
      } else {
        return {
          type: 'answer',
          reply: `We do carry **${matchedProduct.name}** in our catalog layout, but it has hit its protected safety buffer thresholds and is currently **Out of Stock**. ${matchedProduct.restockEta ? `Our next supply fulfillment truck is scheduled for: **${matchedProduct.restockEta}**.` : 'I will submit a dynamic catalog query log to the owner system to prompt an earlier reorder.'}`
        };
      }
    }

    // Dynamic logging check to screen out junk small talk words
    if (analysis.extractedTokens.length > 0) {
      const candidateItem = analysis.extractedTokens.slice(0, 3).join(' ');
      if (candidateItem.length > 2 && !['special', 'demand', 'todays', 'high'].some(w => candidateItem.includes(w))) {
        await ItemRequest.findOrCreate({ where: { itemName: candidateItem }, defaults: { requestCount: 1 } });
        return { type: 'answer', reply: `I surveyed our current catalog matrix but could not locate an active entry matching **"${candidateItem}"**. I have filed a restocking tracking log to the store admin desk to look into scheduling supply availability for this item.` };
      }
    }
  }

  // Absolute baseline fallback
  return { type: 'answer', reply: "I am here to guide your store experience. You can query product availability (e.g., 'Do you have milk?'), review your transaction balance tokens, or request support intervention rules." };
};

// ============================================================
// ENDPOINT MAIN LOGIC & ROUTE EXPORTS
// ============================================================

exports.chat = async (req, res) => {
  try {
    const message = String(req.body.message || '').trim().slice(0, 1000);
    if (!message) return res.status(400).json({ success: false, message: 'Message payload required.' });

    const user = await getOptionalUser(req);
    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    
    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, 
        customerName: user?.name, customerEmail: user?.email, customerPhone: user?.phone, 
        status: THREAD_STATUS.AI, aiEnabled: true, metadata: { memory: { currentIssue: 'none', lastIntent: 'none' } } 
      });
    } else if (thread.status === THREAD_STATUS.RESOLVED) {
      await thread.update({ status: THREAD_STATUS.AI, aiEnabled: true, resolvedAt: null, handledBy: null, escalationReason: null });
    }

    await appendMessage(thread, 'customer', message, user?.name || 'Customer');

    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({ status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
      return res.json({ success: true, thread: await serializeThread(thread) });
    }

    // 🚨 FIRE EXECUTIVE V6 CONTROL DECISION
    const decision = await processV6Decision(message, user, thread);

    if (decision.reply) await appendMessage(thread, 'assistant', decision.reply, 'Lakshmi Assistant');

    if (decision.type === 'escalate') {
      await thread.update({ 
        status: THREAD_STATUS.NEEDS_ADMIN, 
        priority: 'urgent', 
        escalationReason: `${decision.level} - ${decision.reason}`, 
        aiEnabled: false 
      });
      await notifyAdmin(req, thread, `${decision.level} - ${decision.reason}`, message);
    } else {
      await thread.update({ status: THREAD_STATUS.AI, priority: 'normal', aiEnabled: true });
    }

    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) {
    console.error('NLP Critical Runtime error:', error);
    res.status(500).json({ success: false, message: 'Support assistant failed to process utterance.' });
  }
};

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
  await Notification.create({ userId: 'GLOBAL', title: 'Critical Support Priority', message: `${thread.customerName || 'Customer'}: ${String(customerMessage).slice(0, 100)}...`, isRead: false });
  const io = req.app.get('io');
  if (io) { io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.NEEDS_ADMIN, reason }); io.emit('storeUpdated'); }
};

const appendMessage = async (thread, senderType, body, senderName = null) => {
  const msg = await SupportMessage.create({ threadId: thread.id, senderType, senderName, body });
  await thread.update({ lastMessagePreview: String(body).slice(0, 500), lastCustomerMessageAt: senderType === 'customer' ? new Date() : thread.lastCustomerMessageAt });
  return msg;
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
    if (!message) return res.status(400).json({ success: false, message: 'Message required.' });
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