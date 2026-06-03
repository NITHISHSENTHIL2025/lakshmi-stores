const STOP_WORDS = new Set(['a', 'an', 'the', 'is', 'at', 'which', 'on', 'for', 'of', 'to', 'in', 'and', 'my', 'me', 'i', 'can', 'you', 'do', 'have', 'please', 'tell', 'what', 'where', 'how', 'much', 'many', 'will', 'are', 'am', 'was', 'were', 'it', 'this', 'that', 'there']);

const REGIONAL_TRANSLATIONS = {
  // Telugu & Hinglish Mappings
  'ayipoindi': 'completed',
  'ayindi': 'completed',
  'ledhu': 'not received',
  'raaledu': 'not received',
  'ravatledu': 'not receiving',
  'avvatledu': 'failing',
  'cut': 'deducted',
  'paise': 'money',
  'paisa': 'money',
  'karo': 'do',
  'nahi': 'not',
  'kya': 'what'
};

const PRODUCT_ALIASES = {
  'coke': 'coca cola',
  'thumbs up': 'thums up',
  'veggies': 'vegetables',
  'dal': 'lentils',
  'atta': 'flour',
  'chini': 'sugar',
  'paani': 'water',
  'maggie': 'maggi',
  'sprite bottle': 'sprite'
};

const expandSynonyms = (text) => {
  let expanded = String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Apply Regional Translations
  for (const [slang, trueWord] of Object.entries(REGIONAL_TRANSLATIONS)) {
    expanded = expanded.replace(new RegExp(`\\b${slang}\\b`, 'g'), trueWord);
  }
  // Apply Product Aliases
  for (const [alias, trueWord] of Object.entries(PRODUCT_ALIASES)) {
    expanded = expanded.replace(new RegExp(`\\b${alias}\\b`, 'g'), trueWord);
  }
  
  return expanded;
};

const getTokens = (text) => {
  return expandSynonyms(text)
    .split(' ')
    .filter(word => !STOP_WORDS.has(word) && word.length > 1);
};

module.exports = { STOP_WORDS, expandSynonyms, getTokens };