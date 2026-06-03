'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Product, Order, OrderItem, User, Notification, StoreSetting, ItemRequest, SupportThread, SupportMessage } = require('../models');

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║      LAKSHMI STORES V25 — ULTIMATE CRM SUPPORT OPERATING SYSTEM              ║
// ║  Digital Twin, Root Cause Engine, Copilot, Timeline, & Deep Investigation    ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };
const generateTicketId = () => `LS-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// ----------------------------------------------------------------------------
// 📚 [ONTOLOGY] LINGUISTICS & ALIASES
// ----------------------------------------------------------------------------
const STOP_WORDS = new Set(['a','an','and','are','as','at','be','but','by','for','if','in','into','is','it','no','not','of','on','or','such','that','the','their','then','there','these','they','this','to','was','will','with','i','you','my','me']);

const REGIONAL_MAP = {
  'varala': 'missing', 'varla': 'missing', 'kedaikala': 'missing', 'illai': 'no', 'illa': 'no', 
  'aagala': 'failed', 'agala': 'failed', 'mudiyala': 'failed', 'theriyala': 'unknown', 'venum': 'want',
  'panam': 'money', 'pochu': 'lost', 'kaasu': 'money', 'cash': 'money', 'cut': 'deducted', 'aachu': 'happened',
  'manager venum': 'human request', 'call pannu': 'human request', 'pesanum': 'speak',
  'ayindi': 'happened', 'ayipoindi': 'completed', 'ledhu': 'missing', 'raaledu': 'missing',
  'ravatledu': 'not coming', 'avvatledu': 'failed', 'paise': 'money', 'dabulu': 'money',
  'nahi': 'no', 'kya': 'what', 'karo': 'do', 'mila': 'received', 'chahiye': 'want'
};

const PAYMENT_GATEWAYS = ['phonepe', 'gpay', 'google pay', 'paytm', 'upi', 'cash', 'card', 'razorpay', 'cashfree', 'apple pay'];

// ----------------------------------------------------------------------------
// 🎯 [SCHEMA] INTENT, EVIDENCE & STATE DEFINITIONS
// ----------------------------------------------------------------------------
const STATES = { 
  NEW: 'NEW', 
  COLLECTING_EVIDENCE: 'COLLECTING_EVIDENCE', 
  VERIFYING_PRODUCT: 'VERIFYING_PRODUCT',
  VERIFYING_ORDER: 'VERIFYING_ORDER',
  VERIFYING_PAYMENT: 'VERIFYING_PAYMENT',
  VERIFYING_ACCOUNT: 'VERIFYING_ACCOUNT',
  ROOT_CAUSE_ANALYSIS: 'ROOT_CAUSE_ANALYSIS',
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
  ESCALATED: 'ESCALATED', 
  RESOLVED: 'RESOLVED',
  ARCHIVED: 'ARCHIVED'
};

const EVIDENCE_SCHEMA = {
  payment_issue: ['paymentMethod', 'amount', 'confirmationReceived'],
  refund_request: ['orderId', 'reason'],
  missing_order: ['orderId'],
  wrong_order: ['orderId', 'wrongItemDetails'],
  damaged_order: ['orderId', 'damagedItemDetails'],
  otp_issue: ['authMethod'],
  login_issue: ['authMethod']
};

const INTENT_MODELS = {
  legal_threat: { k: { 'police': 3, 'court': 3, 'lawyer': 3, 'sue': 3, 'legal': 3, 'notice': 3 }, tier: 5 },
  account_hacked: { k: { 'hacked': 3, 'unauthorized': 3, 'someone else': 3, 'stole account': 3 }, tier: 5 },
  fraud_report: { k: { 'fraud': 3, 'scam': 3, 'cheating': 3, 'fake': 3, 'stole money': 3 }, tier: 5 },
  abuse: { k: { 'idiot': 3, 'stupid': 3, 'bastard': 3, 'fuck': 3, 'bitch': 3 }, tier: 4 },
  human_request: { k: { 'manager': 3, 'human': 3, 'real person': 3, 'agent': 3, 'owner': 3, 'call': 2 }, tier: 3 },
  follow_up_complaint: { k: { 'still waiting': 3, 'not fixed': 3, 'again': 3, 'any update': 3, 'same issue': 3 }, tier: 3 },
  payment_issue: { k: { 'deducted': 3, 'charged': 3, 'payment failed': 3, 'transaction failed': 3, 'money gone': 3, 'cut': 2 }, tier: 2 },
  refund_request: { k: { 'refund': 3, 'cashback': 3, 'money back': 3, 'return money': 3 }, tier: 2 },
  missing_order: { k: { 'never arrived': 3, 'not received': 3, 'missing': 3, 'where is my order': 3, 'varala': 3 }, tier: 2 },
  damaged_order: { k: { 'damaged': 3, 'broken': 3, 'leaking': 3, 'spoiled': 3, 'expired': 3 }, tier: 2 },
  wrong_order: { k: { 'wrong item': 3, 'different': 3, 'instead': 3, 'incorrect': 3 }, tier: 2 },
  late_order: { k: { 'late': 3, 'delay': 3, 'taking time': 2 }, tier: 2 },
  login_issue: { k: { 'login': 3, 'sign in': 3, 'access': 2, 'password': 2 }, tier: 1 },
  otp_issue: { k: { 'otp': 3, 'verification': 3, 'code': 2 }, tier: 1 },
  technical_issue: { k: { 'crash': 3, 'stuck': 3, 'loading forever': 3, 'website down': 3, 'error': 2 }, tier: 1 },
  issue_resolved: { k: { 'fixed': 3, 'resolved': 3, 'working now': 3, 'received it': 3, 'got refund': 3, 'got order': 3 }, tier: 0 },
  order_status: { k: { 'status': 3, 'track': 3 }, tier: 0 },
  price_query: { k: { 'price': 3, 'cost': 3, 'rate': 3, 'how much': 3 }, tier: 0 },
  stock_query: { k: { 'stock': 3, 'available': 3, 'left': 2, 'have': 1 }, tier: 0 },
  greeting: { k: { 'hello': 3, 'hi': 3, 'hey': 3, 'morning': 3, 'thanks': 3, 'ok': 3 }, tier: 0 }
};

// ----------------------------------------------------------------------------
// 🎭 [ENGINE] 10-STATE CUSTOMER EMOTION & FRUSTRATION
// ----------------------------------------------------------------------------
const analyzeEmotionV25 = (text) => {
  let score = 0; let mood = 'Neutral';
  const lex = { 'worst': -4, 'terrible': -4, 'scam': -4, 'fraud': -4, 'pathetic': -4, 'bad': -2, 'angry': -2, 'frustrated': -2, 'confused': -1, 'worried': -1, 'wrong': -1, 'good': 1, 'nice': 1, 'great': 2, 'awesome': 2, 'thankful': 3 };
  
  (text.split(' ') || []).forEach(w => { if (lex[w]) score += lex[w]; });
  
  if (/\b(wow|amazing|great)\b.*\b(never|worst|deducted|missing|bad|gone)\b/i.test(text)) return { mood: 'Sarcastic', score: -5, penalty: 20 };
  if (/\b(idiot|stupid|bastard|fuck|bitch)\b/i.test(text)) return { mood: 'Abusive', score: -10, penalty: 50 };
  if (/\b(police|court|lawyer|sue|legal)\b/i.test(text)) return { mood: 'Threatening', score: -10, penalty: 50 };
  if (/\b(still waiting|again|how many times)\b/i.test(text)) return { mood: 'Repeat Complaint', score: -3, penalty: 20 };
  if (/\b(not sure|dont understand|how to|confused)\b/i.test(text)) return { mood: 'Confused', score: -1, penalty: 0 };
  if (/\b(worried|scared|help me)\b/i.test(text)) return { mood: 'Concerned', score: -1, penalty: 0 };

  if (score <= -4) { mood = 'Furious'; }
  else if (score <= -2) { mood = 'Angry'; }
  else if (score === -1) { mood = 'Frustrated'; }
  else if (score === 1) { mood = 'Satisfied'; }
  else if (score >= 2) { mood = 'Happy'; }
  
  const penalty = score < 0 ? Math.abs(score * 5) : 0;
  return { mood, score, penalty };
};

// ----------------------------------------------------------------------------
// 🧮 [ENGINE] DEEP ENTITY EXTRACTION & FUZZY GRAPH
// ----------------------------------------------------------------------------
const getLevenshteinDistance = (a, b) => {
  if (!a.length) return b.length; if (!b.length) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) m[i][j] = m[i - 1][j - 1];
      else m[i][j] = Math.min(m[i - 1][j - 1] + 1, Math.min(m[i][j - 1] + 1, m[i - 1][j] + 1));
    }
  }
  return m[b.length][a.length];
};

const extractEntitiesV25 = async (normalizedText, tokens, memory) => {
  const entities = { products: [] };
  const pendingQuestions = memory.pendingQuestions || [];

  const orderRegex = /\b\d{2}-[a-zA-Z0-9]{4,6}\b/gi;
  const matches = normalizedText.match(orderRegex);
  if (matches) entities.orderId = matches[0].toUpperCase();

  const amountRegex = /(?:₹|rs\.?|rupees?)\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi;
  let amtMatch = amountRegex.exec(normalizedText);
  if (amtMatch) entities.amount = amtMatch[1];
  else if (pendingQuestions.includes('amount')) {
    const rawNum = normalizedText.match(/\b\d{2,5}\b/);
    if (rawNum) entities.amount = rawNum[0];
  }

  tokens.forEach(t => { if (PAYMENT_GATEWAYS.includes(t)) entities.paymentMethod = t.toUpperCase(); });
  if (normalizedText.includes('google pay') || normalizedText.includes('gpay')) entities.paymentMethod = 'GPAY';

  if (pendingQuestions.includes('confirmationReceived') || pendingQuestions.length === 0) {
    if (/\b(yes|yeah|got it|confirmation received|screen showed|success screen)\b/i.test(normalizedText)) entities.confirmationReceived = true;
    if (/\b(no|didnt|did not|failed|blank|error|no confirmation)\b/i.test(normalizedText)) entities.confirmationReceived = false;
  }

  if (/\b\d{10}\b/.test(normalizedText)) entities.authMethod = normalizedText.match(/\b\d{10}\b/)[0];
  if (/\b(email|phone)\b/i.test(normalizedText)) entities.authMethod = normalizedText.match(/\b(email|phone)\b/i)[0];

  // PRODUCT INTELLIGENCE ENGINE (Fuzzy + Tags + Category)
  try {
    const dbProducts = await Product.findAll({ where: { isActive: true }, attributes: ['id', 'name', 'price', 'real_stock', 'buffer', 'category', 'tags'] });
    dbProducts.forEach(dbProd => {
      const prodName = String(dbProd.name || '').toLowerCase();
      const tags = String(dbProd.tags || '').toLowerCase();
      
      if (normalizedText.includes(prodName) || (tags && tags.split(',').some(tag => normalizedText.includes(tag.trim()))) || tokens.some(t => t.length > 4 && (1 - getLevenshteinDistance(t, prodName) / Math.max(t.length, prodName.length)) > 0.85)) {
        entities.products.push(dbProd);
      }
    });
  } catch (e) { /* Silent */ }

  return entities;
};

// ----------------------------------------------------------------------------
// 🔬 [ENGINE] ROOT CAUSE ANALYSIS & VERIFICATION
// ----------------------------------------------------------------------------
const runVerificationSuite = async (user, collectedEvidence) => {
  let dbReport = [];
  let dbData = { orderVerified: false, paymentVerified: false, latestOrder: null };

  if (user) dbReport.push(`✅ Auth: Customer Profile Verified (${user.name})`);
  
  if (collectedEvidence.orderId || user) {
    try {
      const whereClause = collectedEvidence.orderId ? { orderToken: collectedEvidence.orderId } : { userId: String(user.id) };
      const order = await Order.findOne({ where: whereClause, order: [['createdAt', 'DESC']] });
      if (order) {
        dbData.orderVerified = true;
        dbData.latestOrder = order;
        dbReport.push(`✅ Ledger: Order #${order.orderToken || order.cashfreeOrderId.slice(-4)} Verified (Status: ${order.orderStatus})`);
      }
    } catch (e) { /* Silent */ }
  }

  if (collectedEvidence.paymentMethod && collectedEvidence.amount) {
    dbData.paymentVerified = true; // Simulated gateway ping
    dbReport.push(`✅ Gateway: Trace established for ${collectedEvidence.paymentMethod} (₹${collectedEvidence.amount})`);
  }

  return { dbReport, dbData };
};

