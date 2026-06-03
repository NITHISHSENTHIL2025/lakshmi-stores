const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Product, Order, OrderItem, User, Notification, StoreSetting, SupportThread, SupportMessage } = require('../models');

const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };
const generateTicketId = () => `LS-2026-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

// ============================================================
// 🧠 V11 ENDGAME: LINGUISTICS & INTENT UNIVERSE
// ============================================================
const REGIONAL_MAP = {
  'manager venum': 'human request', 'order varala': 'missing order', 'parcel varala': 'missing order',
  'varala': 'not received', 'varla': 'not received', 'kedaikala': 'not received',
  'illai': 'not', 'illa': 'not', 'aagala': 'issue', 'agala': 'issue',
  'mudiyala': 'issue', 'theriyala': 'issue', 'venum': 'want',
  'panam pochu': 'money deducted', 'kaasu pochu': 'money deducted', 'cash pochu': 'money deducted',
  'poiduchu': 'deducted', 'cut aachu': 'deducted', 'cut ayindi': 'deducted',
  'avvatledu': 'issue', 'raaledu': 'not received', 'ravatledu': 'not receiving',
  'paise': 'money', 'kaasu': 'money', 'karo': 'do'
};

const PRODUCT_ALIASES = {
  'maggie': 'maggi', 'coke': 'coca cola', 'thumbs up': 'thums up',
  'veggies': 'vegetables', 'paani': 'water', 'chini': 'sugar', 'sprite bottle': 'sprite'
};

const INTENT_MAP = {
  // Finance
  payment_issue: ['payment issue', 'payment failed', 'money deducted', 'charged', 'transaction failed', 'money gone', 'deducted through', 'phonepe', 'gpay', 'paytm'],
  double_payment: ['charged twice', 'double payment', 'paid twice'],
  refund_request: ['refund', 'money back', 'return my money', 'cashback'],
  
  // Logistics
  missing_order: ['order not received', 'not here', 'never arrived', 'where is my order', 'missing order'],
  wrong_order: ['wrong item', 'different item', 'instead of'],
  damaged_order: ['damaged', 'broken', 'leaking', 'spoiled', 'expired', 'bad quality'],
  late_order: ['late', 'delay', 'waiting since', 'taking too long'],
  order_status: ['order status', 'track order', 'where is order'],
  
  // Inventory
  price_query: ['price', 'cost', 'rate', 'how much'],
  stock_query: ['stock', 'available', 'have', 'left', 'get'],
  
  // Platform
  login_issue: ['login', 'log in', 'sign in', 'cannot access'],
  otp_issue: ['otp', 'verification code', 'no code'],
  technical_issue: ['crash', 'stuck', 'loading', 'button not working', 'error', 'website down', 'website issue', 'loading forever'],
  
  // Critical
  account_hacked: ['hacked', 'someone else', 'unauthorized', 'stole account'],
  human_request: ['manager', 'real person', 'human', 'agent', 'support executive', 'owner', 'call'],
  fraud_report: ['fraud', 'scam', 'cheating', 'stole', 'fake', 'stole my money'],
  legal_threat: ['police', 'consumer court', 'lawyer', 'sue you', 'legal action'],
  
  greeting: ['hello', 'hi', 'hey', 'morning', 'evening', 'thanks', 'ok', 'okay', 'hii', 'hlw']
};

const ESCALATION_LEVELS = {
  legal_threat: 4, fraud_report: 3, account_hacked: 3, human_request: 3,
  double_payment: 2, payment_issue: 2, refund_request: 2, missing_order: 2, damaged_order: 2, wrong_order: 2,
  login_issue: 1, otp_issue: 1, technical_issue: 1, greeting: 0, product_search: 0
};

const NEGATIVE_WORDS = ['worst', 'terrible', 'useless', 'garbage', 'bad', 'angry', 'frustrated', 'scam', 'fake', 'pathetic'];
const SARCASM_REGEX = /\b(wow|amazing|great|nice|awesome|excellent)\b.*\b(never|not|worst|deducted|missing|bad|late|nothing)\b/i;

// ============================================================
// ⚙️ V11 PIPELINE: MULTI-INTENT & SENTIMENT
// ============================================================
const cleanText = (rawText) => {
  let text = String(rawText || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  Object.entries(REGIONAL_MAP).forEach(([slang, eng]) => { text = text.replace(new RegExp(`\\b${slang}\\b`, 'g'), eng); });
  Object.entries(PRODUCT_ALIASES).forEach(([alias, trueName]) => { text = text.replace(new RegExp(`\\b${alias}\\b`, 'g'), trueName); });
  return text;
};

const analyzeSentiment = (text) => {
  const safeText = String(text || '');
  if (SARCASM_REGEX.test(safeText)) return { mood: 'sarcastic', anger: 80 };
  let angerScore = 0;
  (NEGATIVE_WORDS || []).forEach(w => { if (safeText.includes(w)) angerScore += 25; });
  if (angerScore >= 50) return { mood: 'furious', anger: angerScore };
  if (angerScore > 0) return { mood: 'negative', anger: angerScore };
  if (/\b(happy|thanks|love|great)\b/.test(safeText)) return { mood: 'positive', anger: 0 };
  return { mood: 'neutral', anger: 0 };
};

const analyzeMessage = async (rawMessage) => {
  const cleanedMessage = cleanText(rawMessage);
  const sentimentData = analyzeSentiment(cleanedMessage);
  let intents = [];
  let maxLevel = 0;

  // Multi-Intent Scoring
  Object.entries(INTENT_MAP).forEach(([intent, phrases]) => {
    let score = 0;
    (phrases || []).forEach(phrase => {
      if (cleanedMessage.includes(phrase)) score += (String(phrase).split(' ').length * 20);
    });
    if (score > 0) {
      const level = ESCALATION_LEVELS[intent] || 0;
      if (level > maxLevel) maxLevel = level;
      intents.push({ intent, score: Math.min(score, 99), level });
    }
  });

  // Strict Greeting Removal
  if (intents.length > 1) {
    intents = (intents || []).filter(i => i.intent !== 'greeting');
  }

  // Sort strictly by Escalation Level, then Score
  (intents || []).sort((a, b) => {
    if (b.level !== a.level) return b.level - a.level;
    return b.score - a.score;
  });

  // Product Detection
  const tokens = cleanedMessage.split(' ').filter(w => w.length > 2);
  let foundProduct = null;
  try {
    const products = await Product.findAll({ where: { isActive: true } });
    (products || []).forEach(p => {
      if (cleanedMessage.includes(String(p.name || '').toLowerCase())) foundProduct = p;
    });
  } catch (e) { /* silent db fail */ }

  if (intents.length === 0) {
    if (foundProduct) intents.push({ intent: 'product_search', score: 80, level: 0 });
    else if (cleanedMessage.split(' ').length <= 2) intents.push({ intent: 'greeting', score: 40, level: 0 });
    else intents.push({ intent: 'technical_issue', score: 30, level: 1 }); 
  }

  return {
    cleanedMessage,
    sentiment: sentimentData.mood,
    baseAnger: sentimentData.anger,
    escalationLevel: maxLevel,
    intents: intents, 
    primaryIntent: (intents[0] || {}).intent || 'unknown',
    tokens,
    detectedProduct: foundProduct
  };
};

// ============================================================
// 🧠 V11 ENDGAME CONTEXT & MEMORY ENGINE
// ============================================================
const resolveContext = (analysis, memory) => {
  let resolvedIntents = [...(analysis.intents || [])];
  let primary = analysis.primaryIntent;
  const msg = analysis.cleanedMessage;

  // 1. Dynamic Frustration Engine
  let frustration = Number(memory.frustrationScore || 0) + Number(analysis.baseAnger || 0);
  if (/(still waiting|hello|bro|any update|not fixed|again|worst service|cleared|problem)/i.test(msg)) {
    frustration += 30;
  }
  
  if (frustration >= 70 || ['sarcastic', 'furious'].includes(analysis.sentiment)) {
    if (!resolvedIntents.find(i => i.intent === 'human_request')) {
      resolvedIntents.unshift({ intent: 'human_request', score: 100, level: 3 });
      primary = 'human_request';
    }
  }

  // 2. Issue Timeline Continuation
  if (/(still|again|help|update|cleared)/i.test(msg) && memory.lastIssue && memory.lastIssue !== 'none') {
    if (!resolvedIntents.find(i => i.intent === memory.lastIssue)) {
      resolvedIntents.push({ intent: memory.lastIssue, score: 80, level: ESCALATION_LEVELS[memory.lastIssue] || 1 });
      primary = memory.lastIssue; // Re-focus on the core issue
    }
  }

  // 3. Product Context Continuation ("Price?", "Stock?")
  if (['price_query', 'stock_query'].includes(primary) && analysis.tokens.length <= 2 && memory.lastProduct) {
    analysis.tokens.push(memory.lastProduct);
  }

  // Re-evaluate Max Level after additions
  let maxLevel = 0;
  (resolvedIntents || []).forEach(i => { if (i.level > maxLevel) maxLevel = i.level; });

  return { ...analysis, intents: resolvedIntents, primaryIntent: primary, escalationLevel: maxLevel, updatedFrustration: frustration };
};

// ============================================================
// 🗣️ V11 STRUCTURED RESPONSE ENGINE (THE MANAGER PERSONA)
// ============================================================
const generateResponse = async (context, memory, user) => {
  const intentList = (context.intents || []).map(i => i.intent);
  const ticket = memory.lastTicket || generateTicketId();

  // 1. Extreme Legal/Fraud Escalations (Level 4 & 3)
  if (context.escalationLevel >= 3) {
    let issuesText = [];
    if (intentList.includes('legal_threat')) issuesText.push('• Formal Legal/Consumer Court Threat');
    if (intentList.includes('fraud_report') || intentList.includes('account_hacked')) issuesText.push('• Critical Security/Fraud Alert');
    if (intentList.includes('human_request')) issuesText.push('• Direct Manager Intervention Required');
    if (intentList.includes('payment_issue') || intentList.includes('double_payment')) issuesText.push('• Financial Discrepancy');
    if (intentList.includes('missing_order')) issuesText.push('• Missing Logistics Manifest');

    return {
      type: 'escalate', level: `Level ${context.escalationLevel} - Critical`, ticket,
      reply: `I have analyzed your request and detected the following severe issues:\n${issuesText.join('\n')}\n\n**Action Taken:**\nI have immediately frozen standard automated processing and created **Ticket #${ticket}**.\n\n**Next Steps:**\nThis chat stream has been escalated directly to the store ownership team for manual override. Please hold.`
    };
  }

  // 2. Multi-Intent & Level 2 Core Logistics
  if (context.escalationLevel === 2) {
    if (!user && (intentList.includes('payment_issue') || intentList.includes('refund_request') || intentList.includes('missing_order'))) {
      return { type: 'answer', reply: "I can process these transaction and logistics errors immediately. Please log in to your profile so I can authenticate your ledger." };
    }

    let issuesText = [];
    if (intentList.includes('payment_issue') || intentList.includes('refund_request')) issuesText.push('• Financial Transaction Anomaly');
    if (intentList.includes('missing_order') || intentList.includes('damaged_order') || intentList.includes('late_order')) issuesText.push('• Order Logistics Discrepancy');
    if (intentList.includes('otp_issue') || intentList.includes('login_issue')) issuesText.push('• Authentication Block');

    return {
      type: 'escalate', level: 'Level 2 - Operations', ticket,
      reply: `I have thoroughly reviewed your message and identified the following:\n${issuesText.join('\n')}\n\n**Action Taken:**\nI have bundled these into **Ticket #${ticket}** and alerted the operations desk.\n\n**Next Steps:**\nA store manager is currently reviewing the payment gateway logs and terminal footage to resolve this for you.`
    };
  }

  // 3. Level 1 Tech & Product Inquiries
  if (['price_query', 'stock_query', 'product_search'].includes(context.primaryIntent)) {
    if (context.detectedProduct) {
      const stock = Math.max(0, (Number(context.detectedProduct.real_stock) || 0) - (Number(context.detectedProduct.buffer) || 2));
      return { 
        type: 'answer', productContext: String(context.detectedProduct.name || ''),
        reply: `**Product Status:**\n• Item: **${context.detectedProduct.name}**\n• Current Price: **₹${context.detectedProduct.price}**\n• Live Availability: **${stock} units** ready for pickup.\n\nLet me know if you need to add this to your cart!` 
      };
    } else if (memory.lastProduct) {
      // Memory Fallback Search
      try {
        const products = await Product.findAll({ where: { isActive: true } });
        let memProduct = null;
        (products || []).forEach(p => {
          if (String(p.name || '').toLowerCase().includes(memory.lastProduct)) memProduct = p;
        });
        if (memProduct) {
          const stock = Math.max(0, (Number(memProduct.real_stock) || 0) - (Number(memProduct.buffer) || 2));
          return { type: 'answer', reply: `Following up on **${memProduct.name}**: The price is **₹${memProduct.price}** and we have **${stock} units** available.` };
        }
      } catch (e) { /* silent */ }
    }
  }

  if (['otp_issue', 'technical_issue'].includes(context.primaryIntent)) {
    return { type: 'answer', reply: "**Diagnostics Detected:**\n• A technical connectivity or OTP routing delay.\n\n**Next Steps:**\nPlease verify your network signal and wait exactly 2 minutes before requesting a new code. If this fails again, type 'manager' and I will force a manual override." };
  }

  // Base
  return { type: 'answer', reply: "Hello! 👋 I am the Lakshmi Stores support manager. I can track complex orders, trace refunds, and review live inventory. How can I assist you today?" };
};

