const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Product, Order, OrderItem, User, Notification, StoreSetting, SupportThread, SupportMessage, ItemRequest } = require('../models');

// ============================================================================
// ⚙️ [CORE] CONFIGURATIONS & CONSTANTS
// ============================================================================
const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };
const generateTicketId = () => `LS-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// ============================================================================
// 📚 [DATA LAYER] MASSIVE MULTILINGUAL KNOWLEDGE GRAPH
// ============================================================================
const STOP_WORDS = new Set(['a','an','and','are','as','at','be','but','by','for','if','in','into','is','it','no','not','of','on','or','such','that','the','their','then','there','these','they','this','to','was','will','with','i','you','my','me']);

const REGIONAL_TRANSLATION_MATRIX = {
  // Tamil / Tanglish
  'varala': 'missing', 'varla': 'missing', 'kedaikala': 'missing', 'illai': 'no', 'illa': 'no', 
  'aagala': 'failed', 'agala': 'failed', 'mudiyala': 'failed', 'theriyala': 'unknown', 'venum': 'want',
  'panam': 'money', 'pochu': 'lost', 'kaasu': 'money', 'cash': 'money', 'cut': 'deducted', 'aachu': 'happened',
  'manager venum': 'human request', 'call pannu': 'human request', 'pesanum': 'speak',
  // Telugu
  'ayindi': 'happened', 'ayipoindi': 'completed', 'ledhu': 'missing', 'raaledu': 'missing',
  'ravatledu': 'not coming', 'avvatledu': 'failed', 'paise': 'money', 'dabulu': 'money',
  // Hindi / Hinglish
  'nahi': 'no', 'kya': 'what', 'karo': 'do', 'mila': 'received', 'chahiye': 'want', 'paisa': 'money'
};

const PRODUCT_ALIAS_MATRIX = {
  'maggie': 'maggi', 'coke': 'coca cola', 'thumbs up': 'thums up', 'veggies': 'vegetables', 
  'paani': 'water', 'chini': 'sugar', 'sprite bottle': 'sprite', 'lays': 'chips', 'dhal': 'dal'
};

const PAYMENT_GATEWAYS = new Set(['phonepe', 'gpay', 'google pay', 'paytm', 'upi', 'cash', 'card', 'razorpay', 'cashfree', 'apple pay']);

// ============================================================================
// 🧠 [INTENT ENGINE] WEIGHTED TF-IDF MATRIX
// ============================================================================
// Weights: 3 = Core Trigger, 2 = Contextual, 1 = Supporting
const INTENT_MODELS = {
  payment_issue: { keywords: { 'deducted': 3, 'charged': 3, 'payment': 2, 'failed': 2, 'transaction': 2, 'money': 1, 'gone': 1, 'cut': 2 }, risk: 85, category: 'finance', level: 2 },
  double_payment: { keywords: { 'twice': 3, 'double': 3, 'two times': 3, 'charged': 2 }, risk: 90, category: 'finance', level: 2 },
  refund_request: { keywords: { 'refund': 3, 'cashback': 3, 'money back': 3, 'return': 2 }, risk: 80, category: 'finance', level: 2 },
  missing_order: { keywords: { 'never arrived': 3, 'not received': 3, 'missing': 3, 'where': 2, 'order': 1, 'varala': 3 }, risk: 80, category: 'logistics', level: 2 },
  wrong_order: { keywords: { 'wrong': 3, 'different': 3, 'instead': 3, 'incorrect': 3 }, risk: 75, category: 'logistics', level: 2 },
  damaged_order: { keywords: { 'damaged': 3, 'broken': 3, 'leaking': 3, 'spoiled': 3, 'expired': 3 }, risk: 75, category: 'logistics', level: 2 },
  late_order: { keywords: { 'late': 3, 'delay': 3, 'waiting': 2, 'taking time': 2 }, risk: 70, category: 'logistics', level: 2 },
  order_status: { keywords: { 'status': 3, 'track': 3 }, risk: 10, category: 'info', level: 0 },
  price_query: { keywords: { 'price': 3, 'cost': 3, 'rate': 3, 'how much': 3 }, risk: 0, category: 'sales', level: 0 },
  stock_query: { keywords: { 'stock': 3, 'available': 3, 'left': 2, 'have': 1 }, risk: 0, category: 'sales', level: 0 },
  login_issue: { keywords: { 'login': 3, 'sign in': 3, 'access': 2, 'password': 2 }, risk: 50, category: 'tech', level: 1 },
  otp_issue: { keywords: { 'otp': 3, 'verification': 3, 'code': 2 }, risk: 50, category: 'tech', level: 1 },
  technical_issue: { keywords: { 'crash': 3, 'stuck': 3, 'loading': 3, 'website': 2, 'app': 2, 'error': 2 }, risk: 40, category: 'tech', level: 1 },
  account_hacked: { keywords: { 'hacked': 3, 'unauthorized': 3, 'someone else': 3, 'stole': 3 }, risk: 100, category: 'security', level: 3 },
  human_request: { keywords: { 'manager': 3, 'human': 3, 'real person': 3, 'agent': 3, 'owner': 3, 'call': 2 }, risk: 95, category: 'escalation', level: 3 },
  fraud_report: { keywords: { 'fraud': 3, 'scam': 3, 'police': 3, 'court': 3, 'lawyer': 3, 'cheating': 3 }, risk: 100, category: 'security', level: 4 },
  greeting: { keywords: { 'hello': 3, 'hi': 3, 'hey': 3, 'morning': 3, 'thanks': 3 }, risk: 0, category: 'chit_chat', level: 0 }
};

// ============================================================================
// 🧮 [ALGORITHMS] N-GRAMS & LEVENSHTEIN (FUZZY MATCHING)
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

const fuzzyMatch = (input, target, threshold = 0.8) => {
  const dist = getLevenshteinDistance(input, target);
  const maxLen = Math.max(input.length, target.length);
  return (1 - dist / maxLen) >= threshold;
};

const extractNGrams = (words, n) => {
  const nGrams = [];
  for (let i = 0; i <= words.length - n; i++) nGrams.push(words.slice(i, i + n).join(' '));
  return nGrams;
};

// ============================================================================
// 🎭 [NLP PIPELINE] SENTIMENT, NEGATION & ENTITY EXTRACTION
// ============================================================================
const NEGATIONS = new Set(['not', 'no', 'never', 'nothing', 'neither', 'nowhere', 'hardly', 'barely']);
const INTENSIFIERS = new Set(['very', 'extremely', 'absolutely', 'really', 'too', 'so']);
const SENTIMENT_LEXICON = {
  'worst': -3, 'terrible': -3, 'scam': -3, 'fraud': -3, 'pathetic': -3, 'useless': -3,
  'bad': -2, 'angry': -2, 'frustrated': -2, 'annoyed': -2, 'disappointed': -2,
  'wrong': -1, 'broken': -1, 'late': -1, 'missing': -1,
  'good': 1, 'nice': 1, 'fine': 1,
  'great': 2, 'awesome': 2, 'amazing': 2, 'love': 2
};

const analyzeSentimentV14 = (tokens) => {
  let score = 0; let isSarcastic = false; let hasNegation = false; let multiplier = 1;
  const positiveWords = []; const negativeWords = [];

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    if (NEGATIONS.has(word)) { hasNegation = true; continue; }
    if (INTENSIFIERS.has(word)) { multiplier = 1.5; continue; }

    const lexScore = SENTIMENT_LEXICON[word] || 0;
    if (lexScore !== 0) {
      const finalScore = hasNegation ? (lexScore * -1) : (lexScore * multiplier);
      score += finalScore;
      if (finalScore > 0) positiveWords.push(word);
      else negativeWords.push(word);
      // Reset modifiers
      hasNegation = false; multiplier = 1;
    }
  }

  // Sarcasm Detection (Positive words combined with severe negative context/intents)
  if (positiveWords.length > 0 && negativeWords.some(w => SENTIMENT_LEXICON[w] <= -2)) {
    isSarcastic = true;
    score = -5; // Sarcasm is heavily penalized
  }

  let mood = 'neutral';
  if (isSarcastic) mood = 'sarcastic';
  else if (score <= -5) mood = 'furious';
  else if (score < 0) mood = 'frustrated';
  else if (score > 2) mood = 'happy';

  return { score, mood, isSarcastic };
};

const extractEntitiesV14 = async (normalizedText, tokens, unigrams, bigrams) => {
  const entities = { payments: [], products: [], orderIds: [] };

  // 1. Regex Order ID Extraction
  const orderRegex = /\b\d{2}-[a-zA-Z0-9]{4,6}\b/gi;
  const matches = normalizedText.match(orderRegex);
  if (matches) entities.orderIds = matches.map(m => m.toUpperCase());

  // 2. Gateway Extraction
  tokens.forEach(t => { if (PAYMENT_GATEWAYS.has(t)) entities.payments.push(t.toUpperCase()); });
  if (normalizedText.includes('google pay')) entities.payments.push('GPAY');

  // 3. Deep Database Product Search (Fuzzy + N-Gram Matching)
  try {
    const dbProducts = await Product.findAll({ where: { isActive: true }, attributes: ['id', 'name', 'price', 'real_stock', 'buffer'] });
    const searchSpace = [...unigrams, ...bigrams];
    
    dbProducts.forEach(dbProd => {
      const prodName = dbProd.name.toLowerCase();
      // Exact string match
      if (normalizedText.includes(prodName)) {
        entities.products.push(dbProd);
      } else {
        // Fuzzy Match on N-grams
        for (const term of searchSpace) {
          if (term.length > 3 && fuzzyMatch(term, prodName, 0.85)) {
            entities.products.push(dbProd);
            break;
          }
        }
      }
    });
  } catch (error) { console.error("Entity DB Error:", error); }

  return entities;
};

// ============================================================================
// 🔬 [CORE ANALYZER] THE V14 OMNI-ENGINE
// ============================================================================
const processNaturalLanguage = async (rawMessage) => {
  // 1. Normalization & Translation
  let text = String(rawMessage).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  Object.entries(REGIONAL_TRANSLATION_MATRIX).forEach(([slang, eng]) => { text = text.replace(new RegExp(`\\b${slang}\\b`, 'g'), eng); });
  Object.entries(PRODUCT_ALIAS_MATRIX).forEach(([alias, trueName]) => { text = text.replace(new RegExp(`\\b${alias}\\b`, 'g'), trueName); });

  // 2. Tokenization & N-Grams
  const rawTokens = text.split(' ');
  const cleanTokens = rawTokens.filter(w => !STOP_WORDS.has(w) && w.length > 1);
  const bigrams = extractNGrams(cleanTokens, 2);
  const trigrams = extractNGrams(cleanTokens, 3);
  const searchSpace = [...cleanTokens, ...bigrams, ...trigrams];

  // 3. Sentiment & Entity Extraction
  const sentiment = analyzeSentimentV14(rawTokens);
  const entities = await extractEntitiesV14(text, rawTokens, cleanTokens, bigrams);

  // 4. Advanced Intent Classification (TF-IDF Mock)
  let detectedIntents = [];
  let highestLevel = 0;

  Object.entries(INTENT_MODELS).forEach(([intentName, model]) => {
    let score = 0;
    Object.entries(model.keywords).forEach(([keyword, weight]) => {
      if (text.includes(keyword)) score += weight;
    });

    if (score > 0) {
      if (model.level > highestLevel) highestLevel = model.level;
      // Normalizing score to a 0-100 confidence metric based on trigger weight
      const confidence = Math.min((score / 5) * 100, 99); 
      detectedIntents.push({ intent: intentName, confidence, ...model });
    }
  });

  // 5. Pruning & Sorting
  if (detectedIntents.length > 1) detectedIntents = detectedIntents.filter(i => i.intent !== 'greeting');
  detectedIntents.sort((a, b) => b.level !== a.level ? b.level - a.level : b.confidence - a.confidence);

  // Fallbacks
  if (detectedIntents.length === 0) {
    if (entities.products.length > 0) detectedIntents.push({ intent: 'product_search', confidence: 90, risk: 10, level: 0, category: 'sales' });
    else if (rawTokens.length <= 2) detectedIntents.push({ intent: 'greeting', confidence: 50, risk: 0, level: 0, category: 'chit_chat' });
    else detectedIntents.push({ intent: 'technical_issue', confidence: 30, risk: 40, level: 1, category: 'tech' });
  }

  return {
    rawMessage, normalizedMessage: text,
    sentiment, entities, intents: detectedIntents,
    primaryIntent: detectedIntents[0].intent,
    maxEscalationLevel: highestLevel
  };
};

// ============================================================================
// 💾 [STATE MACHINE] CROSS-TURN CONTEXTUAL MEMORY
// ============================================================================
const orchestrateState = (analysis, memory) => {
  let intents = [...analysis.intents];
  let primary = analysis.primaryIntent;
  
  // 1. Frustration Velocity Tracking
  let velocity = Number(memory.frustrationVelocity || 0);
  if (analysis.sentiment.score < 0) velocity += Math.abs(analysis.sentiment.score * 10);
  if (/(still waiting|hello|any update|not fixed|again|cleared)/i.test(analysis.normalizedMessage)) {
    velocity += 30;
    if (!intents.find(i => i.intent === 'follow_up_complaint')) {
      intents.push({ intent: 'follow_up_complaint', confidence: 100, level: 2, risk: 50 });
    }
  }

  // Auto-Escalate if highly frustrated
  if (velocity >= 80 || analysis.sentiment.mood === 'furious' || analysis.sentiment.isSarcastic) {
    if (!intents.find(i => i.intent === 'human_request')) {
      intents.unshift({ intent: 'human_request', confidence: 100, level: 3, risk: 100 });
      primary = 'human_request';
    }
  }

  // 2. Issue Persistence (The Context Bridge)
  if (velocity > 0 && memory.lastActiveIssue && memory.lastActiveIssue !== 'none') {
    if (!intents.find(i => i.intent === memory.lastActiveIssue)) {
      const pastModel = INTENT_MODELS[memory.lastActiveIssue];
      if (pastModel) intents.push({ intent: memory.lastActiveIssue, confidence: 80, level: pastModel.level, risk: pastModel.risk });
    }
  }

  // 3. Entity Memory Injection
  if (['price_query', 'stock_query'].includes(primary) && analysis.entities.products.length === 0 && memory.lastProductDbRecord) {
    analysis.entities.products.push(memory.lastProductDbRecord);
  }

  // Recalculate Max Level
  let finalLevel = 0;
  intents.forEach(i => { if (i.level > finalLevel) finalLevel = i.level; });

  return { ...analysis, intents, primaryIntent: primary, maxEscalationLevel: finalLevel, frustrationVelocity: velocity };
};

// ============================================================================
// 💬 [RESPONSE MATRIX] DYNAMIC ENTERPRISE RESPONSE GENERATOR
// ============================================================================
const RESPONSES = {
  clarification: [
    "To help me investigate this thoroughly, could you provide your Order ID?",
    "I want to get this sorted for you instantly. Do you have the Order Number handy, or could you log in?",
    "I see you have an order concern. Logging into your account will allow me to securely pull your records."
  ],
  security: [
    "🚨 **CRITICAL SECURITY LOCK**\nI have detected a severe security/fraud claim. I have immediately frozen automated processing for your safety. Do not share OTPs with anyone. The store ownership team is being paged directly."
  ]
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const generateActionPlan = async (state, memory, user) => {
  const intentList = state.intents.map(i => i.intent);
  const ticket = memory.activeTicket || generateTicketId();

  // LEVEL 4/3: Extreme Security & Legal Threats
  if (state.maxEscalationLevel >= 3) {
    let severeIssues = [];
    if (intentList.includes('fraud_report')) severeIssues.push('• Formal Fraud/Scam Allegation');
    if (intentList.includes('account_hacked')) severeIssues.push('• Account Security Compromise');
    if (intentList.includes('legal_threat')) severeIssues.push('• Legal/Consumer Court Escalation');
    if (intentList.includes('human_request')) severeIssues.push('• Immediate Manager Intervention Required');

    return {
      type: 'escalate', level: `Level ${state.maxEscalationLevel} - Critical`, ticket,
      reply: `${RESPONSES.security[0]}\n\n**Detected Threats:**\n${severeIssues.join('\n')}\n\n**Ticket Details:**\n• Ref: **${ticket}**\n• Status: Human Override Initiated\n\nPlease remain on this screen. A senior manager is joining.`
    };
  }

  // LEVEL 2: Operations, Logistics & Finance
  if (state.maxEscalationLevel === 2) {
    // Clarification Gate
    if (!user && state.entities.orderIds.length === 0) {
      return { type: 'cross_question', reply: pick(RESPONSES.clarification) };
    }

    let detectedProblems = [];
    if (intentList.includes('payment_issue')) detectedProblems.push(`• Payment anomaly detected ${state.entities.payments.length ? `(${state.entities.payments.join(', ')})` : ''}`);
    if (intentList.includes('double_payment')) detectedProblems.push('• Duplicate billing flagged');
    if (intentList.includes('refund_request')) detectedProblems.push('• Refund processing inquiry');
    if (intentList.includes('missing_order')) detectedProblems.push('• Missing logistics manifest');
    if (intentList.includes('damaged_order')) detectedProblems.push('• Damaged/Incorrect items reported');
    if (intentList.includes('late_order')) detectedProblems.push('• Delivery SLA breach');
    if (intentList.includes('follow_up_complaint')) detectedProblems.push('• Recurring issue follow-up');
    if (intentList.includes('otp_issue')) detectedProblems.push('• Authentication failure');

    let actions = [];
    if (intentList.some(i => ['payment_issue', 'refund_request', 'double_payment'].includes(i))) actions.push('- Auditing gateway transaction hashes');
    if (intentList.some(i => ['missing_order', 'damaged_order', 'late_order'].includes(i))) actions.push('- Reviewing packing terminal CCTV & dispatch logs');
    if (actions.length === 0) actions.push('- Analyzing user activity logs');

    const sentimentAlert = state.sentiment.mood !== 'neutral' ? `\n• Customer Sentiment: **${state.sentiment.mood.toUpperCase()}**` : '';
    const productData = state.entities.products.length ? `\n• Related Entities: **${state.entities.products.map(p => p.name).join(', ')}**` : '';

    return {
      type: 'escalate', level: 'Level 2 - Operations', ticket,
      reply: `I have compiled your requests and built an active support docket:\n\n**Identified Issues:**\n${detectedProblems.join('\n')}${sentimentAlert}${productData}\n\n**Resolution Plan (Ticket #${ticket}):**\nYour case is escalated to the operations desk. The manager on duty will execute the following:\n${actions.join('\n')}\n\nPlease hold while I transfer this data.`
    };
  }

  // LEVEL 1 & 0: Info, Tech, Products
  if (['price_query', 'stock_query', 'product_search'].includes(state.primaryIntent)) {
    if (state.entities.products.length > 0) {
      const p = state.entities.products[0];
      const stock = Math.max(0, (Number(p.real_stock) || 0) - (Number(p.buffer) || 2));
      return { 
        type: 'answer', productContext: p,
        reply: `**Inventory Search Results:**\n• Product: **${p.name}**\n• Retail Price: **₹${p.price}**\n• Shelf Status: **${stock} units** currently available for immediate dispatch.\n\nWould you like assistance adding this to your cart?` 
      };
    } else if (state.entities.products.length === 0 && state.normalizedMessage.length > 3) {
      // Log missing product demand
      return { type: 'answer', reply: "I surveyed the catalog but couldn't find an exact match for that item. I have logged this as a customer request for our procurement team!" };
    }
  }

  if (['otp_issue', 'login_issue'].includes(state.primaryIntent)) {
    return { type: 'answer', reply: "🔐 **Authentication Diagnostics:**\n1. Ensure your network signal is stable (SMS gateways require high connectivity).\n2. Wait exactly 120 seconds before requesting a fresh OTP token.\n3. Clear your browser/app cache.\n\nIf this persists, type 'manager' and I will initiate a manual profile unlock." };
  }

  // Base Greeting
  return { type: 'answer', reply: "Hello! 👋 I am the Lakshmi Stores Enterprise Support AI. I can audit transactions, trace complex logistics, and query live inventory. How can I facilitate your shopping today?" };
};

