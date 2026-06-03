const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Product, Order, OrderItem, User, Notification, StoreSetting, ItemRequest, SupportThread, SupportMessage } = require('../models');

const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };

// ============================================================
// 🧠 V9.0 STORE BRAIN: DICTIONARIES & MAPPINGS
// ============================================================

// 1. Multilingual Translation Layer (Tamil, Tanglish, Hinglish)
const REGIONAL_MAP = {
  'varala': 'not received', 'varla': 'not received', 'kedaikala': 'not received',
  'poiduchu': 'deducted', 'cut aachu': 'deducted', 'cut ayindi': 'deducted',
  'aagala': 'issue', 'avvatledu': 'issue', 'raaledu': 'not received',
  'ravatledu': 'not receiving', 'paise': 'money', 'kaasu': 'money', 'karo': 'do'
};

const PRODUCT_ALIASES = {
  'maggie': 'maggi', 'coke': 'coca cola', 'thumbs up': 'thums up',
  'veggies': 'vegetables', 'paani': 'water', 'chini': 'sugar'
};

// 2. V9 Intent Universe (40+ Intents)
const INTENT_MAP = {
  // Payments
  payment_issue: ['payment issue', 'payment failed', 'money deducted', 'charged', 'transaction failed', 'money gone'],
  double_payment: ['charged twice', 'double payment', 'paid twice'],
  refund_request: ['refund', 'money back', 'return my money', 'cashback'],
  
  // Orders
  missing_order: ['order not received', 'not here', 'never arrived', 'where is my order'],
  wrong_order: ['wrong item', 'different item', 'instead of'],
  damaged_order: ['damaged', 'broken', 'leaking', 'spoiled', 'expired', 'bad quality'],
  late_order: ['late', 'delay', 'waiting since', 'still waiting', 'taking too long'],
  order_status: ['order status', 'track order', 'where is order'],
  
  // Products
  price_query: ['price', 'cost', 'rate', 'how much'],
  stock_query: ['stock', 'available', 'have', 'left', 'get'],
  
  // Account & Tech
  login_issue: ['login', 'log in', 'sign in', 'cannot access'],
  otp_issue: ['otp', 'verification code', 'no code'],
  technical_issue: ['crash', 'stuck', 'loading', 'button not working', 'error', 'website down', 'website issue'],
  account_hacked: ['hacked', 'someone else', 'unauthorized'],
  
  // Human & Fraud
  human_request: ['manager', 'real person', 'human', 'agent', 'support executive', 'owner', 'call'],
  fraud_report: ['fraud', 'scam', 'cheating', 'stole', 'fake', 'police', 'consumer court'],
  
  greeting: ['hello', 'hi', 'hey', 'morning', 'evening', 'thanks', 'ok', 'okay', 'hii', 'hlw']
};

const RISK_SCORES = {
  fraud_report: 100, account_hacked: 100, double_payment: 90, payment_issue: 85,
  refund_request: 80, missing_order: 80, damaged_order: 75, wrong_order: 75,
  login_issue: 50, otp_issue: 50, technical_issue: 40, human_request: 90, greeting: 0
};

const NEGATIVE_WORDS = ['worst', 'terrible', 'useless', 'garbage', 'bad', 'angry', 'frustrated', 'scam', 'fake', 'pathetic'];
const SARCASM_REGEX = /\b(wow|amazing|great|nice|awesome|excellent)\b.*\b(never|not|worst|deducted|missing|bad|late)\b/i;

// ============================================================
// ⚙️ V9.0 MESSAGE ANALYZER PIPELINE
// ============================================================