// ============================================================
// 🛡️ V11 CRASH-PROOF EXPRESS ROUTE
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
    } catch (e) { /* Silent fail */ }

    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, status: THREAD_STATUS.AI, aiEnabled: true, 
        metadata: { memory: { lastIssue: 'none', frustrationScore: 0, escalationCount: 0 } } 
      });
    }

    await SupportMessage.create({ threadId: thread.id, senderType: 'customer', body: rawMessage });

    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({ status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
      return res.json({ success: true, thread });
    }

    // 🚀 FIRE V11 ENDGAME PIPELINE
    const memory = (thread.metadata || {}).memory || {};
    if (!Array.isArray(memory.moodHistory)) memory.moodHistory = [];

    const analysis = await analyzeMessage(rawMessage);
    const context = resolveContext(analysis, memory);
    const decision = await generateResponse(context, memory, user);

    // Update V11 Memory State
    const updatedMemory = { ...memory };
    updatedMemory.frustrationScore = context.updatedFrustration;
    updatedMemory.moodHistory.push(context.sentiment);
    if (updatedMemory.moodHistory.length > 5) updatedMemory.moodHistory.shift();

    if (context.escalationLevel > 0 && !['human_request', 'legal_threat'].includes(context.primaryIntent)) {
      updatedMemory.lastIssue = context.primaryIntent;
    }
    
    if (decision.ticket) updatedMemory.lastTicket = decision.ticket;
    if (decision.productContext) updatedMemory.lastProduct = decision.productContext;
    if (decision.type === 'escalate') updatedMemory.escalationCount = (Number(updatedMemory.escalationCount) || 0) + 1;

    if (decision.reply) {
      await SupportMessage.create({ threadId: thread.id, senderType: 'assistant', senderName: 'Support Manager', body: decision.reply });
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
    console.error('🛡️ V11 Crash Protection Activated:', error);
    res.status(200).json({ success: true, fallback: true, message: "System diagnostics running. Connecting you to the store management team." });
  }
};

