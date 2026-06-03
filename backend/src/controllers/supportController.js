const { GoogleGenerativeAI } = require('@google/generative-ai');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Product, Order, OrderItem, User, Notification, StoreSetting, ItemRequest, SupportThread, SupportMessage } = require('../models');

// Initialize Gemini safely
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const THREAD_STATUS = {
  AI: 'ai_answering',
  NEEDS_ADMIN: 'needs_admin',
  HUMAN_ACTIVE: 'human_active',
  RESOLVED: 'resolved'
};

// ============================================================
// AI TOOLS (Using Safe String Literals)
// ============================================================
const aiTools = [{
  functionDeclarations: [
    {
      name: 'check_inventory',
      description: 'Search the live grocery catalog to check stock availability and pricing.',
      parameters: {
        type: 'OBJECT',
        properties: {
          searchQuery: { type: 'STRING', description: 'Product name or keyword (e.g., milk, onion, chips)' }
        },
        required: ['searchQuery']
      }
    },
    {
      name: 'escalate_to_admin',
      description: 'Transfer the chat to a human store manager immediately for refunds, complaints, or issues.',
      parameters: {
        type: 'OBJECT',
        properties: {
          reason: { type: 'STRING', description: 'Detailed reason for handoff to the human store owner.' }
        },
        required: ['reason']
      }
    }
  ]
}];

// ============================================================
// HELPER FUNCTIONS 
// ============================================================
const getOptionalUser = async (req) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    return await User.findByPk(decoded.id, { attributes: ['id', 'name', 'email', 'phone', 'role', 'isVerified'] });
  } catch (error) { return null; }
};

const serializeThread = async (thread) => {
  const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
  return { ...thread.toJSON(), messages };
};

const emitSupportUpdate = (req, thread) => {
  const io = req.app.get('io');
  if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
};

const notifyAdmin = async (req, thread, reason, customerMessage) => {
  const customerLabel = thread.customerName || thread.customerEmail || 'Customer';
  await Notification.create({
    userId: 'GLOBAL', title: 'Customer needs help',
    message: `${customerLabel}: ${String(customerMessage).slice(0, 120)}...`, isRead: false
  });
  const io = req.app.get('io');
  if (io) {
    io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.NEEDS_ADMIN, reason });
    io.emit('storeUpdated');
  }
};

const appendMessage = async (thread, senderType, body, senderName = null, metadata = null) => {
  const message = await SupportMessage.create({ threadId: thread.id, senderType, senderName, body, metadata });
  await thread.update({
    lastMessagePreview: String(body).slice(0, 500),
    lastCustomerMessageAt: senderType === 'customer' ? new Date() : thread.lastCustomerMessageAt,
    lastAdminMessageAt: senderType === 'admin' ? new Date() : thread.lastAdminMessageAt
  });
  return message;
};

