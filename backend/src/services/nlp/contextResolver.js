const resolveContext = (cleanText, analysis, memoryContext) => {
  let resolvedIntent = analysis.primaryIntent;
  let resolvedTokens = [...analysis.extractedTokens];
  let isFollowUp = false;

  const text = cleanText.toLowerCase();

  // 1. Issue Continuation (The "Still Waiting" matrix)
  if (/^(still waiting|not fixed|same problem|again|not working|still|help)$/.test(text)) {
    if (memoryContext.currentIssue && memoryContext.currentIssue !== 'none') {
      resolvedIntent = memoryContext.currentIssue;
      isFollowUp = true;
    } else {
      resolvedIntent = 'human_request'; // No context? Just get them a human.
    }
  }

  // 2. Product Context Continuation (The "Price?" matrix)
  if (['price_query', 'stock_query'].includes(resolvedIntent) && resolvedTokens.length === 0) {
    if (memoryContext.lastProduct) {
      // Inject the previous product into the current analysis
      resolvedTokens.push(memoryContext.lastProduct);
      isFollowUp = true;
    }
  }

  // 3. Mood Tracking Escalation
  const moodHistory = memoryContext.moodHistory || [];
  const recentMoods = moodHistory.slice(-3); // Look at last 3 turns
  const angerCount = recentMoods.filter(m => m === 'negative').length;

  if (angerCount >= 2 && analysis.sentiment === 'negative') {
    resolvedIntent = 'negative_sentiment'; // Override to escalate immediately
  }

  return {
    ...analysis,
    primaryIntent: resolvedIntent,
    extractedTokens: resolvedTokens,
    isFollowUp
  };
};

module.exports = { resolveContext };