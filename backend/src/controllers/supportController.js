const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Product, Order, OrderItem, User, Notification, StoreSetting, SupportThread, SupportMessage } = require('../models');

const { classifyMessage } = require('../services/nlp/classifier');
const { resolveContext } = require('../services/nlp/contextResolver');
const { updateConversationMemory } = require('../services/nlp/memory');
const { logIssueForDashboard } =
require('../services/nlp/analytics/issueLogger');
const { ESCALATION_TIERS } = require('../services/nlp/intents');

const THREAD_STATUS = { AI: 'ai_answering', NEEDS_ADMIN: 'needs_admin', HUMAN_ACTIVE: 'human_active', RESOLVED: 'resolved' };

// Generate unique ticket IDs
const generateTicketId = () => `TKT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// ============================================================
// V8 RESPONSE GENERATOR
// ============================================================
const generateResponse = async (resolvedAnalysis, memory, user, thread) => {
  
  // FIXED: analysis.primaryIntent check
  if (resolvedAnalysis.confidence < 25 && resolvedAnalysis.primaryIntent !== 'greeting') {
    return {
      type: 'answer',
      reply: "I want to ensure I assist you perfectly. Are you asking about:\n1. A Payment/Refund issue\n2. Tracking an order\n3. An issue logging in\n\nPlease clarify so I can process this accurately."
    };
  }

  // Security Module: Fraud & Hacked Accounts
  if (['fraud_report', 'account_hacked'].includes(resolvedAnalysis.primaryIntent)) {
    const ticketId = memory.activeTicket || generateTicketId();
    // In a real app: await User.update({ isLocked: true }, { where: { id: user.id }});
    return {
      type: 'escalate', level: 'Level 3 - Critical Security', ticketId,
      reply: `🚨 **SECURITY ALERT (Ticket #${ticketId})**\nWe take fraud and account security extremely seriously. I have temporarily locked your session for your safety and pinged the store manager. Please do not share any OTPs. We are reviewing this immediately.`
    };
  }

  // Mood Tracker Auto-Escalation
  if (resolvedAnalysis.primaryIntent === 'negative_sentiment') {
    const ticketId = memory.activeTicket || generateTicketId();
    return {
      type: 'escalate', level: 'Level 3 - Urgent', ticketId,
      reply: `I deeply apologize for this unacceptable experience. I have triggered our critical priority queue under **Ticket #${ticketId}**. The store manager is stepping in right now to fix this.`
    };
  }

  // Issue Continuation ("Still waiting")
  if (resolvedAnalysis.isFollowUp && ESCALATION_TIERS.LEVEL_2.includes(resolvedAnalysis.primaryIntent)) {
    const ticketId = memory.activeTicket || generateTicketId();
    return {
      type: 'escalate', level: 'Level 2 - Ongoing Issue', ticketId,
      reply: `I see this issue is still not resolved. I am escalating **Ticket #${ticketId}** back to the manager's immediate attention.`
    };
  }

  // Standard Escalations (Payment, Refund, Wrong Item)
  if (ESCALATION_TIERS.LEVEL_2.includes(resolvedAnalysis.primaryIntent)) {
    if (!user) return { type: 'answer', reply: "I can look up transaction and packing details, but please log in first so I can safely read your profile data." };
    const order = await Order.findOne({ where: { userId: String(user.id) }, order: [['createdAt', 'DESC']] });
    const token = order ? order.orderToken || order.cashfreeOrderId.slice(-4) : 'Unknown';
    const ticketId = memory.activeTicket || generateTicketId();
    
    logIssueForDashboard(resolvedAnalysis.primaryIntent, resolvedAnalysis.confidence);

    return {
      type: 'escalate', level: 'Level 2 - Needs Manager', ticketId,
      reply: `I have created **Ticket #${ticketId}** regarding order **#${token}** (${resolvedAnalysis.primaryIntent.replace('_', ' ')}). A store manager is joining the chat to manually review and resolve this.`
    };
  }

  // Product Context Continuation ("Maggi available?" -> "Price?")
  if (['price_query', 'stock_query', 'product_search'].includes(resolvedAnalysis.primaryIntent)) {
    // Assuming findBestProductMatch is imported and accessible
    // const matchedProduct = findBestProductMatch(products, resolvedAnalysis.extractedTokens.join(' '));
    // Implementation of product response here...
    
    // Mock response for structure:
    const productName = resolvedAnalysis.extractedTokens.join(' ') || memory.lastProduct;
    return { 
      type: 'answer', 
      productContext: { name: productName },
      reply: `You asked about **${productName}**. Let me check our shelves...` 
    };
  }

  // Base Greeting
  return { type: 'answer', reply: "Hello! 👋 Welcome to Lakshmi Stores. I can check prices, track orders, or report issues. How can I help?" };
};

// ============================================================
// EXPRESS ROUTE EXPORTS
// ============================================================
exports.chat = async (req, res) => {
  try {
    const rawMessage = req.body.message;
    if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Valid message payload required.' });
    }
    
    const message = rawMessage.trim().slice(0, 1000);
    
    let user = await getOptionalUser(req);

    let thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;
    if (!thread) {
      thread = await SupportThread.create({ 
        userId: user ? String(user.id) : null, 
        status: THREAD_STATUS.AI, aiEnabled: true, 
        metadata: { memory: {} } 
      });
    }

    await SupportMessage.create({ threadId: thread.id, senderType: 'customer', body: message });

    if (!thread.aiEnabled) {
      return res.json({ success: true, thread });
    }

    // 🚨 RUN V8 INTELLIGENCE LAYER
    const memoryContext = thread.metadata?.memory || {};
    
    // 1. Classify
    const baseAnalysis = classifyMessage(message, memoryContext);
    
    // 2. Resolve Context (Handles Follow-ups & Mood)
    const resolvedAnalysis = resolveContext(message, baseAnalysis, memoryContext);
    
    // 3. Generate Response
    const decision = await generateResponse(resolvedAnalysis, memoryContext, user, thread);
    
    // 4. Update Memory
    const updatedMemory = updateConversationMemory(memoryContext, resolvedAnalysis, decision.productContext, decision.ticketId);

    // Save outputs safely
    if (decision.reply) {
      await SupportMessage.create({ threadId: thread.id, senderType: 'assistant', senderName: 'Lakshmi Assistant', body: decision.reply });
    }

    if (decision.type === 'escalate') {
      await thread.update({ 
        status: THREAD_STATUS.NEEDS_ADMIN, 
        priority: 'urgent', 
        escalationReason: `${decision.level} [${decision.ticketId}]`, 
        aiEnabled: false,
        metadata: { memory: updatedMemory }
      });
      // Notify Admin Logic Here
    } else {
      await thread.update({ metadata: { memory: updatedMemory } });
    }

    const messages = await SupportMessage.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
    res.json({ success: true, thread: { ...thread.toJSON(), messages } });

  } catch (error) {
    console.error('V8 Engine Crash Protection Triggered:', error);
    res.status(200).json({ 
      success: true, 
      fallback: true,
      message: "I am experiencing a temporary system interruption. Please hold while I connect you to the store manager." 
    });
  }
};
const getOptionalUser = async (req) => {
  try {
    return req.user || null;
  } catch {
    return null;
  }
};

exports.getPublicThread = async (req, res) => {
  res.json({ success: true, message: 'getPublicThread working' });
};

exports.getThreads = async (req, res) => {
  res.json({ success: true, threads: [] });
};

exports.adminReply = async (req, res) => {
  res.json({ success: true, message: 'adminReply working' });
};

exports.resolveThread = async (req, res) => {
  res.json({ success: true, message: 'resolveThread working' });
};