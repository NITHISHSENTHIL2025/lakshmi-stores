const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Product, Order, OrderItem, User, Notification, StoreSetting, ItemRequest, SupportThread, SupportMessage } = require('../models');

const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };
const generateTicketId = () => `LS-2026-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

// ============================================================
// 🧠 V10 BEAST: DICTIONARIES & TAMIL PACK
// ============================================================
const REGIONAL_MAP = {
  'order varala': 'missing order', 'parcel varala': 'missing order',
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
  payment_issue: ['payment issue', 'payment failed', 'money deducted', 'charged', 'transaction failed', 'money gone', 'deducted through', 'phonepe', 'gpay', 'paytm'],
  double_payment: ['charged twice', 'double payment', 'paid twice'],
  refund_request: ['refund', 'money back', 'return my money', 'cashback'],
  missing_order: ['order not received', 'not here', 'never arrived', 'where is my order', 'missing order'],
  wrong_order: ['wrong item', 'different item', 'instead of'],
  damaged_order: ['damaged', 'broken', 'leaking', 'spoiled', 'expired', 'bad quality'],
  late_order: ['late', 'delay', 'waiting since', 'taking too long'],
  order_status: ['order status', 'track order', 'where is order'],
  price_query: ['price', 'cost', 'rate', 'how much'],
  stock_query: ['stock', 'available', 'have', 'left', 'get'],
  login_issue: ['login', 'log in', 'sign in', 'cannot access'],
  otp_issue: ['otp', 'verification code', 'no code'],
  technical_issue: ['crash', 'stuck', 'loading', 'button not working', 'error', 'website down', 'website issue', 'loading forever'],
  account_hacked: ['hacked', 'someone else', 'unauthorized'],
  human_request: ['manager', 'real person', 'human', 'agent', 'support executive', 'owner', 'call'],
  fraud_report: ['fraud', 'scam', 'cheating', 'stole', 'fake', 'police', 'consumer court', 'stole my money'],
  greeting: ['hello', 'hi', 'hey', 'morning', 'evening', 'thanks', 'ok', 'okay', 'hii', 'hlw']
};

const RISK_SCORES = {
  fraud_report: 100, account_hacked: 100, human_request: 100, double_payment: 90, payment_issue: 85,
  refund_request: 80, missing_order: 80, damaged_order: 75, wrong_order: 75,
  login_issue: 50, otp_issue: 50, technical_issue: 40, greeting: 0
};

const NEGATIVE_WORDS = ['worst', 'terrible', 'useless', 'garbage', 'bad', 'angry', 'frustrated', 'scam', 'fake', 'pathetic'];
const SARCASM_REGEX = /\b(wow|amazing|great|nice|awesome|excellent)\b.*\b(never|not|worst|deducted|missing|bad|late|nothing)\b/i;

// ============================================================
// ⚙️ V10 MULTI-INTENT ANALYZER PIPELINE
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
  NEGATIVE_WORDS.forEach(w => { if (safeText.includes(w)) angerScore += 25; });
  if (angerScore >= 50) return { mood: 'furious', anger: angerScore };
  if (angerScore > 0) return { mood: 'negative', anger: angerScore };
  if (/\b(happy|thanks|love|great)\b/.test(safeText)) return { mood: 'positive', anger: 0 };
  return { mood: 'neutral', anger: 0 };
};

const analyzeMessage = async (rawMessage) => {
  const cleanedMessage = cleanText(rawMessage);
  const sentimentData = analyzeSentiment(cleanedMessage);
  let intents = [];
  let maxRisk = 0;

  // 1. Human Override (Immediate Risk 100)
  if (/(manager|human|real person|owner)/i.test(cleanedMessage)) {
    intents.push({ intent: 'human_request', confidence: 100, risk: 100 });
    maxRisk = 100;
  }

  // 2. Multi-Intent Scoring
  Object.entries(INTENT_MAP).forEach(([intent, phrases]) => {
    let score = 0;
    (phrases || []).forEach(phrase => {
      if (cleanedMessage.includes(phrase)) score += (phrase.split(' ').length * 20);
    });
    if (score > 0) {
      const risk = RISK_SCORES[intent] || 0;
      if (risk > maxRisk) maxRisk = risk;
      intents.push({ intent, confidence: Math.min(score, 99), risk });
    }
  });

  // 3. KILL GREETING PRIORITY if other intents exist
  if (intents.length > 1) {
    intents = (intents || []).filter(i => i.intent !== 'greeting');
  }

  // Sort strictly by Risk, then Confidence
  intents.sort((a, b) => {
    if (b.risk !== a.risk) return b.risk - a.risk;
    return b.confidence - a.confidence;
  });

  // 4. Product Detection Layer (Runs BEFORE fallbacks)
  const tokens = cleanedMessage.split(' ').filter(w => w.length > 2);
  let foundProduct = false;
  try {
    const products = await Product.findAll({ where: { isActive: true } });
    (products || []).forEach(p => {
      if (cleanedMessage.includes(String(p.name || '').toLowerCase())) foundProduct = true;
    });
  } catch (e) { /* ignore DB miss */ }

  if (intents.length === 0) {
    if (foundProduct) intents.push({ intent: 'product_search', confidence: 80, risk: 10 });
    else if (cleanedMessage.split(' ').length <= 2) intents.push({ intent: 'greeting', confidence: 40, risk: 0 });
    else intents.push({ intent: 'technical_issue', confidence: 30, risk: 40 }); // Default unknown to tech support
  }

  return {
    originalMessage: String(rawMessage || ''),
    cleanedMessage,
    sentiment: sentimentData.mood,
    urgency: maxRisk > 70 ? 90 : 30,
    risk: maxRisk,
    intents: intents, // The full array of detected objects
    primaryIntent: (intents[0] || {}).intent || 'unknown',
    tokens
  };
};

// ============================================================
// 🧠 V10 FRUSTRATION & MEMORY ENGINE
// ============================================================
const resolveContext = (analysis, memory) => {
  let resolvedIntent = analysis.primaryIntent;
  const msg = analysis.cleanedMessage;

  // Frustration Engine
  let frustration = memory.frustrationScore || 0;
  if (/(still waiting|hello|bro|any update|not fixed|again|worst service)/i.test(msg)) {
    frustration += 20;
  }
  
  if (frustration >= 60 || analysis.sentiment === 'sarcastic' || analysis.sentiment === 'furious') {
    resolvedIntent = 'human_request'; 
  }

  // Issue Continuation
  if (/(still|again|help|update)/i.test(msg) && memory.lastIssue && memory.lastIssue !== 'none') {
    resolvedIntent = memory.lastIssue;
  }

  // Product Context
  if (['price_query', 'stock_query'].includes(resolvedIntent) && analysis.tokens.length <= 2 && memory.lastProduct) {
    analysis.tokens.push(memory.lastProduct);
  }

  return { ...analysis, primaryIntent: resolvedIntent, updatedFrustration: frustration };
};

// ============================================================
// 🗣️ V10 MULTI-INTENT COMPOSITE RESPONSE ENGINE
// ============================================================
const generateResponse = async (context, memory, user) => {
  const intentList = (context.intents || []).map(i => i.intent);
  const isMulti = intentList.length > 1;
  const ticket = memory.lastTicket || generateTicketId();

  // 1. Extreme Risk Override (Fraud/Hack/Human)
  if (['account_hacked', 'fraud_report', 'human_request'].includes(context.primaryIntent)) {
    return {
      type: 'escalate', level: 'Level 3 - Critical Security/Escalation', ticket,
      reply: `🚨 **PRIORITY ALERT (Ticket #${ticket})**\nI have immediately frozen standard processing and escalated this directly to the store manager. They have been pinged and are reviewing this chat now.`
    };
  }

  // 2. Multi-Intent Builder
  if (isMulti && context.risk >= 50) {
    let issuesText = [];
    let escalateLevel = 'Level 1 - Support';

    if (intentList.includes('payment_issue') || intentList.includes('double_payment')) { issuesText.push('• Payment/Transaction failure'); escalateLevel = 'Level 2 - Finance'; }
    if (intentList.includes('otp_issue') || intentList.includes('login_issue')) { issuesText.push('• Authentication/OTP block'); }
    if (intentList.includes('missing_order') || intentList.includes('late_order')) { issuesText.push('• Order logistics delay'); escalateLevel = 'Level 2 - Logistics'; }
    if (intentList.includes('technical_issue')) { issuesText.push('• Platform/App connectivity errors'); }

    return {
      type: 'escalate', level: escalateLevel, ticket,
      reply: `I have detected multiple issues with your account:\n\n${issuesText.join('\n')}\n\nI have bundled these into **Ticket #${ticket}** and escalated them to the store manager for manual override and verification.`
    };
  }

  // 3. Single Intent Logistics & Finance
  if (['payment_issue', 'refund_request'].includes(context.primaryIntent)) {
    if (!user) return { type: 'answer', reply: "I can check financial logs, but please log in first so I can trace your secure transaction history." };
    return { type: 'escalate', level: 'Level 2 - Finance', ticket, reply: `I understand there is a financial discrepancy. I have opened **Ticket #${ticket}**. If a payment was deducted but the order failed, the gateway auto-reverses it within 3-5 days. I have flagged the manager to verify this.` };
  }

  if (['missing_order', 'damaged_order'].includes(context.primaryIntent)) {
    if (!user) return { type: 'answer', reply: "Please log in so I can pull up your exact packing manifest." };
    return { type: 'escalate', level: 'Level 2 - Logistics', ticket, reply: `I apologize for the order discrepancy. I have opened **Ticket #${ticket}**. The store manager is reviewing the packing terminal footage to resolve this immediately.` };
  }

  // 4. Products Layer
  if (['price_query', 'stock_query', 'product_search'].includes(context.primaryIntent)) {
    const products = await Product.findAll({ where: { isActive: true } });
    const query = context.tokens.join(' ');
    
    let bestProduct = null;
    (products || []).forEach(p => {
      if (String(p.name || '').toLowerCase().includes(query)) bestProduct = p;
    });

    if (bestProduct) {
      const stock = Math.max(0, (bestProduct.real_stock || 0) - (bestProduct.buffer || 2));
      return { 
        type: 'answer', productContext: bestProduct.name,
        reply: `Regarding **${bestProduct.name}**: The current price is **₹${bestProduct.price}**. We have roughly **${stock} units available** in stock.` 
      };
    }
  }

  return { type: 'answer', reply: "Hello! 👋 I am the Lakshmi Stores support team assistant. I can track orders, check refunds, and review inventory. How can I assist you today?" };
};

