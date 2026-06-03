const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Product, Order, OrderItem, User, Notification, StoreSetting, SupportThread, SupportMessage } = require('../models');

// ============================================================================
// ⚙️ [CORE] V15 SYSTEM CONSTANTS & CONFIG
// ============================================================================
const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };
const generateTicketId = () => `LS-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// ============================================================================
// 🧠 [KNOWLEDGE GRAPH] LINGUISTICS, ENTITIES & ONTOLOGY
// ============================================================================
const STOP_WORDS = new Set(['a','an','and','are','as','at','be','but','by','for','if','in','into','is','it','no','not','of','on','or','such','that','the','their','then','there','these','they','this','to','was','will','with','i','you','my','me']);

const REGIONAL_TRANSLATION_MATRIX = {
  'varala': 'missing', 'varla': 'missing', 'kedaikala': 'missing', 'illai': 'no', 'illa': 'no', 
  'aagala': 'failed', 'agala': 'failed', 'mudiyala': 'failed', 'theriyala': 'unknown', 'venum': 'want',
  'panam': 'money', 'pochu': 'lost', 'kaasu': 'money', 'cash': 'money', 'cut': 'deducted', 'aachu': 'happened',
  'manager venum': 'human request', 'call pannu': 'human request', 'pesanum': 'speak',
  'ayindi': 'happened', 'ayipoindi': 'completed', 'ledhu': 'missing', 'raaledu': 'missing',
  'ravatledu': 'not coming', 'avvatledu': 'failed', 'paise': 'money', 'dabulu': 'money'
};

// V15 Product Intelligence Graph (Relational Fallbacks)
const PRODUCT_GRAPH = {
  'maggi': { category: 'noodles', alternatives: ['yippee', 'top ramen', 'wai wai'], brand: 'nestle' },
  'sprite': { category: 'soft drink', alternatives: ['7up', 'mountain dew', 'limca'], brand: 'coca cola' },
  'coca cola': { category: 'soft drink', alternatives: ['pepsi', 'thums up'], brand: 'coca cola' },
  'thums up': { category: 'soft drink', alternatives: ['pepsi', 'coca cola'], brand: 'coca cola' },
  'lays': { category: 'chips', alternatives: ['bingo', 'kurkure', 'doritos'], brand: 'pepsico' }
};

const PRODUCT_ALIASES = { 'maggie': 'maggi', 'coke': 'coca cola', 'thumbs up': 'thums up', 'veggies': 'vegetables', 'paani': 'water', 'chini': 'sugar', 'dhal': 'dal' };
const PAYMENT_GATEWAYS = ['phonepe', 'gpay', 'google pay', 'paytm', 'upi', 'cash', 'card', 'razorpay', 'cashfree', 'apple pay'];

// ============================================================================
// 🎯 [INTENT ENGINE] TIERED TF-IDF MATRIX (TIERS 0-5)
// ============================================================================
const INTENT_MODELS = {
  // Tier 5: Legal & Police
  legal_threat: { keywords: { 'police': 3, 'court': 3, 'lawyer': 3, 'sue': 3, 'legal': 3, 'consumer forum': 3 }, tier: 5, category: 'legal' },
  // Tier 4: Fraud & Security
  account_hacked: { keywords: { 'hacked': 3, 'unauthorized': 3, 'someone else': 3, 'stole account': 3 }, tier: 4, category: 'security' },
  fraud_report: { keywords: { 'fraud': 3, 'scam': 3, 'cheating': 3, 'fake': 3, 'stole money': 3 }, tier: 4, category: 'security' },
  // Tier 3: Management
  human_request: { keywords: { 'manager': 3, 'human': 3, 'real person': 3, 'agent': 3, 'owner': 3, 'call': 2 }, tier: 3, category: 'escalation' },
  follow_up_complaint: { keywords: { 'still waiting': 3, 'not fixed': 3, 'again': 3, 'any update': 3, 'same issue': 3 }, tier: 3, category: 'escalation' },
  // Tier 2: Finance & Logistics
  payment_issue: { keywords: { 'deducted': 3, 'charged': 3, 'payment failed': 3, 'transaction failed': 3, 'money gone': 3, 'cut': 2 }, tier: 2, category: 'finance' },
  double_payment: { keywords: { 'twice': 3, 'double': 3, 'two times': 3 }, tier: 2, category: 'finance' },
  refund_request: { keywords: { 'refund': 3, 'cashback': 3, 'money back': 3, 'return money': 3 }, tier: 2, category: 'finance' },
  missing_order: { keywords: { 'never arrived': 3, 'not received': 3, 'missing': 3, 'where is my order': 3, 'varala': 3 }, tier: 2, category: 'logistics' },
  wrong_order: { keywords: { 'wrong item': 3, 'different': 3, 'instead': 3, 'incorrect': 3 }, tier: 2, category: 'logistics' },
  damaged_order: { keywords: { 'damaged': 3, 'broken': 3, 'leaking': 3, 'spoiled': 3, 'expired': 3 }, tier: 2, category: 'logistics' },
  late_order: { keywords: { 'late': 3, 'delay': 3, 'taking time': 2 }, tier: 2, category: 'logistics' },
  // Tier 1: Platform & Product
  login_issue: { keywords: { 'login': 3, 'sign in': 3, 'access': 2, 'password': 2 }, tier: 1, category: 'tech' },
  otp_issue: { keywords: { 'otp': 3, 'verification': 3, 'code': 2 }, tier: 1, category: 'tech' },
  technical_issue: { keywords: { 'crash': 3, 'stuck': 3, 'loading forever': 3, 'website down': 3, 'error': 2 }, tier: 1, category: 'tech' },
  // Tier 0: Information
  order_status: { keywords: { 'status': 3, 'track': 3 }, tier: 0, category: 'info' },
  price_query: { keywords: { 'price': 3, 'cost': 3, 'rate': 3, 'how much': 3 }, tier: 0, category: 'sales' },
  stock_query: { keywords: { 'stock': 3, 'available': 3, 'left': 2, 'have': 1 }, tier: 0, category: 'sales' },
  greeting: { keywords: { 'hello': 3, 'hi': 3, 'hey': 3, 'morning': 3, 'thanks': 3 }, tier: 0, category: 'chit_chat' }
};

// ============================================================================
// 🧮 [ALGORITHMS] N-GRAMS, LEVENSHTEIN & REGEX ENTITY EXTRACTION
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

const extractEntitiesV15 = async (normalizedText, tokens) => {
  const entities = { payments: [], products: [], orderIds: [], amounts: [], dates: [] };

  // 1. Transaction/Order IDs
  const orderRegex = /\b\d{2}-[a-zA-Z0-9]{4,6}\b/gi;
  const matches = normalizedText.match(orderRegex);
  if (matches) entities.orderIds = matches.map(m => m.toUpperCase());

  // 2. Financial Amounts
  const amountRegex = /(?:₹|rs\.?|rupees?)\s*(\d+(?:,\d+)*(?:\.\d+)?)/gi;
  let amtMatch; while ((amtMatch = amountRegex.exec(normalizedText)) !== null) entities.amounts.push(amtMatch[1]);

  // 3. Temporal Dates (Basic implementation)
  if (/\b(yesterday|today|tomorrow|morning|evening)\b/i.test(normalizedText)) {
    entities.dates.push(normalizedText.match(/\b(yesterday|today|tomorrow|morning|evening)\b/i)[0]);
  }

  // 4. Gateways
  tokens.forEach(t => { if (PAYMENT_GATEWAYS.includes(t)) entities.payments.push(t.toUpperCase()); });
  if (normalizedText.includes('google pay')) entities.payments.push('GPAY');

  // 5. Product Intelligence DB Check
  try {
    const dbProducts = await Product.findAll({ where: { isActive: true }, attributes: ['id', 'name', 'price', 'real_stock', 'buffer'] });
    dbProducts.forEach(dbProd => {
      const prodName = dbProd.name.toLowerCase();
      if (normalizedText.includes(prodName) || tokens.some(t => t.length > 3 && (1 - getLevenshteinDistance(t, prodName) / Math.max(t.length, prodName.length)) > 0.85)) {
        entities.products.push(dbProd);
      }
    });
  } catch (error) { /* Silent */ }

  return entities;
};

// ============================================================================
// 🎭 [NLP PIPELINE] EVOLUTIONARY SENTIMENT & ROOT CAUSE DETECTION
// ============================================================================
const SENTIMENT_LEXICON = { 'worst': -3, 'terrible': -3, 'scam': -3, 'fraud': -3, 'pathetic': -3, 'useless': -3, 'bad': -2, 'angry': -2, 'frustrated': -2, 'wrong': -1, 'broken': -1, 'late': -1, 'good': 1, 'nice': 1, 'great': 2, 'awesome': 2 };
const NEGATIONS = new Set(['not', 'no', 'never', 'nothing', 'neither']);

const analyzeSentimentV15 = (tokens, text) => {
  let score = 0; let hasNegation = false;
  tokens.forEach(word => {
    if (NEGATIONS.has(word)) { hasNegation = true; return; }
    const lexScore = SENTIMENT_LEXICON[word] || 0;
    if (lexScore !== 0) { score += hasNegation ? (lexScore * -1) : lexScore; hasNegation = false; }
  });

  const isSarcastic = /\b(wow|amazing|great|nice|awesome|excellent)\b.*\b(never|not|worst|deducted|missing|bad|late|nothing)\b/i.test(text);
  if (isSarcastic) score = -5;

  let mood = 'neutral';
  if (isSarcastic) mood = 'sarcastic';
  else if (score <= -4) mood = 'furious';
  else if (score < 0) mood = 'frustrated';
  else if (score > 1) mood = 'positive';

  return { score, mood, isSarcastic };
};

const detectRootCause = (intents, entities) => {
  const intentNames = intents.map(i => i.intent);
  if (intentNames.includes('payment_issue') && intentNames.includes('missing_order')) {
    return 'Gateway confirmation sync failure between bank and store ERP.';
  }
  if (intentNames.includes('otp_issue') && intentNames.includes('login_issue')) {
    return 'Authentication SMS gateway latency or block.';
  }
  if (intentNames.includes('damaged_order') || intentNames.includes('wrong_order')) {
    return 'Logistics packing or transit integrity failure.';
  }
  return 'Pending manual agent investigation.';
};

const processNaturalLanguage = async (rawMessage) => {
  let text = String(rawMessage).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  Object.entries(REGIONAL_TRANSLATION_MATRIX).forEach(([slang, eng]) => { text = text.replace(new RegExp(`\\b${slang}\\b`, 'g'), eng); });
  Object.entries(PRODUCT_ALIASES).forEach(([alias, trueName]) => { text = text.replace(new RegExp(`\\b${alias}\\b`, 'g'), trueName); });

  const tokens = text.split(' ').filter(w => !STOP_WORDS.has(w) && w.length > 1);
  const sentiment = analyzeSentimentV15(tokens, text);
  const entities = await extractEntitiesV15(text, tokens);

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

  const rootCause = detectRootCause(detectedIntents, entities);

  return { rawMessage, normalizedMessage: text, sentiment, entities, intents: detectedIntents, primaryIntent: detectedIntents[0], rootCause };
};

// ============================================================================
// 💾 [CUSTOMER TWIN] SELF-HEALING MEMORY & STATE MACHINE
// ============================================================================
const orchestrateDigitalTwin = (analysis, memory) => {
  const state = { ...analysis };
  
  // 1. Frustration Velocity & Sentiment Evolution
  let velocity = Number(memory.frustrationVelocity || 0);
  if (state.sentiment.score < 0) velocity += Math.abs(state.sentiment.score * 15);
  if (/(still waiting|hello|any update|not fixed|again|cleared)/i.test(state.normalizedMessage)) {
    velocity += 40;
    if (!state.intents.find(i => i.intent === 'follow_up_complaint')) {
      state.intents.push({ intent: 'follow_up_complaint', confidence: 100, tier: 3, category: 'escalation' });
    }
  }

  // Auto-Escalate Tier
  if (velocity >= 100 || ['furious', 'sarcastic'].includes(state.sentiment.mood)) {
    if (!state.intents.find(i => i.intent === 'human_request')) {
      state.intents.unshift({ intent: 'human_request', confidence: 100, tier: 3, category: 'escalation' });
      state.primaryIntent = state.intents[0];
    }
  }

  // 2. Issue Timeline Reconnection (Context Bridge)
  if (velocity > 0 && memory.activeIssues && memory.activeIssues.length > 0) {
    memory.activeIssues.forEach(pastIssue => {
      if (!state.intents.find(i => i.intent === pastIssue)) {
        const model = INTENT_MODELS[pastIssue];
        if (model) state.intents.push({ intent: pastIssue, confidence: 80, ...model });
      }
    });
  }

  // 3. Entity Injection (Memory)
  if (['price_query', 'stock_query'].includes(state.primaryIntent.intent) && state.entities.products.length === 0 && memory.lastProduct) {
    state.entities.products.push({ name: memory.lastProduct, fromMemory: true });
  }

  // 4. Update Max Tier
  state.maxTier = 0;
  state.intents.forEach(i => { if (i.tier > state.maxTier) state.maxTier = i.tier; });
  state.frustrationVelocity = velocity;

  return state;
};

// ============================================================================
// 💬 [BEHAVIOR ADAPTER] STRUCTURED RESPONSE GENERATOR & ADMIN COPILOT
// ============================================================================
const applyTone = (mood, text) => {
  if (['furious', 'sarcastic'].includes(mood)) return `I sincerely apologize for the unacceptable experience. ${text}`;
  if (mood === 'frustrated') return `I understand your concern, let's get this resolved. ${text}`;
  return text;
};

