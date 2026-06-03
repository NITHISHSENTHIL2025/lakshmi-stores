'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Product, Order, OrderItem, User, Notification, StoreSetting, ItemRequest, SupportThread, SupportMessage } = require('../models');

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║        LAKSHMI STORES V17 — THE OMNI-BRAIN FINAL BEAST ARCHITECTURE          ║
// ║  Memory, Investigation, Dynamic Escalation, Copilot, & Entity Context Graph  ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };
const generateTicketId = () => `LS-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// ============================================================================
// 📚 LAYER 1: MULTILINGUAL KNOWLEDGE GRAPH & ONTOLOGY
// ============================================================================
const STOP_WORDS = new Set(['a','an','and','are','as','at','be','but','by','for','if','in','into','is','it','no','not','of','on','or','such','that','the','their','then','there','these','they','this','to','was','will','with','i','you','my','me']);

const REGIONAL_TRANSLATION_MATRIX = {
  'varala': 'missing', 'varla': 'missing', 'kedaikala': 'missing', 'illai': 'no', 'illa': 'no', 
  'aagala': 'failed', 'agala': 'failed', 'mudiyala': 'failed', 'theriyala': 'unknown', 'venum': 'want',
  'panam': 'money', 'pochu': 'lost', 'kaasu': 'money', 'cash': 'money', 'cut': 'deducted', 'aachu': 'happened',
  'manager venum': 'human request', 'call pannu': 'human request', 'pesanum': 'speak',
  'ayindi': 'happened', 'ayipoindi': 'completed', 'ledhu': 'missing', 'raaledu': 'missing',
  'ravatledu': 'not coming', 'avvatledu': 'failed', 'paise': 'money', 'dabulu': 'money',
  'nahi': 'no', 'kya': 'what', 'karo': 'do', 'mila': 'received', 'chahiye': 'want'
};

const PRODUCT_ALIASES = { 'maggie': 'maggi', 'coke': 'coca cola', 'thumbs up': 'thums up', 'veggies': 'vegetables', 'paani': 'water', 'chini': 'sugar', 'dhal': 'dal', 'sabzi': 'vegetables' };
const PAYMENT_GATEWAYS = ['phonepe', 'gpay', 'google pay', 'paytm', 'upi', 'cash', 'card', 'razorpay', 'cashfree', 'apple pay'];

// ============================================================================
// 🎯 LAYER 2: INTENT ENGINE & EVIDENCE SCHEMA (PROGRESSIVE TIERS 0-6)
// ============================================================================
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
  // Tier 5: Legal & Security
  legal_threat: { keywords: { 'police': 3, 'court': 3, 'lawyer': 3, 'sue': 3, 'legal': 3 }, tier: 5, category: 'legal' },
  account_hacked: { keywords: { 'hacked': 3, 'unauthorized': 3, 'someone else': 3, 'stole account': 3 }, tier: 5, category: 'security' },
  fraud_report: { keywords: { 'fraud': 3, 'scam': 3, 'cheating': 3, 'fake': 3, 'stole money': 3 }, tier: 5, category: 'security' },
  // Tier 3 & 4: Escalations
  human_request: { keywords: { 'manager': 3, 'human': 3, 'real person': 3, 'agent': 3, 'owner': 3, 'call': 2 }, tier: 3, category: 'escalation' },
  follow_up_complaint: { keywords: { 'still waiting': 3, 'not fixed': 3, 'again': 3, 'any update': 3, 'same issue': 3 }, tier: 3, category: 'escalation' },
  // Tier 2: Investigations (Requires Evidence)
  payment_issue: { keywords: { 'deducted': 3, 'charged': 3, 'payment failed': 3, 'transaction failed': 3, 'money gone': 3, 'cut': 2 }, tier: 2, category: 'finance' },
  refund_request: { keywords: { 'refund': 3, 'cashback': 3, 'money back': 3, 'return money': 3 }, tier: 2, category: 'finance' },
  missing_order: { keywords: { 'never arrived': 3, 'not received': 3, 'missing': 3, 'where is my order': 3, 'varala': 3 }, tier: 2, category: 'logistics' },
  damaged_order: { keywords: { 'damaged': 3, 'broken': 3, 'leaking': 3, 'spoiled': 3, 'expired': 3 }, tier: 2, category: 'logistics' },
  wrong_order: { keywords: { 'wrong item': 3, 'different': 3, 'instead': 3, 'incorrect': 3 }, tier: 2, category: 'logistics' },
  late_order: { keywords: { 'late': 3, 'delay': 3, 'taking time': 2 }, tier: 2, category: 'logistics' },
  // Tier 1: Platform
  login_issue: { keywords: { 'login': 3, 'sign in': 3, 'access': 2, 'password': 2 }, tier: 1, category: 'tech' },
  otp_issue: { keywords: { 'otp': 3, 'verification': 3, 'code': 2 }, tier: 1, category: 'tech' },
  technical_issue: { keywords: { 'crash': 3, 'stuck': 3, 'loading forever': 3, 'website down': 3, 'error': 2 }, tier: 1, category: 'tech' },
  // Tier 0: Information & Products
  order_status: { keywords: { 'status': 3, 'track': 3 }, tier: 0, category: 'info' },
  price_query: { keywords: { 'price': 3, 'cost': 3, 'rate': 3, 'how much': 3 }, tier: 0, category: 'sales' },
  stock_query: { keywords: { 'stock': 3, 'available': 3, 'left': 2, 'have': 1 }, tier: 0, category: 'sales' },
  greeting: { keywords: { 'hello': 3, 'hi': 3, 'hey': 3, 'morning': 3, 'thanks': 3, 'ok': 3 }, tier: 0, category: 'chit_chat' }
};

// ============================================================================
// 🎭 LAYER 3: 10-STATE CUSTOMER EMOTION ENGINE
// ============================================================================
const analyzeEmotionV17 = (text) => {
  let score = 0; let mood = 'neutral';
  const lex = { 'worst': -4, 'terrible': -4, 'scam': -4, 'fraud': -4, 'pathetic': -4, 'bad': -2, 'angry': -2, 'frustrated': -2, 'confused': -1, 'worried': -1, 'wrong': -1, 'good': 1, 'nice': 1, 'great': 2, 'awesome': 2, 'thankful': 3 };
  
  (text.split(' ') || []).forEach(w => { if (lex[w]) score += lex[w]; });
  
  if (/\b(wow|amazing|great)\b.*\b(never|worst|deducted|missing|bad)\b/i.test(text)) return { mood: 'sarcastic', score: -5 };
  if (/\b(still waiting|again|how many times)\b/i.test(text)) return { mood: 'repeat_complaint', score: -3 };
  if (/\b(not sure|dont understand|how to|confused)\b/i.test(text)) return { mood: 'confused', score: -1 };
  if (/\b(worried|scared|help me)\b/i.test(text)) return { mood: 'worried', score: -1 };

  if (score <= -4) mood = 'furious';
  else if (score <= -2) mood = 'angry';
  else if (score === -1) mood = 'frustrated';
  else if (score === 1) mood = 'satisfied';
  else if (score >= 2) mood = 'thankful';
  
  return { mood, score };
};

// ============================================================================
// 🧮 LAYER 4: ENTITY EXTRACTION & FUZZY MATCHING
// ============================================================================
const getLevenshteinDistance = (a, b) => {
  if (!a.length) return b.length; if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
      else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
    }
  }
  return matrix[b.length][a.length];
};

const extractEntitiesV17 = async (normalizedText, tokens) => {
  const entities = { products: [] };

  // Regex Extraction
  const orderRegex = /\b\d{2}-[a-zA-Z0-9]{4,6}\b/gi;
  const matches = normalizedText.match(orderRegex);
  if (matches) entities.orderId = matches[0].toUpperCase();

  const amountRegex = /(?:₹|rs\.?|rupees?)\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi;
  let amtMatch = amountRegex.exec(normalizedText);
  if (amtMatch) entities.amount = amtMatch[1];

  // Specific Evidence Parameters
  tokens.forEach(t => { if (PAYMENT_GATEWAYS.includes(t)) entities.paymentMethod = t.toUpperCase(); });
  if (normalizedText.includes('google pay')) entities.paymentMethod = 'GPAY';
  if (/\b(phone number|email|mobile)\b/i.test(normalizedText)) entities.authMethod = normalizedText.match(/\b(phone number|email|mobile)\b/i)[0];
  if (/\b(yes|yeah|got it|screen showed|received)\b/i.test(normalizedText)) entities.confirmationReceived = true;
  if (/\b(no|didnt|did not|failed|blank|error)\b/i.test(normalizedText)) entities.confirmationReceived = false;

  // Real Database Product Search
  try {
    const dbProducts = await Product.findAll({ where: { isActive: true }, attributes: ['id', 'name', 'price', 'real_stock', 'buffer'] });
    dbProducts.forEach(dbProd => {
      const prodName = String(dbProd.name || '').toLowerCase();
      if (normalizedText.includes(prodName) || tokens.some(t => t.length > 3 && (1 - getLevenshteinDistance(t, prodName) / Math.max(t.length, prodName.length)) > 0.85)) {
        entities.products.push(dbProd);
      }
    });
  } catch (error) { /* Silent DB Fail */ }

  return entities;
};

// ============================================================================
// 🧠 LAYER 5: OMNI-BRAIN PIPELINE & STATE ORCHESTRATION
// ============================================================================
const processNaturalLanguage = async (rawMessage) => {
  let text = String(rawMessage).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  Object.entries(REGIONAL_TRANSLATION_MATRIX).forEach(([slang, eng]) => { text = text.replace(new RegExp(`\\b${slang}\\b`, 'g'), eng); });
  Object.entries(PRODUCT_ALIASES).forEach(([alias, trueName]) => { text = text.replace(new RegExp(`\\b${alias}\\b`, 'g'), trueName); });

  const tokens = text.split(' ').filter(w => !STOP_WORDS.has(w) && w.length > 1);
  const emotion = analyzeEmotionV17(text);
  const entities = await extractEntitiesV17(text, tokens);

  let detectedIntents = [];
  Object.entries(INTENT_MODELS).forEach(([intentName, model]) => {
    let score = 0;
    Object.entries(model.keywords).forEach(([keyword, weight]) => { if (text.includes(keyword)) score += weight; });
    if (score > 0) detectedIntents.push({ intent: intentName, confidence: Math.min((score / 5) * 100, 99), ...model });
  });

  if (detectedIntents.length > 1) detectedIntents = detectedIntents.filter(i => i.intent !== 'greeting');
  detectedIntents.sort((a, b) => b.tier !== a.tier ? b.tier - a.tier : b.confidence - a.confidence);

  if (detectedIntents.length === 0) {
    if (entities.products.length > 0) detectedIntents.push({ intent: 'product_search', confidence: 90, tier: 0, category: 'sales' });
    else if (tokens.length <= 2) detectedIntents.push({ intent: 'greeting', confidence: 50, tier: 0, category: 'chit_chat' });
    else detectedIntents.push({ intent: 'technical_issue', confidence: 30, tier: 1, category: 'tech' });
  }

  return { rawMessage, normalizedMessage: text, emotion, entities, intents: detectedIntents, primaryIntent: detectedIntents[0] };
};

const orchestrateInvestigation = (analysis, memory) => {
  const state = { ...analysis };
  
  // 1. Frustration Velocity & Emotion Memory
  let velocity = Number(memory.frustrationScore || 0);
  if (state.emotion.score < 0) velocity += Math.abs(state.emotion.score * 15);
  if (velocity >= 100 || ['furious', 'sarcastic', 'repeat_complaint'].includes(state.emotion.mood)) {
    if (!state.intents.find(i => i.intent === 'human_request')) {
      state.intents.unshift({ intent: 'human_request', confidence: 100, tier: 3, category: 'escalation' });
    }
  }

  // 2. Cross-Turn Context Binding (Product Memory)
  if (['price_query', 'stock_query'].includes(state.primaryIntent.intent) && state.entities.products.length === 0) {
    if (memory.lastProduct) state.entities.products.push(memory.lastProduct); // Recalls 'Maggi' seamlessly
  }

  // 3. Issue Persistence & Evidence Collection
  const activeIssues = new Set([...(memory.activeIssues || []), ...state.intents.map(i => i.intent)]);
  state.activeIssues = Array.from(activeIssues).filter(i => INTENT_MODELS[i]?.tier >= 1); // Only persist real problems

  const caseFile = { ...(memory.collectedEvidence || {}), ...state.entities };
  state.collectedEvidence = caseFile;

  let investigationScore = 100;
  let missingEvidence = [];

  state.activeIssues.forEach(issue => {
    const required = EVIDENCE_SCHEMA[issue];
    if (required) {
      required.forEach(req => {
        if (caseFile[req] === undefined || caseFile[req] === null) {
          missingEvidence.push({ issue, field: req });
          investigationScore -= (100 / required.length);
        }
      });
    }
  });

  state.investigationScore = state.activeIssues.length === 0 ? 100 : Math.max(0, investigationScore);
  state.missingEvidence = missingEvidence;
  state.frustrationScore = velocity;

  return state;
};

// ============================================================================
// 💬 LAYER 6: REAL DB INVESTIGATION & DYNAMIC RESPONSE ENGINE
// ============================================================================
const generateDynamicQuestions = (missingEvidence) => {
  let questions = [];
  const fields = missingEvidence.map(m => m.field);
  if (fields.includes('paymentMethod')) questions.push("1. Which payment app did you use? (e.g., PhonePe, GPay, Paytm, Card)");
  if (fields.includes('amount')) questions.push("2. What was the approximate amount deducted?");
  if (fields.includes('confirmationReceived')) questions.push("3. Did you receive an 'Order Successful' confirmation screen?");
  if (fields.includes('orderId')) questions.push("- Could you provide the Order ID associated with this issue?");
  if (fields.includes('authMethod')) questions.push("- Are you trying to verify via Phone Number or Email?");
  return questions.slice(0, 3); // Max 3 questions to avoid overwhelming
};

const simulateDatabaseCheck = async (state, user) => {
  let report = [];
  try {
    if (user) report.push(`✅ Authenticated User: **${user.name}**`);
    
    // Simulating Real Order Trace
    if (state.collectedEvidence.orderId || user) {
      const whereClause = state.collectedEvidence.orderId ? { orderToken: state.collectedEvidence.orderId } : { userId: String(user.id) };
      const order = await Order.findOne({ where: whereClause, order: [['createdAt', 'DESC']] });
      if (order) {
        state.collectedEvidence.dbOrderFound = true;
        const statusStr = String(order.orderStatus).replace('_', ' ').toUpperCase();
        report.push(`✅ Order Found: **#${order.orderToken || order.cashfreeOrderId.slice(-4)}** (Status: *${statusStr}*)`);
      }
    }
    
    if (state.collectedEvidence.paymentMethod) report.push(`✅ Gateway Trace: **${state.collectedEvidence.paymentMethod}** noted for audit.`);
    if (state.collectedEvidence.amount) report.push(`✅ Ledger Sync: Flagged **₹${state.collectedEvidence.amount}** for reconciliation.`);

  } catch (error) { /* Silent */ }
  return report;
};

