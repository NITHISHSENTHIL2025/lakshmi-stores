'use strict';

const jwt       = require('jsonwebtoken');
const { Op }    = require('sequelize');
const Anthropic = require('@anthropic-ai/sdk');

const {
  Product, Order, OrderItem, User,
  Notification, StoreSetting, ItemRequest,
  SupportThread, SupportMessage
} = require('../models');

// ─── Config ───────────────────────────────────────────────────────────────────
const STORE_CLOSE_TIME     = process.env.STORE_CLOSE_TIME || '10:00 PM';
const PICKUP_READY_MINUTES = parseInt(process.env.PICKUP_READY_MINUTES || '10', 10);
const HISTORY_WINDOW       = 10;      // How many past turns to include as context
const AI_MODEL             = 'claude-sonnet-4-20250514';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const THREAD_STATUS = {
  AI:           'ai_answering',
  NEEDS_ADMIN:  'needs_admin',
  HUMAN_ACTIVE: 'human_active',
  RESOLVED:     'resolved'
};

// ─── System Prompt Builder ────────────────────────────────────────────────────
const buildSystemPrompt = (user) => `
You are "Lakshmi Assistant", the AI-powered customer support agent for **Lakshmi Stores**,
a friendly neighbourhood grocery and convenience shop in India.

## What you can do (use the provided tools — never guess)
- Search live product catalog for prices and stock
- Check a logged-in customer's latest order status
- Check if the store is open right now
- Log requests for items not yet in stock
- Escalate to the human store manager when needed

## Tone & Style
Warm, helpful, concise. Write like a knowledgeable shop assistant.
Use simple Indian-English (e.g. "ji" is fine naturally). Keep answers to 2–4 sentences
unless more detail is clearly needed. Always use ₹ for prices.

## Customer Context
${user
  ? `Name: ${user.name} | Logged in: Yes`
  : `Status: Guest — if they ask for order tracking, politely ask them to log in first`
}

## STRICT Escalation Rules  ← never bypass these
Call \`escalate_to_human\` IMMEDIATELY (before replying) if the customer mentions:
- Missing, wrong, or damaged items
- Refund or wallet / payment dispute  
- Order cancellation request
- Wanting to speak with a human or manager
- Any complaint that requires store authority to resolve
`.trim();

// ─── Tool Definitions (Claude's "function calling" schema) ────────────────────
const TOOLS = [
  {
    name: 'search_product',
    description:
      'Search the live store product catalog by name. Returns price, unit, and current stock. ' +
      'ALWAYS call this before answering any question about product availability or price.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Product name to look up, e.g. "toor dal", "Sprite 500ml", "atta 5kg"'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_order_status',
    description:
      "Fetch the customer's most recent order: token/PIN, status, amount, item count. " +
      'Only works when the customer is logged in.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_store_status',
    description:
      'Check whether the store is currently open or closed, get the closing time, ' +
      'and the estimated pickup-ready time in minutes.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'log_item_request',
    description:
      'Log a stock request for an item that is not in the catalog so the manager can consider it. ' +
      'Call this after confirming the product was not found via search_product.',
    input_schema: {
      type: 'object',
      properties: {
        item_name: {
          type: 'string',
          description: 'Name of the item the customer asked for'
        }
      },
      required: ['item_name']
    }
  },
  {
    name: 'escalate_to_human',
    description:
      'Hand this conversation to the human store manager. Use for complaints, refunds, ' +
      'missing/wrong/damaged items, cancellations, payment issues, or anything beyond AI scope.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Short internal reason, e.g. "Customer reports missing items from order #XY42"'
        }
      },
      required: ['reason']
    }
  }
];

