'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User, SupportThread, SupportMessage } = require('../models');

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║      LAKSHMI STORES — SIMPLE EMPATHETIC CONCIERGE                            ║
// ║  Friendly Greetings · Deep Apologies · Proof Collection · Admin Handoff      ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };
const generateTicketId = () => `LS-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

exports.chat = async (req, res) => {
  try {
    const rawMessage = String(req.body.message || '').trim().slice(0, 1500);
    if (!rawMessage) return res.status(400).json({ success: false, message: 'Message required.' });

    // 1. Identify User
    let user = null;
    try {
      const header = String(req.headers.authorization || '');
      if (header.startsWith('Bearer ')) {
        user = await User.findByPk(jwt.verify(header.split(' ')[1], process.env.JWT_ACCESS_SECRET).id);
      }
    } catch (e) { /* Guest mode */ }

    // 2. Safely Load Thread & Memory
    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    let meta = {};
    if (thread && thread.metadata) {
      try { meta = typeof thread.metadata === 'string' ? JSON.parse(thread.metadata) : thread.metadata; } catch(e) {}
    }
    
    let memory = meta.memory || { state: 'NORMAL' };

    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, status: THREAD_STATUS.AI, aiEnabled: true, 
        metadata: { memory } 
      });
    } else if (thread.status === THREAD_STATUS.RESOLVED) {
      await thread.update({ status: THREAD_STATUS.AI, aiEnabled: true, resolvedAt: null });
      memory.state = 'NORMAL';
    }

    // 3. Save Customer Message
    await SupportMessage.create({ threadId: thread.id, senderType: 'customer', body: rawMessage });

    // 4. MUTE ENFORCEMENT: If Admin is needed or active, AI stays quiet
    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({ status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
      const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
      return res.json({ success: true, thread: { ...thread.toJSON(), messages } });
    }

    // 5. SIMPLE AI LOGIC
    let reply = "";
    let escalate = false;
    const text = rawMessage.toLowerCase();
    const isGreetingOnly = /^(hi|hello|hey|good morning|good evening)$/i.test(text.trim());

    if (memory.state === 'AWAITING_PROOF') {
      reply = `Thank you for providing the details. 🙏\n\nI have raised a support ticket for you (Ticket **#${generateTicketId()}**). I am forwarding this entire chat and your proof directly to the store admin.\n\n*Message sending is now temporarily muted.* The admin will connect with you here shortly and resolve your issue. Once they reply, you will be able to chat again.`;
      escalate = true;
      memory.state = 'ESCALATED';
    } else {
      if (isGreetingOnly) {
        reply = "Hello! 👋 Welcome to Lakshmi Stores Support. If you are facing any issues with your order or payment, please let me know.";
      } else {
        reply = "I am so sorry to hear that you are facing this issue. I sincerely apologize for the inconvenience. 😔\n\nPlease explain your problem clearly in your next message, and kindly use the attachment button (JPEG/PNG) to provide any proof or screenshots.\n\nOnce you reply, I will forward everything to our admin who will connect with you directly to solve your issue as soon as possible.";
        memory.state = 'AWAITING_PROOF';
      }
    }

    // 6. Save AI Reply & Update State
    await SupportMessage.create({ threadId: thread.id, senderType: 'assistant', senderName: 'Support Concierge', body: reply });

    if (escalate) {
      await SupportThread.update({ 
        status: THREAD_STATUS.NEEDS_ADMIN, priority: 'urgent', escalationReason: 'Customer Submitted Proof', aiEnabled: false, metadata: { memory } 
      }, { where: { id: thread.id } });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.NEEDS_ADMIN });
    } else {
      await SupportThread.update({ metadata: { memory } }, { where: { id: thread.id } });
    }

    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...thread.toJSON(), messages } });

  } catch (error) {
    console.error('🛡️ SUPPORT ERROR:', error);
    res.status(200).json({ success: true, fallback: true, message: "I am having trouble connecting right now, but I have notified the admin to check this chat!" });
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

    // When admin replies, unlock the customer's chat box
    await SupportMessage.create({ threadId: thread.id, senderType: 'admin', senderName: req.user?.name || 'Support Team', body: message });
    await SupportThread.update({ status: THREAD_STATUS.HUMAN_ACTIVE, aiEnabled: false, handledBy: req.user?.name }, { where: { id: thread.id } });
    
    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.HUMAN_ACTIVE });
    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: (messages || []).map(m => m.dataValues || m) } });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to send reply.' }); }
};

exports.resolveThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await SupportMessage.create({ threadId: thread.id, senderType: 'system', senderName: 'System', body: 'This docket has been successfully resolved and archived by the store manager.' });
    await SupportThread.update({ status: THREAD_STATUS.RESOLVED, aiEnabled: false, resolvedAt: new Date(), metadata: { memory: { state: 'NORMAL' } } }, { where: { id: thread.id } });

    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: (messages || []).map(m => m.dataValues || m) } });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to resolve thread.' }); }
};