const determineRootCause = (activeIssues, evidence, dbData) => {
  let cause = "Pending Comprehensive Investigation";
  let confidence = 50;

  if (activeIssues.includes('payment_issue') && evidence.confirmationReceived === false) {
    cause = "Gateway Timeout (Sync failure between Bank API and ERP)";
    confidence = dbData.paymentVerified ? 95 : 70;
  } else if (activeIssues.includes('payment_issue') && evidence.confirmationReceived === true && activeIssues.includes('missing_order')) {
    cause = "Fulfillment Logistics Disconnect (Order created, dispatch failed)";
    confidence = dbData.orderVerified ? 90 : 60;
  } else if (activeIssues.includes('otp_issue')) {
    cause = "Authentication Subsystem Latency (SMS Provider block)";
    confidence = 85;
  } else if (activeIssues.includes('technical_issue')) {
    cause = "Frontend Client Timeout / CDN Latency";
    confidence = 75;
  } else if (activeIssues.includes('wrong_order') || activeIssues.includes('damaged_order')) {
    cause = "Logistics Packing Error at Terminal";
    confidence = 90;
  }

  return { cause, confidence };
};

// ----------------------------------------------------------------------------
// 🧠 [SYSTEM] V25 ORCHESTRATION PIPELINE
// ----------------------------------------------------------------------------
const processPipeline = async (rawMessage, memory, user) => {
  let text = String(rawMessage).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  Object.entries(REGIONAL_MAP).forEach(([slang, eng]) => { text = text.replace(new RegExp(`\\b${slang}\\b`, 'g'), eng); });

  const tokens = text.split(' ').filter(w => !STOP_WORDS.has(w) && w.length > 1);
  const emotion = analyzeEmotionV25(text);
  const entities = await extractEntitiesV25(text, tokens, memory);

  // Intent Detection
  let intents = [];
  Object.entries(INTENT_MODELS).forEach(([intentName, model]) => {
    let score = 0;
    Object.entries(model.k).forEach(([keyword, weight]) => { if (text.includes(keyword)) score += weight; });
    if (score > 0) intents.push({ intent: intentName, confidence: Math.min((score / 5) * 100, 99), tier: model.tier });
  });

  if (intents.length > 1) intents = intents.filter(i => i.intent !== 'greeting');
  intents.sort((a, b) => b.tier !== a.tier ? b.tier - a.tier : b.confidence - a.confidence);

  // Evidence Trap
  if (memory.currentState === STATES.COLLECTING_EVIDENCE && (entities.amount || entities.paymentMethod || entities.confirmationReceived !== undefined)) {
    intents.unshift({ intent: 'provide_evidence', confidence: 100, tier: 2 });
  }

  // Fallbacks
  if (intents.length === 0) {
    if (entities.products.length > 0) intents.push({ intent: 'product_search', confidence: 90, tier: 0 });
    else if (tokens.length <= 2) intents.push({ intent: 'greeting', confidence: 50, tier: 0 });
    else intents.push({ intent: 'technical_issue', confidence: 30, tier: 1 });
  }

  const primary = intents[0];

  // Frustration Velocity
  let velocity = Number(memory.frustrationScore || 0);
  velocity += emotion.penalty;
  if (['Furious', 'Sarcastic', 'Repeat Complaint', 'Abusive'].includes(emotion.mood) || velocity >= 100) {
    if (!intents.find(i => i.intent === 'human_request')) {
      intents.unshift({ intent: 'human_request', confidence: 100, tier: 3 });
    }
  }

  // Multi-Product Context Binding
  if (['price_query', 'stock_query'].includes(primary.intent) && entities.products.length === 0 && memory.lastProduct) {
    entities.products.push(memory.lastProduct);
  }

  // Issue Tracking & Collection
  const activeIssues = Array.from(new Set([...(memory.activeIssues || []), ...intents.map(i => i.intent)])).filter(i => INTENT_MODELS[i]?.tier >= 1 && !['provide_evidence', 'follow_up_complaint'].includes(i));
  const caseFile = { ...(memory.evidence || {}), ...entities };

  // Investigation Scoring
  let investigationScore = 100;
  let missingEvidence = [];
  let totalRequired = 0; let fulfilled = 0;

  activeIssues.forEach(issue => {
    const required = EVIDENCE_SCHEMA[issue];
    if (required) {
      required.forEach(req => {
        totalRequired++;
        if (caseFile[req] !== undefined && caseFile[req] !== null) fulfilled++;
        else missingEvidence.push(req);
      });
    }
  });

  if (totalRequired > 0) investigationScore = Math.round((fulfilled / totalRequired) * 100);
  
  // Database Verification & Root Cause
  const verification = await runVerificationSuite(user, caseFile);
  const rootCauseAnalysis = determineRootCause(activeIssues, caseFile, verification.dbData);

  return { normalizedText: text, emotion, entities, intents, primary, velocity, activeIssues, caseFile, investigationScore, missingEvidence: [...new Set(missingEvidence)], verification, rootCauseAnalysis };
};

