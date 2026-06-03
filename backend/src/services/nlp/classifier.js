const { expandSynonyms } = require('./dictionary');
const { INTENT_KEYWORDS, SEVERITY_LEVELS } = require('./intents');

const NEGATIVE_WORDS = ['worst', 'terrible', 'useless', 'hate', 'garbage', 'bad', 'angry', 'frustrated', 'idiot', 'stupid', 'scam', 'fake', 'fraud', 'cheating', 'pathetic', 'disappointed', 'horrible'];
const SARCASM_REGEX = /\b(wow|amazing|great|nice|awesome|excellent)\b.*\b(never arrived|nothing|worst|not received|money gone|deducted|missing|bad|late)\b/i;

const analyzeSentiment = (text) => {
  if (SARCASM_REGEX.test(text)) return { mood: 'negative', isSarcastic: true };
  if (NEGATIVE_WORDS.some(w => text.includes(w))) return { mood: 'negative', isSarcastic: false };
  if (/\b(happy|thanks|love|great)\b/.test(text)) return { mood: 'positive', isSarcastic: false };
  return { mood: 'neutral', isSarcastic: false };
};

const classifyMessage = (rawText, memoryContext) => {
  const clean = expandSynonyms(rawText);
  const sentiment = analyzeSentiment(clean);
  
  let detectedIntents = [];

  if (sentiment.mood === 'negative') {
    detectedIntents.push({ intent: 'negative_sentiment', score: 100, confidence: 100 });
  }

  // Multi-Intent Scoring
  Object.entries(INTENT_KEYWORDS).forEach(([intent, phrases]) => {
    let score = 0;
    phrases.forEach(phrase => {
      if (clean.includes(phrase)) {
        score += (phrase.split(' ').length * 25); 
      }
    });
    if (score > 0) {
      detectedIntents.push({ intent, score, confidence: Math.min(score, 98) });
    }
  });

  // Memory Context Injection
  if (detectedIntents.length === 0 && clean.split(' ').length <= 4) {
    if (memoryContext && memoryContext.lastIntent && memoryContext.lastIntent !== 'unknown') {
      // e.g., User says "still waiting" after a "missing_order" intent
      detectedIntents.push({ intent: memoryContext.lastIntent, score: 50, confidence: 75 });
    }
  }

  // Fallback Logic
  if (detectedIntents.length === 0) {
    if (clean.split(' ').length <= 2) {
      detectedIntents.push({ intent: 'greeting', score: 10, confidence: 40 });
    } else {
      detectedIntents.push({ intent: 'unknown', score: 0, confidence: 0 });
    }
  }

  // Sort strictly by Severity, then by Confidence
  detectedIntents.sort((a, b) => {
    const sevA = SEVERITY_LEVELS[a.intent] || 0;
    const sevB = SEVERITY_LEVELS[b.intent] || 0;
    if (sevB !== sevA) return sevB - sevA;
    return b.confidence - a.confidence;
  });

  return {
    primaryIntent: detectedIntents[0].intent,
    secondaryIntents: detectedIntents.slice(1).map(i => i.intent),
    confidence: detectedIntents[0].confidence,
    severity: SEVERITY_LEVELS[detectedIntents[0].intent] || 0,
    sentiment: sentiment.mood,
    isSarcastic: sentiment.isSarcastic
  };
};

module.exports = { classifyMessage };