// ============================================================
// 🛡️ CRASH-PROOF ADMIN ROUTES
// ============================================================
exports.getPublicThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });
    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: (messages || []).map(m => m.dataValues || m) } });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to fetch thread.' }); }
};

exports.getThreads = async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status === 'active') { where.status = { [Op.ne]: 'resolved' }; } 
    else if (status) { where.status = status; }
    
    const threads = await SupportThread.findAll({ where, order: [['updatedAt', 'DESC']], limit: 50 });
    const serialized = [];
    for (const t of (threads || [])) {
       const messages = await SupportMessage.findAll({ where: { threadId: t.id }, order: [['createdAt', 'ASC']] });
       serialized.push({ ...(t.dataValues || t), messages: (messages || []).map(m => m.dataValues || m) });
    }
    return res.json({ success: true, data: serialized });
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
    
    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: (messages || []).map(m => m.dataValues || m) } });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to send reply.' }); }
};

exports.resolveThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await SupportMessage.create({ threadId: thread.id, senderType: 'system', senderName: 'System', body: 'This ticket has been marked as resolved.' });
    await thread.update({ status: THREAD_STATUS.RESOLVED, aiEnabled: false, resolvedAt: new Date() });

    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    
    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: (messages || []).map(m => m.dataValues || m) } });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to resolve thread.' }); }
};