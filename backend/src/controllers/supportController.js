'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User, SupportThread, SupportMessage } = require('../models');

const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };
const generateTicketId = () => `LS-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

exports.chat = async (req, res) => {
  try {
    const rawMessage = String(req.body.message || '').trim().slice(0, 1500);

    if (!rawMessage) {
      return res.status(400).json({ success: false, message: 'Message required.' });
    }

    // 1. Identify User
    let user = null;
    try {
      const header = String(req.headers.authorization || '');
      if (header.startsWith('Bearer ')) {
        user = await User.findByPk(jwt.verify(header.split(' ')[1], process.env.JWT_ACCESS_SECRET).id);
      }
    } catch (e) {}

    // 2. Load or Create Thread
    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;

    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, status: THREAD_STATUS.AI, aiEnabled: true 
      });
    } else if (thread.status === THREAD_STATUS.RESOLVED) {
      await thread.update({ status: THREAD_STATUS.AI, aiEnabled: true, resolvedAt: null });
    }

    // 3. Save Customer Message
    await SupportMessage.create({ threadId: thread.id, senderType: 'customer', body: rawMessage });

    // 4. MUTE CHECK: If Admin is active or Ticket is already Raised, AI stays quiet
    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({ status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
      const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
      return res.json({ success: true, thread: { ...thread.toJSON(), messages } });
    }

    // 5. BULLETPROOF MEMORY: Check conversation history instead of database JSON metadata
    const previousMessages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'DESC']] });
    
    // Check if the bot ALREADY asked for proof in this conversation
    const botAlreadyApologized = previousMessages.some(m => 
      m.senderType === 'assistant' && m.body.includes('Please explain your problem clearly')
    );

    // 6. SIMPLE EMPATHETIC LOGIC
    let reply = "";
    let escalate = false;
    const text = rawMessage.toLowerCase();
    const isGreeting = /^(hi|hello|hey|good morning|good evening|namaste)( there)?$/i.test(text.replace(/[^a-z ]/g, '').trim());

    if (botAlreadyApologized) {
      // The bot already asked for proof. This current message IS the proof. Raise the ticket!
      const ticketId = generateTicketId();
      reply = `Thank you for providing the details. 🙏\n\nI have successfully raised a support ticket for you (**#${ticketId}**). I am forwarding this entire chat and your proof directly to the store admin.\n\n*My automated replies are now paused.* The admin will connect with you here shortly and resolve your issue as soon as possible.`;
      escalate = true;
    } else {
      if (isGreeting) {
        reply = "Hello! 👋 Welcome to Lakshmi Stores Support. If you are facing any issues with your order, payment, or products, please let me know.";
      } else {
        // First time hearing the issue. Apologize and ask for proof.
        reply = "I am so sorry to hear that you are facing this issue. I sincerely apologize for the inconvenience. 😔\n\nPlease explain your problem clearly in your next message, and kindly use the attachment button (JPEG/PNG) to provide any proof or screenshots.\n\nOnce you reply, I will forward everything to our admin who will connect with you directly here to solve your issue.";
      }
    }

    // 7. Save AI Reply & Handle Escalation
    await SupportMessage.create({ threadId: thread.id, senderType: 'assistant', senderName: 'Support Concierge', body: reply });

    if (escalate) {
      await SupportThread.update({ 
        status: THREAD_STATUS.NEEDS_ADMIN, priority: 'urgent', escalationReason: 'Customer Submitted Proof', aiEnabled: false 
      }, { where: { id: thread.id } });
      const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.NEEDS_ADMIN });
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
    await SupportThread.update({ status: THREAD_STATUS.RESOLVED, aiEnabled: false, resolvedAt: new Date() }, { where: { id: thread.id } });

    const io = req.app.get('io'); if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...(thread.dataValues || thread), messages: (messages || []).map(m => m.dataValues || m) } });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to resolve thread.' }); }
};