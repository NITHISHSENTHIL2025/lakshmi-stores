const resolveContext = (
  rawText,
  analysis,
  memoryContext = {}
) => {

  const text =
    String(rawText || '')
      .toLowerCase()
      .trim();

  let resolvedIntent =
    analysis.primaryIntent;

  let resolvedTokens = [
    ...(analysis.extractedTokens || [])
  ];

  let isFollowUp = false;

  const followUps = [

    'still waiting',
    'same problem',
    'not fixed',
    'again',
    'still',
    'help',
    'same issue',
    'waiting',
    'not working'

  ];

  if (followUps.includes(text)) {

    if (
      memoryContext.currentIssue &&
      memoryContext.currentIssue !== 'none'
    ) {

      resolvedIntent =
        memoryContext.currentIssue;

      isFollowUp = true;

    } else {

      resolvedIntent =
        'human_request';

      isFollowUp = true;

    }

  }

  if (

    ['price_query',
     'stock_query',
     'product_search'
    ].includes(resolvedIntent)

  ) {

    if (
      resolvedTokens.length === 0 &&
      memoryContext.lastProduct
    ) {

      resolvedTokens.push(
        memoryContext.lastProduct
      );

      isFollowUp = true;

    }

  }

  const moodHistory =
    memoryContext.moodHistory || [];

  const recent =
    moodHistory.slice(-3);

  const angerCount =
    recent.filter(
      mood => mood === 'negative'
    ).length;

  if (

    angerCount >= 2 &&
    analysis.sentiment === 'negative'

  ) {

    resolvedIntent =
      'negative_sentiment';

  }

  return {

    ...analysis,

    primaryIntent:
      resolvedIntent,

    extractedTokens:
      resolvedTokens,

    isFollowUp

  };

};

module.exports = {
  resolveContext
};