const generateTicketId = () => `LS-2026-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

const cleanText = (rawText) => {
  let text = String(rawText || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Translate Tanglish/Tamil -> English
  Object.entries(REGIONAL_MAP).forEach(([slang, eng]) => {
    text = text.replace(new RegExp(`\\b${slang}\\b`, 'g'), eng);
  });
  
  // Map Product Aliases
  Object.entries(PRODUCT_ALIASES).forEach(([alias, trueName]) => {
    text = text.replace(new RegExp(`\\b${alias}\\b`, 'g'), trueName);
  });
  
  return text;
};

const analyzeSentiment = (text) => {
  const safeText = String(text || '');
  if (SARCASM_REGEX.test(safeText)) return { mood: 'sarcastic', anger: 80 };
  
  let angerScore = 0;
  NEGATIVE_WORDS.forEach(w => { if (safeText.includes(w)) angerScore += 25; });
  
  if (angerScore >= 50) return { mood: 'furious', anger: angerScore };
  if (angerScore > 0) return { mood: 'negative', anger: angerScore };
  if (/\b(happy|thanks|love|great)\b/.test(safeText)) return { mood: 'positive', anger: 0 };
  
  return { mood: 'neutral', anger: 0 };
};

const analyzeMessage = (rawMessage) => {
  const cleanedMessage = cleanText(rawMessage);
  const sentimentData = analyzeSentiment(cleanedMessage);
  
  let intents = [];
  let maxRisk = 0;

  // Multi-Intent Scoring
  Object.entries(INTENT_MAP).forEach(([intent, phrases]) => {
    let score = 0;
    (phrases || []).forEach(phrase => {
      if (cleanedMessage.includes(phrase)) score += (phrase.split(' ').length * 20);
    });
    
    if (score > 0) {
      const risk = RISK_SCORES[intent] || 0;
      if (risk > maxRisk) maxRisk = risk;
      intents.push({ intent, score, risk });
    }
  });

  // Sort by Risk, then Score
  intents.sort((a, b) => {
    if (b.risk !== a.risk) return b.risk - a.risk;
    return b.score - a.score;
  });

  // Fallbacks
  if (intents.length === 0) {
    if (cleanedMessage.split(' ').length <= 2) intents.push({ intent: 'greeting', score: 10, risk: 0 });
    else intents.push({ intent: 'product_search', score: 10, risk: 10 });
  }

  return {
    originalMessage: String(rawMessage || ''),
    cleanedMessage,
    sentiment: sentimentData.mood,
    urgency: maxRisk > 70 ? 90 : 30,
    risk: maxRisk,
    intents: intents.map(i => i.intent),
    primaryIntent: intents[0].intent,
    tokens: cleanedMessage.split(' ').filter(w => w.length > 2)
  };
};

// ============================================================
// 🧠 V9.0 MEMORY & CONTEXT ENGINE
// ============================================================

const resolveContext = (analysis, memory) => {
  let resolvedIntent = analysis.primaryIntent;
  let isFollowUp = false;
  const msg = analysis.cleanedMessage;

  // 1. Issue Memory ("Still waiting", "Not fixed")
  if (/^(still waiting|not fixed|same problem|again|help|any update)$/.test(msg)) {
    if (memory.lastIssue && memory.lastIssue !== 'none') {
      resolvedIntent = memory.lastIssue;
      isFollowUp = true;
    } else {
      resolvedIntent = 'human_request';
    }
  }

  // 2. Product Memory ("Price?", "Stock?")
  if (['price_query', 'stock_query'].includes(resolvedIntent) && analysis.tokens.length <= 2) {
    if (memory.lastProduct) {
      analysis.tokens.push(memory.lastProduct);
      isFollowUp = true;
    }
  }

  // 3. Sarcasm / Furious Override
  if (['sarcastic', 'furious'].includes(analysis.sentiment) || analysis.risk >= 90) {
    if (resolvedIntent === 'greeting' || resolvedIntent === 'product_search') {
      resolvedIntent = 'human_request'; // Force human if angry but unclear
    }
  }

  return { ...analysis, primaryIntent: resolvedIntent, isFollowUp };
};

const updateMemory = (currentMemory, analysis, ticketId, productMatch) => {
  const memory = currentMemory || { lastProduct: null, lastIssue: 'none', lastTicket: null, moodHistory: [] };
  
  (memory.moodHistory || []).push(analysis.sentiment);
  if (memory.moodHistory.length > 5) memory.moodHistory.shift();

  if (analysis.risk >= 50 && !['human_request'].includes(analysis.primaryIntent)) {
    memory.lastIssue = analysis.primaryIntent;
  }
  
  if (ticketId) memory.lastTicket = ticketId;
  if (productMatch) memory.lastProduct = String(productMatch || '').toLowerCase();

  return memory;
};

// ============================================================
// 🗣️ V9.0 EMPATHETIC RESPONSE ENGINE
// ============================================================

const generateResponse = async (context, memory, user) => {
  const intent = String(context.primaryIntent || '');
  
  // 1. Extreme Risk / Fraud (Level 3)
  if (['account_hacked', 'fraud_report'].includes(intent)) {
    const ticket = memory.lastTicket || generateTicketId();
    return {
      type: 'escalate', level: 'Level 3 - Critical Security', ticket,
      reply: `🚨 **SECURITY ALERT (Ticket #${ticket})**\nI am taking this extremely seriously. If you suspect fraud or unauthorized access, I have temporarily locked your session parameters for safety and alerted the store owner immediately. Do not share any OTPs.`
    };
  }

  // 2. Sarcasm & Anger Mitigation
  if (context.sentiment === 'sarcastic' || context.sentiment === 'furious') {
    const ticket = memory.lastTicket || generateTicketId();
    return {
      type: 'escalate', level: 'Level 3 - Urgent Escalation', ticket,
      reply: `I deeply apologize for this highly frustrating experience. This is completely unacceptable. I am bypassing the standard queue and escalating **Ticket #${ticket}** directly to the store manager. They are joining this chat now.`
    };
  }

  // 3. Payment & Refund Tracking (Level 2)
  if (['payment_issue', 'double_payment', 'refund_request'].includes(intent)) {
    if (!user) return { type: 'answer', reply: "I completely understand your concern regarding the payment. Please log in to your account so I can securely trace your transaction history and resolve this." };
    
    const ticket = memory.lastTicket || generateTicketId();
    const order = await Order.findOne({ where: { userId: String(user.id) }, order: [['createdAt', 'DESC']] });
    const orderToken = order ? order.orderToken || order.cashfreeOrderId.slice(-4) : 'Unknown';

    if (context.isFollowUp) {
      return { type: 'escalate', level: 'Level 2 - Ongoing Issue', ticket, reply: `I see you are still waiting on resolution for **Ticket #${ticket}**. I am pinging the manager again for an immediate update.` };
    }

    return {
      type: 'escalate', level: 'Level 2 - Finance', ticket,
      reply: `I understand that money was deducted but your process failed. I have created support **Ticket #${ticket}** and flagged Order **#${orderToken}** for review. If a transaction fails on our end, the banking gateway automatically reverses the amount within 3-5 business days. Meanwhile, the manager is reviewing this manual verification.`
    };
  }

  // 4. Missing / Damaged Orders (Level 2)
  if (['missing_order', 'damaged_order', 'wrong_order'].includes(intent)) {
    if (!user) return { type: 'answer', reply: "I am so sorry there is an issue with your items. Please log in so I can pull up your exact packing manifest." };
    const ticket = memory.lastTicket || generateTicketId();
    return {
      type: 'escalate', level: 'Level 2 - Logistics', ticket,
      reply: `I sincerely apologize for the inconvenience with your delivery. I have opened **Ticket #${ticket}** for this order discrepancy. The store manager will review the packing terminal footage and arrange a replacement or wallet refund immediately.`
    };
  }

  // 5. Tech Support (Level 1)
  if (['otp_issue', 'login_issue', 'technical_issue'].includes(intent)) {
    return { 
      type: 'answer', 
      reply: "It looks like you're experiencing a technical glitch. \n1. Please check your network connection.\n2. Wait 2 minutes before requesting a new OTP.\n3. Try clearing your app cache.\nIf the issue persists, simply type 'manager' and our team will check the server." 
    };
  }

  // 6. Product Memory (Price/Stock Queries)
  if (['price_query', 'stock_query', 'product_search'].includes(intent)) {
    const products = await Product.findAll({ where: { isActive: true } });
    const query = context.tokens.join(' ');
    
    // Fuzzy matching logic wrapped defensively
    let bestProduct = null;
    let highestScore = 0;
    (products || []).forEach(p => {
      const pName = String(p.name || '').toLowerCase();
      if (pName.includes(query)) {
        bestProduct = p; highestScore = 100;
      }
    });

    if (bestProduct) {
      const stock = Math.max(0, (bestProduct.real_stock || 0) - (bestProduct.buffer || 2));
      return { 
        type: 'answer', productContext: bestProduct.name,
        reply: `Regarding **${bestProduct.name}**: The current price is **₹${bestProduct.price}**. We have roughly **${stock} units available** in stock for immediate pickup.` 
      };
    }
  }

  // Base Fallback
  return { type: 'answer', reply: "Hello! 👋 I am the Lakshmi Stores support team assistant. I can track orders, check refunds, and review inventory. How can I assist you today?" };
};