// ============================================================
// TRUE AI CHAT LOGIC (Un-Crashable Version)
// ============================================================
exports.chat = async (req, res) => {
  try {
    const message = String(req.body.message || '').trim().slice(0, 1000);
    const threadId = req.body.threadId || null;
    if (!message) return res.status(400).json({ success: false, message: 'Message is required.' });

    const user = await getOptionalUser(req);
    
    // Find or Create Thread
    let thread = null;
    if (threadId) thread = await SupportThread.findByPk(threadId);
    if (!thread) {
      thread = await SupportThread.create({
        userId: user ? String(user.id) : null,
        customerName: user?.name || null,
        customerEmail: user?.email || null,
        customerPhone: user?.phone || null,
        status: THREAD_STATUS.AI, aiEnabled: true
      });
    }

    if (thread.status === THREAD_STATUS.RESOLVED) {
      await thread.update({ status: THREAD_STATUS.AI, aiEnabled: true, resolvedAt: null, handledBy: null, escalationReason: null });
    }

    // Save Customer Message
    await appendMessage(thread, 'customer', message, user?.name || 'Customer');

    // If Admin took over, AI stays silent
    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      await thread.update({
        status: thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status,
        priority: thread.priority || 'urgent'
      });
      emitSupportUpdate(req, thread);
      return res.json({ success: true, thread: await serializeThread(thread) });
    }

    // 1. RAG Context Gathering
    const storeSetting = await StoreSetting.findByPk(1);
    const isOpen = storeSetting ? storeSetting.isOpen : true;
    const closingWarning = storeSetting ? storeSetting.closingWarningActive : false;

    let latestOrderContext = "Customer is not logged in or has no past orders.";
    if (user) {
      const order = await Order.findOne({ where: { userId: String(user.id) }, order: [['createdAt', 'DESC']], include: [{ model: OrderItem, as: 'items' }] });
      if (order) {
        latestOrderContext = `Customer's Latest Order: #${order.orderToken || order.cashfreeOrderId.slice(-4)}. Status: ${order.orderStatus}. Amount: ₹${order.orderAmount}.`;
      }
    }

    // 2. System Prompt Injection
    const systemInstruction = `
      You are the elite AI Assistant for Lakshmi Stores.
      REAL-TIME DATA:
      - Store Status: ${isOpen ? (closingWarning ? 'Open, but closing very soon.' : 'Open') : 'Closed. Shutter is down.'}
      - ${latestOrderContext}
      RULES:
      - You must be concise, helpful, and highly professional.
      - Stock Availability Equation: Available units = real_stock - buffer. If available units <= 0, the item is out of stock.
      - If the user asks for item availability or prices, ALWAYS invoke 'check_inventory'. Do not guess.
      - If the user is hostile, demands refunds, says an item was missing from their order, or explicitly wants a human, invoke 'escalate_to_admin' immediately.
    `;

    // 3. Chat History Formatting
    const rawHistory = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']], limit: 20 });
    const contents = [];
    rawHistory.forEach(msg => {
      const role = msg.senderType === 'customer' ? 'user' : 'model';
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += `\n${msg.body}`;
      } else {
        contents.push({ role, parts: [{ text: msg.body }] });
      }
    });

    if (contents.length > 0 && contents[0].role !== 'user') {
      contents.shift();
    }

    let responseText = "";
    let decisionType = 'answer';
    let escalationReason = null;

    // 🚨 4. THE SAFETY NET (If Gemini fails, it degrades gracefully)
    try {
      const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash', systemInstruction, tools: aiTools });
      let result = await model.generateContent({ contents });
      
      const functionCalls = result.response?.functionCalls;

      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];

        if (call.name === 'check_inventory') {
          const query = call.args.searchQuery || '';
          const matchingProducts = await Product.findAll({ where: { isActive: true, [Op.or]: [{ name: { [Op.iLike]: `%${query}%` } }, { category: { [Op.iLike]: `%${query}%` } }] }, limit: 5 });

          if (matchingProducts.length === 0) {
            responseText = `I couldn't find any items matching "${query}" right now. Please use the search bar on the store page to submit a missing item request!`;
          } else {
            responseText = "Here is what I found in stock:\n";
            matchingProducts.forEach(p => {
              const safeStock = Math.max(0, (p.real_stock || 0) - (p.buffer ?? 2));
              responseText += `- ${p.name}: ₹${p.price} (${safeStock > 0 ? `${safeStock} available` : 'Out of Stock'})\n`;
            });
          }
        } 
        else if (call.name === 'escalate_to_admin') {
          decisionType = 'escalate';
          escalationReason = call.args.reason || 'Escalated by AI decision.';
          responseText = "I completely understand. I am bringing the store manager into this chat right now to help you. Please hold on a moment.";
        }
      } else {
        responseText = result.response.text();
      }
    } catch (aiError) {
      console.error('⚠️ GEMINI API CRASH INTERCEPTED:', aiError);
      
      // Fallback response so the customer isn't left hanging!
      responseText = "I'm having a little trouble connecting to my system right now. Let me bring the store manager in to assist you.";
      decisionType = 'escalate';
      escalationReason = 'AI API Failure / Fallback triggered';
    }

    // Save Output and Handle State
    if (responseText) {
      await appendMessage(thread, 'assistant', responseText, 'Lakshmi Assistant');
    }

    if (decisionType === 'escalate') {
      await thread.update({ status: THREAD_STATUS.NEEDS_ADMIN, priority: 'urgent', escalationReason, aiEnabled: false });
      await notifyAdmin(req, thread, escalationReason, message);
    } else {
      await thread.update({ status: THREAD_STATUS.AI, priority: 'normal', aiEnabled: true });
    }

    res.json({ success: true, thread: await serializeThread(thread) });

  } catch (error) {
    console.error('Fatal Route Error:', error);
    res.status(500).json({ success: false, message: 'Support assistant failed to respond.' });
  }
};

// ============================================================
// ADMIN ROUTES 
// ============================================================
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
    const where = {};
    if (status === 'active') where.status = { [Op.ne]: THREAD_STATUS.RESOLVED };
    else if (status) where.status = status;

    const threads = await SupportThread.findAll({ where, order: [['updatedAt', 'DESC']], limit: 50 });
    const data = await Promise.all(threads.map(serializeThread));
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to fetch threads.' }); }
};

exports.adminReply = async (req, res) => {
  try {
    const message = String(req.body.message || '').trim().slice(0, 1000);
    if (!message) return res.status(400).json({ success: false, message: 'Message is required.' });

    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await appendMessage(thread, 'admin', message, req.user?.name || 'Store Manager');
    await thread.update({ status: THREAD_STATUS.HUMAN_ACTIVE, aiEnabled: false, handledBy: req.user?.name || 'Store Manager', priority: 'normal' });

    emitSupportUpdate(req, thread);
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to send reply.' }); }
};

exports.resolveThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await appendMessage(thread, 'system', 'Conversation marked resolved by the store team.', 'System');
    await thread.update({ status: THREAD_STATUS.RESOLVED, aiEnabled: false, resolvedAt: new Date(), priority: 'normal' });

    emitSupportUpdate(req, thread);
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to resolve thread.' }); }
};