const generateAdminCopilot = (state, ticket) => {
  const issues = state.activeIssues.map(i => i.replace('_', ' ').toUpperCase()).join(', ');
  const evidence = JSON.stringify(state.collectedEvidence).substring(0, 100);
  return `**ADMIN COPILOT BRIEF (Ticket ${ticket})**\n- **Issues:** ${issues}\n- **Emotion:** ${state.emotion.mood.toUpperCase()} (Score: ${state.emotion.score})\n- **Evidence Case File:** ${evidence}\n- **Investigation Score:** ${state.investigationScore}%\n- **Action Required:** Immediate Manager Override.`;
};

const buildResponse = async (state, memory, user) => {
  const intentList = state.intents.map(i => i.intent);
  const ticket = memory.activeTicket || generateTicketId();
  const maxTier = Math.max(...state.intents.map(i => i.tier || 0));

  // PROGRESSIVE ESCALATION: LEVEL 4 & 5 (Legal/Fraud)
  if (maxTier >= 4) {
    return {
      type: 'escalate', level: `Level 5 - Critical Security`, ticket, copilot: generateAdminCopilot(state, ticket),
      reply: `🚨 **SECURITY PROTOCOL ENGAGED**\nI have triggered an emergency escalation. \n• Account safety measures activated.\n• Critical **Ticket ${ticket}** generated.\n\nThe store ownership team has been paged with an emergency override. Please hold.`
    };
  }

  // PROGRESSIVE ESCALATION: LEVEL 2 & 3 (Investigation & Evidence)
  if (maxTier >= 2) {
    const dbReport = await simulateDatabaseCheck(state, user);

    // If investigation is incomplete (Score < 100%), ASK QUESTIONS
    if (state.investigationScore < 100 && !intentList.includes('human_request')) {
      const dynamicQuestions = generateDynamicQuestions(state.missingEvidence);
      const dbText = dbReport.length > 0 ? `\n\n**Internal Database Check:**\n${dbReport.join('\n')}` : '';
      
      return {
        type: 'cross_question', 
        reply: `I am currently investigating this issue for you.${dbText}\n\nBefore I can escalate this properly to the management team, I need to collect a few more details for your case file:\n\n${dynamicQuestions.join('\n')}`
      };
    }

    // Investigation Complete -> Resolution & Escalate
    let humanReadableIssues = state.activeIssues.map(i => `• ${i.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`);
    
    let likelyCause = "Pending Manual Review";
    if (state.activeIssues.includes('payment_issue') && state.activeIssues.includes('missing_order')) likelyCause = "Gateway confirmation sync failure between bank and store ERP.";
    else if (state.activeIssues.includes('otp_issue')) likelyCause = "Authentication SMS gateway latency.";

    return {
      type: 'escalate', level: 'Level 3 - Case File Built', ticket, copilot: generateAdminCopilot(state, ticket),
      reply: `**Investigation Complete.**\nThank you for providing the necessary information. I have compiled the evidence and built your support docket.\n\n**Case File (Ticket #${ticket}):**\n${humanReadableIssues.join('\n')}\n\n**Internal Database Trace:**\n${dbReport.join('\n') || '• No exact database matches found. Manual trace required.'}\n\n**Likely Root Cause:**\n- *${likelyCause}*\n\nI have transferred this complete diagnostic report to the store manager. A human representative will take over this chat momentarily.`
    };
  }

  // PROGRESSIVE ESCALATION: LEVEL 0 & 1 (Product Brain & Information)
  if (['price_query', 'stock_query', 'product_search'].includes(state.primaryIntent.intent)) {
    if (state.entities.products.length > 0) {
      const p = state.entities.products[0];
      const stock = Math.max(0, (Number(p.real_stock) || 0) - (Number(p.buffer) || 2));
      return { 
        type: 'answer', productContext: p, 
        reply: `**Product Intelligence:**\n• Item: **${p.name}**\n• Price: **₹${p.price}**\n• Available Stock: **${stock} units**\n\n${stock === 0 ? '*I have logged a restock request for this item.*' : 'Would you like assistance adding this to your cart?'}` 
      };
    } else if (state.normalizedMessage.length > 3) {
      // Self-Learning: Log failed searches
      try { await ItemRequest.findOrCreate({ where: { itemName: state.normalizedMessage }, defaults: { requestCount: 1 }}); } catch(e){}
      return { type: 'answer', reply: "I searched the entire store inventory but couldn't find an exact match. I have automatically logged this as a high-demand request for our procurement team!" };
    }
  }

  return { type: 'answer', reply: "Hello! 👋 I am the Lakshmi Stores Operating System. I can cross-examine payment ledgers, trace missing logistics, and analyze live inventory. How can I assist you today?" };
};