// ─── Tool Executors (each maps a tool call to real DB / business logic) ────────
const runTool = async (name, input, user) => {
  switch (name) {

    /* ── search_product ─────────────────────────────────────────────────── */
    case 'search_product': {
      const q     = String(input.query || '').toLowerCase().trim();
      const terms = q.split(/\s+/).filter(w => w.length > 1);

      const all = await Product.findAll({ where: { isActive: true } });

      // Score products by substring / token overlap (in-memory, avoids dialect issues)
      const scored = all
        .map(p => {
          const pn    = p.name.toLowerCase();
          let score   = 0;
          if (pn === q)                            score += 40;
          else if (pn.includes(q) || q.includes(pn)) score += 20;
          terms.forEach(t => { if (pn.includes(t)) score += 8; });
          return { p, score };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (!scored.length) return { found: false };

      return {
        found: true,
        results: scored.map(({ p }) => {
          const stock = Math.max(0, (p.real_stock || 0) - (p.buffer ?? 2));
          return {
            name:       p.name,
            price:      p.price,
            unit:       p.isSoldByWeight ? 'per KG' : 'per piece',
            inStock:    stock > 0,
            qty:        stock,
            restockEta: p.restockEta || null
          };
        })
      };
    }

    /* ── get_order_status ───────────────────────────────────────────────── */
    case 'get_order_status': {
      if (!user) return { error: 'not_logged_in' };

      const order = await Order.findOne({
        where:   { userId: String(user.id) },
        order:   [['createdAt', 'DESC']],
        include: [{ model: OrderItem, as: 'items' }]
      });

      if (!order) return { found: false };

      const token =
        order.orderToken && order.orderToken !== 'WAIT'
          ? order.orderToken
          : (order.cashfreeOrderId || '').slice(-4);

      return {
        found:      true,
        token,
        status:     order.orderStatus.replace(/_/g, ' ').toUpperCase(),
        amount:     order.orderAmount,
        itemCount:  order.items?.length || 0,
        createdAt:  order.createdAt
      };
    }

    /* ── get_store_status ───────────────────────────────────────────────── */
    case 'get_store_status': {
      const store = await StoreSetting.findByPk(1);
      if (!store) return { isOpen: false, info: 'Store information unavailable.' };
      return {
        isOpen:        Boolean(store.isOpen),
        closingSoon:   Boolean(store.closingWarningActive),
        closeTime:     STORE_CLOSE_TIME,
        pickupMinutes: PICKUP_READY_MINUTES
      };
    }

    /* ── log_item_request ───────────────────────────────────────────────── */
    case 'log_item_request': {
      const itemName = String(input.item_name || '').slice(0, 80).trim();
      if (!itemName) return { logged: false };
      const [, created] = await ItemRequest.findOrCreate({
        where:    { itemName },
        defaults: { requestCount: 1 }
      });
      if (!created) await ItemRequest.increment('requestCount', { where: { itemName } });
      return { logged: true, itemName };
    }

    /* ── escalate_to_human ──────────────────────────────────────────────── */
    case 'escalate_to_human':
      return { escalated: true, reason: input.reason };

    default:
      return { error: `Unknown tool: ${name}` };
  }
};

// ─── Conversation History Builder ─────────────────────────────────────────────
/**
 * Fetches recent customer ↔ assistant messages from the DB,
 * converts them to the Anthropic messages format, and sanitises
 * the role sequence so it always strictly alternates user / assistant.
 */
const buildHistory = async (threadId) => {
  const rows = await SupportMessage.findAll({
    where: {
      threadId,
      senderType: { [Op.in]: ['customer', 'assistant'] }
    },
    order: [['createdAt', 'DESC']],
    limit: HISTORY_WINDOW
  });

  // Oldest first
  const chronological = rows.reverse().map(m => ({
    role:    m.senderType === 'customer' ? 'user' : 'assistant',
    content: m.body
  }));

  // Merge consecutive same-role messages (API requirement: strict alternation)
  const merged = [];
  for (const msg of chronological) {
    if (merged.length && merged[merged.length - 1].role === msg.role) {
      merged[merged.length - 1].content += '\n\n' + msg.content;
    } else {
      merged.push({ ...msg });
    }
  }

  // History must start with a user turn
  while (merged.length && merged[0].role === 'assistant') merged.shift();

  return merged;
};

// ─── Claude Agentic Loop ──────────────────────────────────────────────────────
/**
 * Sends the conversation to Claude, handles any tool calls in a loop,
 * and returns the final { type, reason, reply }.
 */
const runClaudeAgent = async (userMessage, user, history = []) => {
  const messages           = [...history, { role: 'user', content: userMessage }];
  let   escalationReason   = null;
  let   reply              = null;
  const MAX_ROUNDS         = 6;   // Safety cap on tool-call rounds

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model:    AI_MODEL,
      max_tokens: 1024,
      system:   buildSystemPrompt(user),
      tools:    TOOLS,
      messages
    });

    // Capture any text produced in this round
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) reply = block.text.trim();
    }

    // If Claude is done, exit the loop
    if (response.stop_reason !== 'tool_use') break;

    // ── Claude wants to call tools ──
    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      const result = await runTool(block.name, block.input, user);

      if (block.name === 'escalate_to_human' && result.escalated) {
        escalationReason = result.reason;
      }

      toolResults.push({
        type:        'tool_result',
        tool_use_id: block.id,
        content:     JSON.stringify(result)
      });
    }

    // Feed results back so Claude can continue
    messages.push({ role: 'user', content: toolResults });
  }

  return {
    type:   escalationReason ? 'escalate' : 'answer',
    reason: escalationReason,
    reply:  reply ?? "Hi! I'm Lakshmi Assistant. Ask me about products, prices, store hours, or your order status!"
  };
};

// ─── Routing Helpers (unchanged) ──────────────────────────────────────────────
const getOptionalUser = async (req) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    return await User.findByPk(decoded.id, {
      attributes: ['id', 'name', 'email', 'phone', 'role', 'isVerified']
    });
  } catch { return null; }
};

const serializeThread = async (thread) => {
  const messages = await SupportMessage.findAll({
    where: { threadId: thread.id },
    order: [['createdAt', 'ASC']]
  });
  return { ...thread.toJSON(), messages };
};