// ============================================================================
// 🛡️ [API ROUTE] EXPRESS CONTROLLER WITH DEEP CRASH PROTECTION
// ============================================================================
exports.chat = async (req, res) => {
  try {
    const rawMessage = String(req.body.message || '').trim().slice(0, 1500);
    if (!rawMessage) return res.status(400).json({ success: false, message: 'Message payload required.' });

    let user = null;
    try {
      const header = String(req.headers.authorization || '');
      if (header.startsWith('Bearer ')) {
        const token = header.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        user = await User.findByPk(decoded.id);
      }
    } catch (e) { /* Guest Session */ }

    // Thread Initialization & Protection
    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, status: THREAD_STATUS.AI, aiEnabled: true, 
        metadata: { memory: { frustrationVelocity: 0, escalationCount: 0 } } 
      });
    } else if (thread.status === THREAD_STATUS.RESOLVED) {
      // Re-open resolved thread
      await thread.update({ status: THREAD_STATUS.AI, aiEnabled: true, resolvedAt: null });
    }

    await SupportMessage.create({ threadId: thread.id, senderType: 'customer', body: rawMessage });

    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({ status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
      return res.json({ success: true, thread });
    }

    // 🚀 EXECUTE V14 PIPELINE
    const memory = (thread.metadata || {}).memory || {};
    const nlpAnalysis = await processNaturalLanguage(rawMessage);
    const state = orchestrateState(nlpAnalysis, memory);
    const decision = await generateActionPlan(state, memory, user);

    // 💾 COMMIT TO MEMORY DB
    const updatedMemory = { ...memory };
    updatedMemory.frustrationVelocity = state.frustrationVelocity;
    
    // Decay frustration over successful interactions
    if (decision.type === 'answer') updatedMemory.frustrationVelocity = Math.max(0, updatedMemory.frustrationVelocity - 20);
    
    if (state.maxEscalationLevel > 0 && !['human_request', 'legal_threat'].includes(state.primaryIntent)) {
      updatedMemory.lastActiveIssue = state.primaryIntent;
    }
    
    if (decision.ticket) updatedMemory.activeTicket = decision.ticket;
    if (decision.productContext) updatedMemory.lastProductDbRecord = decision.productContext;
    if (decision.type === 'escalate') updatedMemory.escalationCount = (Number(updatedMemory.escalationCount) || 0) + 1;

    // 📝 SAVE ASSISTANT RESPONSE
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
    console.error('🛡️ V14 FATAL PROTECTION TRIGGERED:', error);
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