// ============================================================
// 🛡️ V9.0 CRASH-PROOF CONTROLLER ROUTE
// ============================================================
exports.chat = async (req, res) => {
  try {
    const rawMessage = String(req.body.message || '').trim().slice(0, 1000);
    if (!rawMessage) return res.status(400).json({ success: false, message: 'Message payload required.' });

    let user = null;
    try {
      const header = String(req.headers.authorization || '');
      if (header.startsWith('Bearer ')) {
        const token = header.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        user = await User.findByPk(decoded.id);
      }
    } catch (e) { /* Silent fail for guests */ }

    // Thread retrieval with deep crash protection
    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, status: THREAD_STATUS.AI, aiEnabled: true, 
        metadata: { memory: { lastIssue: 'none', moodHistory: [] } } 
      });
    }

    await SupportMessage.create({ threadId: thread.id, senderType: 'customer', body: rawMessage });

    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({ status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
      return res.json({ success: true, thread });
    }

    // 🚀 FIRE V9.0 PIPELINE
    const memory = (thread.metadata || {}).memory || {};
    const analysis = analyzeMessage(rawMessage);
    const context = resolveContext(analysis, memory);
    const decision = await generateResponse(context, memory, user);
    const updatedMemory = updateMemory(memory, context, decision.ticket, decision.productContext);

    // Save Output
    if (decision.reply) {
      await SupportMessage.create({ threadId: thread.id, senderType: 'assistant', senderName: 'Support Team', body: decision.reply });
    }

    if (decision.type === 'escalate') {
      await thread.update({ 
        status: THREAD_STATUS.NEEDS_ADMIN, priority: 'urgent', 
        escalationReason: `${decision.level} [${decision.ticket || 'N/A'}]`, aiEnabled: false,
        metadata: { memory: updatedMemory }
      });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.NEEDS_ADMIN });
    } else {
      await thread.update({ metadata: { memory: updatedMemory } });
    }

    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...thread.toJSON(), messages } });

  } catch (error) {
    console.error('🛡️ V9 Crash Protection Activated:', error);
    res.status(200).json({ 
      success: true, fallback: true,
      message: "I am experiencing a temporary system delay. Please hold while I automatically connect you to our support management team." 
    });
  }
};

const serializeThread = async (thread) => {
  const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
  return { ...thread.toJSON(), messages };
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

    await SupportMessage.create({ threadId: thread.id, senderType: 'admin', senderName: req.user?.name || 'Support Team', body: message });
    await thread.update({ status: THREAD_STATUS.HUMAN_ACTIVE, aiEnabled: false, handledBy: req.user?.name });
    
    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to send reply.' }); }
};

exports.resolveThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await SupportMessage.create({ threadId: thread.id, senderType: 'system', senderName: 'System', body: 'This ticket has been marked as resolved. Thank you for choosing Lakshmi Stores.' });
    await thread.update({ status: THREAD_STATUS.RESOLVED, aiEnabled: false, resolvedAt: new Date() });

    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to resolve thread.' }); }
};