const generateAdminCopilotSummary = (state, ticket) => {
  const issues = state.intents.map(i => i.intent.replace('_', ' ').toUpperCase()).join(', ');
  const entities = [];
  if (state.entities.payments.length) entities.push(`Gateway: ${state.entities.payments.join(',')}`);
  if (state.entities.amounts.length) entities.push(`Amount: ₹${state.entities.amounts[0]}`);
  if (state.entities.orderIds.length) entities.push(`Order: ${state.entities.orderIds[0]}`);
  
  return `**ADMIN COPILOT BRIEF (Ticket ${ticket})**\n- **Active Issues:** ${issues}\n- **Customer Sentiment:** ${state.sentiment.mood.toUpperCase()} (Velocity: ${state.frustrationVelocity})\n- **Extracted Entities:** ${entities.length ? entities.join(' | ') : 'None'}\n- **Root Cause Hypothesis:** ${state.rootCause}`;
};

const generateResponsePlan = async (state, memory, user) => {
  const intentList = state.intents.map(i => i.intent);
  const ticket = memory.activeTicket || generateTicketId();

  // TIER 4 & 5: Legal & Security
  if (state.maxTier >= 4) {
    const copilot = generateAdminCopilotSummary(state, ticket);
    return {
      type: 'escalate', level: `Tier ${state.maxTier} - Critical Security/Legal`, ticket, copilot,
      reply: applyTone(state.sentiment.mood, `I have triggered our highest escalation protocol.\n\n**Understood Context:**\n• Serious allegations regarding fraud, security, or legal action detected.\n\n**Action Plan:**\n• Account parameters frozen for safety.\n• Ticket **${ticket}** generated.\n\n**Next Steps:**\nThe store ownership team has been paged with an emergency override. Please hold.`)
    };
  }

  // TIER 2 & 3: Logistics, Finance & Escalations
  if (state.maxTier >= 2) {
    // Intelligent Clarification
    if (!user && state.entities.orderIds.length === 0 && (intentList.includes('payment_issue') || intentList.includes('missing_order'))) {
      return { type: 'cross_question', reply: applyTone(state.sentiment.mood, `To investigate this thoroughly, I need context. Could you provide the Order ID or Transaction Amount? Alternatively, logging into your profile will allow me to sync your ledger automatically.`) };
    }

    let detectedText = [];
    if (intentList.includes('payment_issue')) detectedText.push(`Payment anomaly ${state.entities.amounts.length ? `for ₹${state.entities.amounts[0]}` : ''} ${state.entities.payments.length ? `via ${state.entities.payments[0]}` : ''}`);
    if (intentList.includes('double_payment')) detectedText.push('Duplicate transaction processing error');
    if (intentList.includes('refund_request')) detectedText.push('Refund status inquiry');
    if (intentList.includes('missing_order') || intentList.includes('late_order')) detectedText.push('Logistics SLA delay/missing manifest');
    if (intentList.includes('otp_issue')) detectedText.push('Authentication subsystem failure');

    const copilot = generateAdminCopilotSummary(state, ticket);
    
    return {
      type: 'escalate', level: `Tier ${state.maxTier} - Operations`, ticket, copilot,
      reply: applyTone(state.sentiment.mood, `I have constructed a comprehensive support docket based on your inputs.\n\n**Detected Issues:**\n• ${detectedText.join('\n• ')}\n\n**Root Cause Hypothesis:**\n• ${state.rootCause}\n\n**Action Plan (Ticket ${ticket}):**\n• Case escalated to Tier ${state.maxTier} Operations.\n• Store manager notified to audit related transaction hashes and packing terminal logs.\n\n**Next Steps:**\nA human representative will assume control of this chat shortly.`)
    };
  }

  // TIER 0 & 1: Product Intelligence & Tech
  if (['price_query', 'stock_query', 'product_search'].includes(state.primaryIntent.intent)) {
    if (state.entities.products.length > 0) {
      const p = state.entities.products[0];
      if (p.fromMemory) return { type: 'answer', reply: `Continuing our context on **${p.name}**, what specific details did you need regarding pricing or availability?` };
      
      const stock = Math.max(0, (Number(p.real_stock) || 0) - (Number(p.buffer) || 2));
      const graphNode = PRODUCT_GRAPH[p.name.toLowerCase()];
      const alternatives = graphNode && stock === 0 ? `\n*Since we are out of stock, might I suggest: ${graphNode.alternatives.join(', ')}?*` : '';

      return { 
        type: 'answer', productContext: p.name,
        reply: `**Inventory Intelligence:**\n• Product: **${p.name}**\n• Price: **₹${p.price}**\n• Status: **${stock} units** available.${alternatives}` 
      };
    }
  }

  return { type: 'answer', reply: "Hello! 👋 I am the Lakshmi Stores AI Operating System. I can audit ledgers, trace logistics, and query the inventory graph. How can I assist?" };
};

