'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Product, Order, User, SupportThread, SupportMessage } = require('../models');

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║      LAKSHMI STORES V32 — THE EMPATHETIC HUMAN CONCIERGE                     ║
// ║  Warm Greetings, Friendly Product Search, & Seamless Admin Handoff           ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };
const generateTicketId = () => `LS-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// ----------------------------------------------------------------------------
// 🗣️ [LINGUISTICS] TRANSLATIONS & ALIASES
// ----------------------------------------------------------------------------
const REGIONAL_MAP = {
  'varala': 'missing', 'varla': 'missing', 'kedaikala': 'missing', 'illai': 'no', 
  'aagala': 'failed', 'agala': 'failed', 'mudiyala': 'failed', 'theriyala': 'unknown',
  'panam': 'money', 'pochu': 'lost', 'kaasu': 'money', 'cash': 'money', 'cut': 'deducted', 'aachu': 'happened',
  'manager venum': 'human request', 'call pannu': 'human request', 'pesanum': 'speak',
  'ayindi': 'happened', 'ayipoindi': 'completed', 'ledhu': 'missing', 'raaledu': 'missing',
  'ravatledu': 'not coming', 'avvatledu': 'failed', 'paise': 'money', 'dabulu': 'money'
};

const normalizeText = (text) => {
  let normalized = String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  Object.entries(REGIONAL_MAP).forEach(([slang, eng]) => {
    normalized = normalized.replace(new RegExp(`\\b${slang}\\b`, 'g'), eng);
  });
  return normalized;
};

// ----------------------------------------------------------------------------
// 🛒 [ENGINE] FRIENDLY PRODUCT SEARCH
// ----------------------------------------------------------------------------
const findProductFriendly = async (text) => {
  try {
    const dbProducts = await Product.findAll({ attributes: ['id', 'name', 'price', 'real_stock', 'buffer', 'tags'] });
    const tokens = text.split(' ').filter(w => w.length > 2);
    
    for (const p of dbProducts) {
      const pName = String(p.name).toLowerCase();
      const pTags = String(p.tags || '').toLowerCase();
      
      // Match exact, by tag, or by word overlap (e.g. "sprite" matches "SPRITE (2L)")
      if (text.includes(pName) || (pTags && pTags.split(',').some(tag => text.includes(tag.trim()))) || tokens.some(t => pName.includes(t))) {
        return p;
      }
    }
  } catch (e) { console.error("Product Search Error:", e); }
  return null;
};

// ----------------------------------------------------------------------------
// 🚀 [CONTROLLER] MAIN CHAT LOGIC
// ----------------------------------------------------------------------------
exports.chat = async (req, res) => {
  try {
    const rawMessage = String(req.body.message || '').trim().slice(0, 1500);
    if (!rawMessage) return res.status(400).json({ success: false, message: 'Message cannot be empty.' });

    // 1. Identify User
    let user = null;
    try {
      const header = String(req.headers.authorization || '');
      if (header.startsWith('Bearer ')) {
        user = await User.findByPk(jwt.verify(header.split(' ')[1], process.env.JWT_ACCESS_SECRET).id);
      }
    } catch (e) { /* Guest mode */ }

    // 2. Load or Create Thread & Memory
    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    let memory = { state: 'NORMAL' };

    if (thread && thread.metadata) {
      try { memory = typeof thread.metadata === 'string' ? JSON.parse(thread.metadata).memory : thread.metadata.memory; } catch (e) {}
    }

    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, status: THREAD_STATUS.AI, aiEnabled: true, 
        metadata: { memory: { state: 'NORMAL' } } 
      });
    } else if (thread.status === THREAD_STATUS.RESOLVED) {
      // If customer chats on a closed ticket, politely reopen it
      await thread.update({ status: THREAD_STATUS.AI, aiEnabled: true, resolvedAt: null });
      memory.state = 'NORMAL';
    }

    // 3. Save Customer Message
    await SupportMessage.create({ threadId: thread.id, senderType: 'customer', body: rawMessage });

    // 4. MUTE CHECK: If Admin is active or Ticket is Raised, AI stays quiet
    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({ status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
      const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
      return res.json({ success: true, thread: { ...thread.toJSON(), messages } });
    }

    // 5. AI CONCIERGE LOGIC
    const text = normalizeText(rawMessage);
    let replyText = "";
    let updateStateTo = memory.state;
    let escalateToAdmin = false;

    // --- STATE: WAITING FOR CUSTOMER PROOF ---
    if (memory.state === 'AWAITING_PROOF') {
      const ticketId = generateTicketId();
      replyText = `Thank you so much for providing those details. 🙏\n\nI have successfully raised a support ticket for you (Ticket **#${ticketId}**). I have forwarded all your messages and proof directly to our store manager.\n\nI am now muting my automated replies so the admin can review your case and message you directly here to clear your issue as soon as possible. You can continue to send messages or upload any extra photos in this chat. We will fix this for you!`;
      updateStateTo = 'ESCALATED';
      escalateToAdmin = true;
    } 
    // --- STATE: NORMAL CONVERSATION ---
    else {
      // A. Complaint / Issue Detected
      if (/\b(deducted|charged|failed|missing|varala|wrong|damaged|broken|leaking|spoiled|otp|locked|hacked|refund|manager|human|issue|problem|worst)\b/i.test(text)) {
        replyText = `I am so sorry to hear you are facing this issue. I completely understand how frustrating that can be. 😔\n\nTo help me get this resolved for you immediately, could you please reply with your **Order ID** and upload any **photos or screenshots** of the issue?\n\nOnce you provide that, I will hand this chat straight over to the store manager.`;
        updateStateTo = 'AWAITING_PROOF';
      } 
      // B. Greetings
      else if (/\b(hi|hello|hey|good morning|good evening|thanks|ok)\b/i.test(text) && text.length < 15) {
        replyText = `Hello! 👋 Welcome to Lakshmi Stores. I am your store assistant. How can I help you with your shopping today?`;
      } 
      // C. Product Search
      else if (/\b(price|stock|do you have|available|need|want)\b/i.test(text) || text.length > 2) {
        const product = await findProductFriendly(text);
        if (product) {
          const stock = Math.max(0, (Number(product.real_stock) || 0) - (Number(product.buffer) || 2));
          replyText = `Yes, we have **${product.name}**! 🎉\n\nIt costs **₹${product.price}** and we currently have **${stock} units** available in stock. Would you like me to help you find anything else?`;
        } else {
          replyText = `I just checked our shelves, but I couldn't find an exact match for that right now. Could you check the spelling, or is there another brand you'd like me to look for?`;
        }
      }
      // D. Fallback
      else {
        replyText = `I'm here to help! Are you looking for a specific product, or do you need help with an order issue?`;
      }
    }

    // 6. Save AI Reply & Update Thread
    await SupportMessage.create({ threadId: thread.id, senderType: 'assistant', senderName: 'Store Assistant', body: replyText });

    if (escalateToAdmin) {
      await SupportThread.update({ 
        status: THREAD_STATUS.NEEDS_ADMIN, priority: 'urgent', escalationReason: 'Customer Submitted Proof', aiEnabled: false, 
        metadata: { memory: { state: updateStateTo } } 
      }, { where: { id: thread.id } });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.NEEDS_ADMIN });
    } else {
      await SupportThread.update({ metadata: { memory: { state: updateStateTo } } }, { where: { id: thread.id } });
    }

    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...thread.toJSON(), messages } });

  } catch (error) {
    console.error('🛡️ CONCIERGE ERROR:', error);
    res.status(200).json({ success: true, fallback: true, message: "I'm having a little trouble connecting to the system right now. Our admin will check on this chat shortly!" });
  }
};

// ============================================================================
// 🛡️ ADMIN & DASHBOARD ROUTES
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
    await SupportThread.update({ status: THREAD_STATUS.HUMAN_ACTIVE, aiEnabled: false, handledBy: req.user?.name }, { where: { id: thread.id } });
    
    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: (messages || []).map(m => m.dataValues || m) } });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to send reply.' }); }
};

exports.resolveThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await SupportMessage.create({ threadId: thread.id, senderType: 'system', senderName: 'System', body: 'This docket has been successfully resolved and closed by the store manager.' });
    await SupportThread.update({ status: THREAD_STATUS.RESOLVED, aiEnabled: false, resolvedAt: new Date(), metadata: { memory: { state: 'NORMAL' } } }, { where: { id: thread.id } });

    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: (messages || []).map(m => m.dataValues || m) } });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to resolve thread.' }); }
};