const notifyAdmin = async (req, thread, reason, customerMessage) => {
  await Notification.create({
    userId:  'GLOBAL',
    title:   'Customer needs help',
    message: `${thread.customerName || 'Customer'}: ${String(customerMessage).slice(0, 100)}...`,
    isRead:  false
  });
  const io = req.app.get('io');
  if (io) {
    io.emit('supportUpdated', { threadId: thread.id, status: THREAD_STATUS.NEEDS_ADMIN, reason });
    io.emit('storeUpdated');
  }
};

const appendMessage = async (thread, senderType, body, senderName = null) => {
  const msg = await SupportMessage.create({ threadId: thread.id, senderType, senderName, body });
  await thread.update({
    lastMessagePreview:    String(body).slice(0, 500),
    lastCustomerMessageAt: senderType === 'customer' ? new Date() : thread.lastCustomerMessageAt
  });
  return msg;
};

// ─── Main Chat Endpoint ───────────────────────────────────────────────────────
exports.chat = async (req, res) => {
  try {
    const message = String(req.body.message || '').trim().slice(0, 1000);
    if (!message) return res.status(400).json({ success: false, message: 'Message is required.' });

    const user   = await getOptionalUser(req);
    let   thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;

    // ── Create or reopen thread ──
    if (!thread) {
      thread = await SupportThread.create({
        userId:        user ? String(user.id) : null,
        customerName:  user?.name,
        customerEmail: user?.email,
        customerPhone: user?.phone,
        status:        THREAD_STATUS.AI,
        aiEnabled:     true
      });
    } else if (thread.status === THREAD_STATUS.RESOLVED) {
      await thread.update({
        status: THREAD_STATUS.AI, aiEnabled: true,
        resolvedAt: null, handledBy: null, escalationReason: null
      });
    }

    // Fetch history BEFORE saving the new message so it isn't duplicated
    const history = await buildHistory(thread.id);

    // Save customer message to DB
    await appendMessage(thread, 'customer', message, user?.name || 'Customer');

    // ── If a human agent is handling this, just queue and return ──
    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      const next = thread.status === THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status;
      await thread.update({ status: next });
      const io = req.app.get('io');
      if (io) io.emit('supportUpdated', { threadId: thread.id, status: next });
      return res.json({ success: true, thread: await serializeThread(thread) });
    }

    // ── Run Claude AI Agent ──
    let decision;
    try {
      decision = await runClaudeAgent(message, user, history);
    } catch (aiErr) {
      // Graceful degradation: escalate to human if Claude API fails
      console.error('Claude API error — escalating to human:', aiErr);
      const fallback = "I'm having a bit of trouble right now. Let me connect you with our store team who can help you immediately!";
      await appendMessage(thread, 'assistant', fallback, 'Lakshmi Assistant');
      await thread.update({ status: THREAD_STATUS.NEEDS_ADMIN, priority: 'normal', escalationReason: 'AI engine error', aiEnabled: false });
      await notifyAdmin(req, thread, 'AI engine failure', message);
      return res.json({ success: true, thread: await serializeThread(thread) });
    }

    // Save Claude's reply
    if (decision.reply) await appendMessage(thread, 'assistant', decision.reply, 'Lakshmi Assistant');

    // Update thread state
    if (decision.type === 'escalate') {
      await thread.update({
        status:           THREAD_STATUS.NEEDS_ADMIN,
        priority:         'urgent',
        escalationReason: decision.reason,
        aiEnabled:        false
      });
      await notifyAdmin(req, thread, decision.reason, message);
    } else {
      await thread.update({ status: THREAD_STATUS.AI, priority: 'normal', aiEnabled: true });
    }

    return res.json({ success: true, thread: await serializeThread(thread) });

  } catch (error) {
    console.error('Chat endpoint error:', error);
    return res.status(500).json({ success: false, message: 'Support assistant failed to respond.' });
  }
};

// ─── Admin Routes (unchanged) ─────────────────────────────────────────────────
exports.getPublicThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch thread.' });
  }
};

exports.getThreads = async (req, res) => {
  try {
    const { status } = req.query;
    const where =
      status === 'active' ? { status: { [Op.ne]: THREAD_STATUS.RESOLVED } }
      : status            ? { status }
      :                     {};
    const threads = await SupportThread.findAll({ where, order: [['updatedAt', 'DESC']], limit: 50 });
    res.json({ success: true, data: await Promise.all(threads.map(serializeThread)) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch threads.' });
  }
};

exports.adminReply = async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ success: false, message: 'Message is required.' });

    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await appendMessage(thread, 'admin', message, req.user?.name || 'Store Manager');
    await thread.update({ status: THREAD_STATUS.HUMAN_ACTIVE, aiEnabled: false, handledBy: req.user?.name });

    const io = req.app.get('io');
    if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to send reply.' });
  }
};

exports.resolveThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    await appendMessage(thread, 'system', 'Conversation marked resolved by the store team.', 'System');
    await thread.update({ status: THREAD_STATUS.RESOLVED, aiEnabled: false, resolvedAt: new Date() });

    const io = req.app.get('io');
    if (io) io.emit('supportUpdated', { threadId: thread.id, status: thread.status });
    res.json({ success: true, thread: await serializeThread(thread) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to resolve thread.' });
  }
};