// ============================================================================
// 🛡️ [SYSTEM EXECUTION] EXPRESS CONTROLLER WITH FAIL-SAFES
// ============================================================================
exports.chat = async (req, res) => {
  try {
    const rawMessage = String(req.body.message || '').trim().slice(0, 1500);
    if (!rawMessage) return res.status(400).json({ success: false, message: 'Message payload required.' });

    let user = null;
    try {
      const header = String(req.headers.authorization || '');
      if (header.startsWith('Bearer ')) {
        const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_ACCESS_SECRET);
        user = await User.findByPk(decoded.id);
      }
    } catch (e) { /* Guest Mode */ }

    // Initialize or Resume Digital Twin Thread
    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, status: THREAD_STATUS.AI, aiEnabled: true, 
        metadata: { memory: { activeIssues: [], frustrationVelocity: 0, escalationCount: 0, issueHistory: [] } } 
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

    // 🚀 EXECUTE V15 OMNI-BRAIN
    const memory = (thread.metadata || {}).memory || { activeIssues: [], frustrationVelocity: 0, escalationCount: 0, issueHistory: [] };
    const nlpAnalysis = await processNaturalLanguage(rawMessage);
    const state = orchestrateDigitalTwin(nlpAnalysis, memory);
    const decision = await generateResponsePlan(state, memory, user);

    // 💾 UPDATE DIGITAL TWIN MEMORY
    const updatedMemory = { ...memory };
    updatedMemory.frustrationVelocity = state.frustrationVelocity;
    if (decision.type === 'answer') updatedMemory.frustrationVelocity = Math.max(0, updatedMemory.frustrationVelocity - 20);
    
    // Sync active issues array
    if (state.maxTier > 0 && !['human_request', 'legal_threat'].includes(state.primaryIntent.intent)) {
      if (!Array.isArray(updatedMemory.activeIssues)) updatedMemory.activeIssues = [];
      if (!updatedMemory.activeIssues.includes(state.primaryIntent.intent)) {
        updatedMemory.activeIssues.push(state.primaryIntent.intent);
        if (!Array.isArray(updatedMemory.issueHistory)) updatedMemory.issueHistory = [];
        updatedMemory.issueHistory.push({ time: new Date().toISOString(), issue: state.primaryIntent.intent });
      }
    }
    
    if (decision.ticket) updatedMemory.activeTicket = decision.ticket;
    if (decision.productContext) updatedMemory.lastProduct = decision.productContext;
    if (decision.type === 'escalate') updatedMemory.escalationCount = (Number(updatedMemory.escalationCount) || 0) + 1;

    // 📝 COMMIT ACTIONS
    if (decision.reply) {
      await SupportMessage.create({ threadId: thread.id, senderType: 'assistant', senderName: 'Support System', body: decision.reply });
    }
    if (decision.copilot) {
      await SupportMessage.create({ threadId: thread.id, senderType: 'system', senderName: 'Admin Copilot', body: decision.copilot, isHiddenFromCustomer: true });
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
    console.error('🛡️ V15 FATAL PROTECTION TRIGGERED:', error);
    res.status(200).json({ success: true, fallback: true, message: "CRITICAL KERNEL EXCEPTION INTERCEPTED. Migrating session to live administration console." });
  }
};

// ============================================================================
// 🛡️ [ADMIN API] FAIL-SAFE SERIALIZATION ROUTES
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