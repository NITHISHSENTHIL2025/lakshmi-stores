const {
  INTENT_KEYWORDS = {},
  SEVERITY_LEVELS = {},
  NEGATIVE_WORDS = [],
  SARCASM_REGEX = /$^/
} = require('./intents');

const {
  expandSynonyms,
  getTokens
} = require('./dictionary');

function classifyMessage(rawText = '') {

  try {

    const clean = String(
      expandSynonyms(rawText || '')
    ).toLowerCase();

    const extractedTokens =
      getTokens(clean) || [];

    let isSarcastic = false;

    try {
      const normalized =
        clean.replace(/\n/g, ' ');

      isSarcastic =
        SARCASM_REGEX &&
        SARCASM_REGEX.test(normalized);

    } catch {
      isSarcastic = false;
    }

    let mood = 'neutral';

    if (
      isSarcastic ||
      NEGATIVE_WORDS.some(
        word => clean.includes(word)
      )
    ) {
      mood = 'negative';
    }

    if (
      /\b(thanks|thank you|awesome|great|love|good)\b/i
        .test(clean) &&
      !isSarcastic
    ) {
      mood = 'positive';
    }

    const detectedIntents = [];

    Object.entries(INTENT_KEYWORDS)
      .forEach(([intent, phrases]) => {

        let score = 0;

        (phrases || []).forEach(phrase => {

          if (
            clean.includes(
              String(phrase).toLowerCase()
            )
          ) {

            score +=
              phrase.split(' ').length * 20;

          }

        });

        if (score > 0) {

          detectedIntents.push({
            intent,
            score,
            confidence:
              Math.min(score, 98)
          });

        }

      });

    if (detectedIntents.length === 0) {

      if (
        extractedTokens.length <= 2
      ) {

        detectedIntents.push({
          intent: 'unknown',
          score: 5,
          confidence: 20
        });

      } else {

        detectedIntents.push({
          intent: 'product_search',
          score: 10,
          confidence: 30
        });

      }

    }

    detectedIntents.sort(
      (a, b) => {

        const sevA =
          SEVERITY_LEVELS[a.intent] || 0;

        const sevB =
          SEVERITY_LEVELS[b.intent] || 0;

        if (sevB !== sevA) {
          return sevB - sevA;
        }

        return (
          b.confidence -
          a.confidence
        );

      }
    );

    const primaryIntent =
      detectedIntents[0]?.intent ||
      'unknown';

    const secondaryIntents =
      detectedIntents
        .slice(1)
        .map(i => i.intent);

    return {

      primaryIntent,

      secondaryIntents,

      confidence:
        detectedIntents[0]
          ?.confidence || 20,

      severity:
        SEVERITY_LEVELS[
          primaryIntent
        ] || 0,

      sentiment: mood,

      isSarcastic,

      extractedTokens

    };

  } catch (err) {

    console.error(
      'Classifier crash:',
      err
    );

    return {

      primaryIntent: 'unknown',
      secondaryIntents: [],
      confidence: 0,
      severity: 0,
      sentiment: 'neutral',
      isSarcastic: false,
      extractedTokens: []

    };

  }

}

module.exports = {
  classifyMessage
};