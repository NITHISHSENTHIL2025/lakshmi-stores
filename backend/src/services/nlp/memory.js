const updateConversationMemory = (currentThreadMemory, resolvedAnalysis, productMatch, ticketId) => {
  const memory = currentThreadMemory || {
    lastIntent: 'unknown',
    currentIssue: 'none',
    lastProduct: null,
    escalationLevel: 'none',
    sentiment: 'neutral',
    moodHistory: [],
    activeTicket: null
  };

  // 1. Core State
  memory.lastIntent = resolvedAnalysis.primaryIntent;
  memory.sentiment = resolvedAnalysis.sentiment;
  
  // Keep last 5 moods
  memory.moodHistory.push(resolvedAnalysis.sentiment);
  if (memory.moodHistory.length > 5) memory.moodHistory.shift();
  
  // 2. Issue Tracking
  if (resolvedAnalysis.severity >= 50 && !['negative_sentiment', 'human_request'].includes(resolvedAnalysis.primaryIntent)) {
    memory.currentIssue = resolvedAnalysis.primaryIntent;
  }

  // 3. Entity Tracking
  if (productMatch && productMatch.name) {
    memory.lastProduct = productMatch.name.toLowerCase();
  }

  // 4. Ticket Tracking
  if (ticketId) {
    memory.activeTicket = ticketId;
  }

  return memory;
};

module.exports = { updateConversationMemory };