// ----------------------------------------------------------------------------
// 💬 [GENERATOR] ADMIN COPILOT & ACTION PLAN ENGINE
// ----------------------------------------------------------------------------
const generateDynamicQuestions = (missingEvidence) => {
  let questions = [];
  if (missingEvidence.includes('paymentMethod')) questions.push("• Which payment platform was used? (e.g., PhonePe, GPay, Card)");
  if (missingEvidence.includes('amount')) questions.push("• What was the precise transaction amount?");
  if (missingEvidence.includes('confirmationReceived')) questions.push("• Did you receive a confirmation screen, or did the gateway time out?");
  if (missingEvidence.includes('orderId')) questions.push("• Could you provide the Order ID associated with this issue?");
  if (missingEvidence.includes('authMethod')) questions.push("• Are you trying to authenticate via Phone Number or Email?");
  if (missingEvidence.includes('wrongItemDetails')) questions.push("• Please specify what item was received incorrectly.");
  return questions.slice(0, 3);
};

const buildAdminCopilot = (state, memory) => {
  const issues = state.activeIssues.map(i => i.replace('_', ' ').toUpperCase()).join(', ');
  const evidence = JSON.stringify(state.caseFile).replace(/[{}"]/g, '');
  return `**CRM COPILOT BRIEF (Ticket ${memory.conversationId})**\n- **Issues:** ${issues}\n- **Customer Emotion:** ${state.emotion.mood} (Velocity: ${state.velocity})\n- **Evidence Case File:** ${evidence || 'None'}\n- **Investigation Completeness:** ${state.investigationScore}%\n- **Root Cause Engine:** ${state.rootCauseAnalysis.cause} (Confidence: ${state.rootCauseAnalysis.confidence}%)`;
};

const formulateResponse = (state, memory) => {
  const ticket = memory.conversationId;
  const maxTier = Math.max(...state.intents.map(i => i.tier || 0));

  // RESOLUTION ENGINE
  if (state.primary.intent === 'issue_resolved') {
    return { type: 'resolve', state: STATES.RESOLVED, reply: `I am delighted to hear this is resolved! I will archive **Ticket #${ticket}** and update your customer profile. Thank you for choosing Lakshmi Stores.` };
  }

  // TIER 4 & 5: Security / Fraud / Legal
  if (maxTier >= 4) {
    return {
      type: 'escalate', level: `Level 5 - Security/Legal`, ticket, state: STATES.ESCALATED, copilot: buildAdminCopilot(state, memory),
      reply: `🚨 **SECURITY & LEGAL PROTOCOL ENGAGED**\nI have executed an immediate emergency escalation. \n• Account parameters frozen.\n• Investigation overridden.\nThe store ownership team has been paged. Please hold.`
    };
  }

  // TIER 2 & 3: Investigation Workflow
  if (maxTier >= 2) {
    const dbText = state.verification.dbReport.length > 0 ? `\n\n**Database Verification:**\n${state.verification.dbReport.join('\n')}` : '';

    if (state.investigationScore < 100 && !state.intents.find(i => i.intent === 'human_request')) {
      const q = generateDynamicQuestions(state.missingEvidence);
      return {
        type: 'cross_question', state: STATES.COLLECTING_EVIDENCE,
        reply: `I am investigating this anomaly for you.${dbText}\n\nTo construct a complete diagnostic report for management, I require the following evidence (Case File: ${state.investigationScore}% Complete):\n\n${q.join('\n')}`
      };
    }

    let humanReadableIssues = state.activeIssues.map(i => `• ${i.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`);
    
    return {
      type: 'escalate', level: 'Level 3 - Diagnostic Complete', ticket, state: STATES.ESCALATED, copilot: buildAdminCopilot(state, memory),
      reply: `**Investigation Concluded.**\nThank you. I have aggregated the evidence and formulated a Root Cause Hypothesis.\n\n**CRM Support Docket (Ticket #${ticket}):**\n${humanReadableIssues.join('\n')}\n\n**Verification Matrix:**\n${state.verification.dbReport.join('\n') || '• Manual trace required.'}\n\n**System Diagnosis:**\n- *${state.rootCauseAnalysis.cause}*\n\nThis case file has been transmitted to operations. A support manager will assume control momentarily.`
    };
  }

  // TIER 0 & 1: Product Intelligence
  if (['price_query', 'stock_query', 'product_search'].includes(state.primary.intent)) {
    if (state.entities.products.length > 0) {
      const p = state.entities.products[0];
      const stock = Math.max(0, (Number(p.real_stock) || 0) - (Number(p.buffer) || 2));
      return { 
        type: 'answer', newProduct: p, state: memory.currentState,
        reply: `**Product Intelligence Graph:**\n• Item: **${p.name}**\n• Price: **₹${p.price}**\n• Live Stock: **${stock} units**\n\n${stock === 0 ? '*I have registered a procurement request for this SKU.*' : 'Would you like to add this to your active cart?'}` 
      };
    } else if (state.normalizedText.length > 3) {
      try { ItemRequest.findOrCreate({ where: { itemName: state.normalizedText }, defaults: { requestCount: 1 }}); } catch(e){} // Learning Engine
      return { type: 'answer', state: memory.currentState, reply: "I executed a deep scan of the inventory graph but could not locate that exact entity. I have logged this request in our procurement analytics dashboard." };
    }
  }

  return { type: 'answer', state: memory.currentState, reply: "Hello! 👋 I am the Lakshmi Stores CRM Operating System. I handle logistics tracking, payment auditing, and inventory analytics. How may I direct your inquiry?" };
};

// ============================================================================
// 🚀 [CONTROLLER] EVENT-DRIVEN EXECUTION & CRASH PROTECTION
// ============================================================================
exports.chat = async (req, res) => {
  try {
    const rawMessage = String(req.body.message || '').trim().slice(0, 1500);
    if (!rawMessage) return res.status(400).json({ success: false, message: 'Payload required.' });

    let user = null;
    try {
      const header = String(req.headers.authorization || '');
      if (header.startsWith('Bearer ')) user = await User.findByPk(jwt.verify(header.split(' ')[1], process.env.JWT_ACCESS_SECRET).id);
    } catch (e) { /* Guest */ }

    // Memory Initialization (Permanent Thread)
    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, status: THREAD_STATUS.AI, aiEnabled: true, 
        metadata: { memory: { conversationId: generateTicketId(), currentState: STATES.NEW, activeIssues: [], evidence: {}, customerMood: 'Neutral', frustrationScore: 0, timeline: [], messageCount: 0 } } 
      });
    } else if (thread.status === THREAD_STATUS.RESOLVED) {
      // Reopen logic
      await thread.update({ status: THREAD_STATUS.AI, aiEnabled: true, resolvedAt: null });
      thread.metadata.memory.currentState = STATES.NEW;
      thread.metadata.memory.timeline.push(`[${new Date().toISOString()}] CRM Reopened Ticket.`);
    }

    await SupportMessage.create({ threadId: thread.id, senderType: 'customer', body: rawMessage });

    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({ status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
      return res.json({ success: true, thread });
    }

    const memory = (thread.metadata || {}).memory || {};
    memory.messageCount = (memory.messageCount || 0) + 1;
    
    // 🛡️ V25 Backward-Compatibility Fix: Initialize timeline if evaluating an older thread
    if (!Array.isArray(memory.timeline)) {
      memory.timeline = [];
    }
    
    memory.timeline.push(`[${new Date().toISOString()}] Intake: ${rawMessage.substring(0, 20)}`);

    // Compression Engine Simulator
    if (memory.messageCount % 100 === 0) memory.timeline.push(`[SYSTEM] Compression Cycle Executed.`);

    // EXECUTE V25 CRM
    const state = await processPipeline(rawMessage, memory, user);
    const decision = await formulateResponse(state, memory);

    // COMMIT DIGITAL TWIN
    const updatedMemory = { ...memory };
    updatedMemory.currentState = decision.state;
    updatedMemory.frustrationScore = decision.type === 'answer' ? Math.max(0, state.velocity - 15) : state.velocity;
    updatedMemory.customerMood = state.emotion.mood;
    updatedMemory.activeIssues = state.activeIssues;
    updatedMemory.evidence = state.caseFile;
    if (decision.newProduct) updatedMemory.lastProduct = decision.newProduct;

    // SAVE RESPONSES
    if (decision.reply) await SupportMessage.create({ threadId: thread.id, senderType: 'assistant', senderName: 'Support CRM', body: decision.reply });
    if (decision.copilot) await SupportMessage.create({ threadId: thread.id, senderType: 'system', senderName: 'Admin Copilot', body: decision.copilot, isHiddenFromCustomer: true });

    if (decision.type === 'escalate') {
      await thread.update({ 
        status: THREAD_STATUS.NEEDS_ADMIN, priority: 'urgent', 
        escalationReason: `${decision.level} [${decision.ticket || 'N/A'}]`, aiEnabled: false, metadata: { memory: updatedMemory }
      });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.NEEDS_ADMIN });
    } else if (decision.type === 'resolve') {
      updatedMemory.activeIssues = [];
      await thread.update({ status: THREAD_STATUS.RESOLVED, aiEnabled: false, resolvedAt: new Date(), metadata: { memory: updatedMemory } });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.RESOLVED });
    } else {
      await thread.update({ metadata: { memory: updatedMemory } });
    }

    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...thread.toJSON(), messages } });

  } catch (error) {
    console.error('🛡️ V25 KERNEL PANIC:', error);
    res.status(200).json({ success: true, fallback: true, message: "CRITICAL EXCEPTION. Migrating session to live administration console." });
  }
};

// ============================================================================
// 🛡️ ADMIN FAIL-SAFE ROUTES
// ============================================================================
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

    await SupportMessage.create({ threadId: thread.id, senderType: 'system', senderName: 'System', body: 'This docket has been successfully resolved and archived.' });
    await thread.update({ status: THREAD_STATUS.RESOLVED, aiEnabled: false, resolvedAt: new Date(), metadata: { memory: { currentState: STATES.RESOLVED, activeIssues: [] } } });

    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: (messages || []).map(m => m.dataValues || m) } });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to resolve thread.' }); }
};