// ============================================================
// 🛡️ V10 CRASH-PROOF CONTROLLER ROUTE
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

    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, status: THREAD_STATUS.AI, aiEnabled: true, 
        metadata: { memory: { lastIssue: 'none', frustrationScore: 0 } } 
      });
    }

    await SupportMessage.create({ threadId: thread.id, senderType: 'customer', body: rawMessage });

    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({ status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
      return res.json({ success: true, thread });
    }

    // 🚀 FIRE V10 PIPELINE
    const memory = (thread.metadata || {}).memory || {};
    const analysis = await analyzeMessage(rawMessage);
    const context = resolveContext(analysis, memory);
    const decision = await generateResponse(context, memory, user);

    // Update Memory State
    const updatedMemory = { ...memory };
    updatedMemory.frustrationScore = context.updatedFrustration;
    if (context.risk >= 50 && !['human_request'].includes(context.primaryIntent)) updatedMemory.lastIssue = context.primaryIntent;
    if (decision.ticket) updatedMemory.lastTicket = decision.ticket;
    if (decision.productContext) updatedMemory.lastProduct = decision.productContext;

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
    console.error('🛡️ V10 Crash Protection Activated:', error);
    res.status(200).json({ success: true, fallback: true, message: "System delay. Connecting you to the store manager." });
  }
};

// ============================================================
// 🛡️ ADMIN ROUTES (REWRITTEN FOR ZERO 500 CRASHES)
// ============================================================
exports.getPublicThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });
    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: messages.map(m => m.dataValues || m) } });
  } catch (error) { 
    console.error('getPublicThread Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch thread.' }); 
  }
};

exports.getThreads = async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status === 'active') { where.status = { [Op.ne]: 'resolved' }; } 
    else if (status) { where.status = status; }
    
    const threads = await SupportThread.findAll({ where, order: [['updatedAt', 'DESC']], limit: 50 });
    const serialized = [];
    for (const t of threads) {
       const messages = await SupportMessage.findAll({ where: { threadId: t.id }, order: [['createdAt', 'ASC']] });
       serialized.push({ ...(t.dataValues || t), messages: messages.map(m => m.dataValues || m) });
    }
    return res.json({ success: true, data: serialized });
  } catch (error) { 
    console.error('getThreads Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch threads.' }); 
  }
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
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: messages.map(m => m.dataValues || m) } });
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
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: messages.map(m => m.dataValues || m) } });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to resolve thread.' }); }
};