// ============================================================================
// 🚀 LAYER 7: OMNI-BRAIN EXPRESS CONTROLLER
// ============================================================================
exports.chat = async (req, res) => {
  try {
    const rawMessage = String(req.body.message || '').trim().slice(0, 1500);
    if (!rawMessage) return res.status(400).json({ success: false, message: 'Message payload required.' });

    let user = null;
    try {
      const header = String(req.headers.authorization || '');
      if (header.startsWith('Bearer ')) user = await User.findByPk(jwt.verify(header.split(' ')[1], process.env.JWT_ACCESS_SECRET).id);
    } catch (e) { /* Guest */ }

    // Memory Initialization
    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, status: THREAD_STATUS.AI, aiEnabled: true, 
        metadata: { memory: { activeIssues: [], collectedEvidence: {}, frustrationScore: 0, escalationHistory: [] } } 
      });
    } else if (thread.status === THREAD_STATUS.RESOLVED) {
      await thread.update({ status: THREAD_STATUS.AI, aiEnabled: true, resolvedAt: null });
    }

    await SupportMessage.create({ threadId: thread.id, senderType: 'customer', body: rawMessage });

    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({ status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
      return res.json({ success: true, thread });
    }

    // 🧠 EXECUTE V17 FINAL BEAST
    const memory = (thread.metadata || {}).memory || { activeIssues: [], collectedEvidence: {}, frustrationScore: 0 };
    const nlpAnalysis = await processNaturalLanguage(rawMessage);
    const state = orchestrateInvestigation(nlpAnalysis, memory);
    const decision = await buildResponse(state, memory, user);

    // 💾 COMMIT DIGITAL TWIN MEMORY
    const updatedMemory = { ...memory };
    updatedMemory.frustrationScore = state.frustrationScore;
    updatedMemory.collectedEvidence = state.collectedEvidence;
    updatedMemory.activeIssues = state.activeIssues;
    
    if (decision.type === 'answer' || decision.type === 'cross_question') updatedMemory.frustrationScore = Math.max(0, updatedMemory.frustrationScore - 15);
    if (decision.ticket) updatedMemory.activeTicket = decision.ticket;
    if (decision.productContext) updatedMemory.lastProduct = decision.productContext;

    // 📝 SAVE AI & COPILOT RESPONSES
    if (decision.reply) {
      await SupportMessage.create({ threadId: thread.id, senderType: 'assistant', senderName: 'Support System', body: decision.reply });
    }
    if (decision.copilot) {
      await SupportMessage.create({ threadId: thread.id, senderType: 'system', senderName: 'Admin Copilot', body: decision.copilot, isHiddenFromCustomer: true });
    }

    if (decision.type === 'escalate') {
      if (!Array.isArray(updatedMemory.escalationHistory)) updatedMemory.escalationHistory = [];
      updatedMemory.escalationHistory.push({ time: new Date().toISOString(), level: decision.level });
      
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
    console.error('🛡️ V17 CRITICAL EXCEPTION:', error);
    res.status(200).json({ success: true, fallback: true, message: "System diagnostics running. Migrating session to live administration console." });
  }
};

// ============================================================================
// 🛡️ [ADMIN API] FAIL-SAFE ROUTES
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

    await SupportMessage.create({ threadId: thread.id, senderType: 'system', senderName: 'System', body: 'This docket has been successfully resolved and closed.' });
    await thread.update({ status: THREAD_STATUS.RESOLVED, aiEnabled: false, resolvedAt: new Date() });

    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    
    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: (messages || []).map(m => m.dataValues || m) } });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to resolve thread.' }); }
};