cat > /mnt/user-data/outputs/supportController.js << 'ENDOFFILE'
'use strict';

const jwt    = require('jsonwebtoken');
const { Op } = require('sequelize');
const {
  Product, Order, OrderItem, User,
  Notification, StoreSetting, ItemRequest,
  SupportThread, SupportMessage
} = require('../models');

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║         LAKSHMI STORES — SUPERB CUSTOM NLP SUPPORT ENGINE v3.0             ║
// ║  Zero external deps · Human-like · Context-aware · Smart escalation        ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

const STORE_CLOSE_TIME     = process.env.STORE_CLOSE_TIME || '10:00 PM';
const PICKUP_READY_MINUTES = parseInt(process.env.PICKUP_READY_MINUTES || '10', 10);

const THREAD_STATUS = {
  AI:           'ai_answering',
  NEEDS_ADMIN:  'needs_admin',
  HUMAN_ACTIVE: 'human_active',
  RESOLVED:     'resolved'
};

// ════════════════════════════════════════════════════════════════
// §1  TEXT NORMALIZATION
// ════════════════════════════════════════════════════════════════

const CONTRACTIONS = {
  "don't":"do not","doesn't":"does not","didn't":"did not","can't":"cannot",
  "won't":"will not","wouldn't":"would not","i'm":"i am","i've":"i have",
  "i'll":"i will","i'd":"i would","it's":"it is","that's":"that is",
  "there's":"there is","they're":"they are","we're":"we are","you're":"you are",
  "what's":"what is","where's":"where is","how's":"how is","haven't":"have not",
  "hasn't":"has not","hadn't":"had not","isn't":"is not","aren't":"are not",
  "wasn't":"was not","weren't":"were not","couldn't":"could not",
  "shouldn't":"should not","mustn't":"must not","needn't":"need not",
  "who's":"who is","when's":"when is","why's":"why is"
};

const SYNONYMS = {
  // ── Beverages ──
  'coke':'coca cola','cold drink':'beverage','soft drink':'beverage',
  'thumbs up':'thums up','7up':'seven up','nimbu pani':'lemon water',
  'nimbu':'lemon','nariyal pani':'coconut water','chaas':'buttermilk',
  'lassi':'curd drink',
  // ── Staples ──
  'atta':'wheat flour','maida':'refined flour','besan':'chickpea flour',
  'suji':'semolina','rava':'semolina','sooji':'semolina',
  'chawal':'rice','basmati':'basmati rice','chini':'sugar','cheeni':'sugar',
  'shakkar':'jaggery','gur':'jaggery','namak':'salt','tel':'oil',
  'sarso ka tel':'mustard oil','nariyal tel':'coconut oil',
  // ── Dal / Lentils ──
  'dal':'lentils','dhal':'lentils','toor dal':'pigeon pea lentils',
  'masoor dal':'red lentils','moong dal':'mung lentils','chana':'chickpeas',
  'rajma':'kidney beans','lobiya':'black eyed peas',
  // ── Dairy ──
  'doodh':'milk','ghee':'clarified butter','dahi':'curd','paneer':'cottage cheese',
  'makhan':'butter','malai':'cream',
  // ── Vegetables ──
  'veggies':'vegetables','veggie':'vegetables','sabzi':'vegetables',
  'aloo':'potato','tamatar':'tomato','pyaz':'onion','adrak':'ginger',
  'lahsun':'garlic','mirch':'chilli','haldi':'turmeric','dhania':'coriander',
  'jeera':'cumin','methi':'fenugreek','palak':'spinach','bhindi':'okra',
  'karela':'bitter gourd','tinda':'round gourd','lauki':'bottle gourd',
  // ── Snacks ──
  'namkeen':'savory snacks','chakli':'crispy snack','sev':'fried snack',
  'kurkure':'corn puffs','lays':'potato chips','biscuit':'cookies',
  // ── Query synonyms ──
  'cost':'price','rate':'price','rupees':'price','rs':'price','kitna':'price',
  'daam':'price','paisa':'price','how much is':'price of','kya price':'price of',
  'milega':'available','hai kya':'is available','kya hai':'what is',
  'chahiye':'need','do you have':'available','kya aapke paas':'available',
  // ── Order ──
  'order kahan hai':'order status','order kab aayega':'order ready time',
  'order nahi mila':'order not received','order mil gaya':'order received',
  'token':'order token','pin':'order token','order number':'order id',
  'track':'order status','where is my order':'order status',
  // ── Store ──
  'band hai kya':'is store closed','khula hai kya':'is store open',
  'kab khulta hai':'store opening time','kab band hota hai':'store closing time',
  'timing':'store hours','open hai kya':'is store open',
  // ── General ──
  'ok':'okay','k':'okay','okok':'okay','hmm':'okay','yaar':'friend',
  'thk':'thanks','thnx':'thanks','ty':'thanks','thx':'thanks',
  'pls':'please','plz':'please','plss':'please','kindly':'please',
  'wanna':'want to','gonna':'going to','gotta':'got to',
  'lmk':'let me know','asap':'as soon as possible','fyi':'for your information',
  'nope':'no','yep':'yes','yup':'yes','yeah':'yes','ya':'yes','nah':'no',
  'urgent':'immediately','hurry':'immediately'
};

const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could',
  'should','may','might','shall','can','need','dare','used',
  'at','by','for','from','in','into','of','on','to','up','with',
  'about','above','after','along','also','although','and','any','as',
  'because','before','between','both','but','each','either','even',
  'every','few','hence','here','if','it','its','just','me','more',
  'most','much','my','nor','not','now','or','other','our','out',
  'own','per','quite','rather','same','since','so','some','such',
  'than','that','their','them','then','there','these','they','this',
  'those','through','too','under','until','us','very','via',
  'what','when','where','which','while','who','whom','whose','why',
  'within','without','yet','you','your','i','im','ive','id','ill',
  'tell','let','get','like','please','dear','sir','madam','ji',
  'want','need','know','see','look','show','give','take','make','want'
]);

const normalize = (text) => {
  let t = String(text || '').toLowerCase().trim();
  for (const [c, e] of Object.entries(CONTRACTIONS)) {
    t = t.replace(new RegExp(`\\b${c.replace(/'/g, "'")}\\b`, 'g'), e);
  }
  for (const [s, canon] of Object.entries(SYNONYMS)) {
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`\\b${escaped}\\b`, 'g'), canon);
  }
  return t;
};

const tokenize = (text) =>
  normalize(text)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));

// ════════════════════════════════════════════════════════════════
// §2  FUZZY STRING MATCHING (Levenshtein + Similarity)
// ════════════════════════════════════════════════════════════════

const levenshtein = (a, b) => {
  if (!a) return b.length;
  if (!b) return a.length;
  const m = [];
  for (let i = 0; i <= a.length; i++) m[i] = [i];
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+c);
    }
  }
  return m[a.length][b.length];
};

const strSimilarity = (a, b) => {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1.0 : 1 - levenshtein(a, b) / maxLen;
};

// ════════════════════════════════════════════════════════════════
// §3  SENTIMENT ANALYZER
// ════════════════════════════════════════════════════════════════

const SENTIMENT = {
  veryAngry:  ['furious','outraged','ridiculous','useless','hopeless','pathetic','fraud',
               'scam','cheated','liar','liars','worst ever','absolutely terrible',
               'complete waste','disgusting','unacceptable','irresponsible','this is a joke'],
  angry:      ['angry','bad','terrible','horrible','awful','poor','damaged','wrong item',
               'wrong product','not working','broken','expired','spoiled','rotten','unfair',
               'not happy','very unhappy','really bad','so bad','disappointing'],
  complaint:  ['issue','problem','complaint','mistake','error','missing','wrong','late',
               'delayed','overcharged','extra charge','double charged','not received',
               'not delivered','where is','havent received','not given'],
  urgent:     ['urgent','immediately','right now','asap','emergency','right away','quickly',
               'fast','hurry','please hurry','very important','critical'],
  wantsRefund:['refund','money back','return money','get money back','reimburse',
               'reimbursement','wallet credit','compensation','compensate'],
  wantsCancel:['cancel','cancellation','cancel order','stop order','dont want order',
               'do not want','withdraw order'],
  wantsHuman: ['human','person','manager','owner','supervisor','staff','agent',
               'real person','customer care','talk to someone','speak to someone',
               'connect me to','need help from','escalate'],
  happy:      ['great','excellent','wonderful','fantastic','amazing','perfect','love',
               'awesome','brilliant','superb','best','happy','glad','pleased','satisfied',
               'very good','really good','nice','lovely','fresh','quality','impressed'],
  thankful:   ['thank you','thanks','thank you so much','thankyou','thanks a lot',
               'appreciate it','grateful','helpful','great help','good job','well done',
               'you helped','this is helpful','very helpful']
};

const analyzeSentiment = (text) => {
  const n = normalize(text);
  const r = {
    score:0, veryAngry:false, isAngry:false, hasComplaint:false,
    isUrgent:false, wantsRefund:false, wantsCancel:false,
    wantsHuman:false, isHappy:false, isThankful:false
  };
  for (const [cat, words] of Object.entries(SENTIMENT)) {
    const hits = words.filter(w => n.includes(w)).length;
    if (!hits) continue;
    switch (cat) {
      case 'veryAngry':    r.score -= hits*3; r.veryAngry=true; r.isAngry=true; break;
      case 'angry':        r.score -= hits*2; r.isAngry=true; break;
      case 'complaint':    r.score -= hits;   r.hasComplaint=true; break;
      case 'urgent':       r.isUrgent=true; break;
      case 'wantsRefund':  r.score -= 2; r.wantsRefund=true; break;
      case 'wantsCancel':  r.score -= 1; r.wantsCancel=true; break;
      case 'wantsHuman':   r.wantsHuman=true; break;
      case 'happy':        r.score += hits;   r.isHappy=true; break;
      case 'thankful':     r.score += hits*2; r.isThankful=true; break;
    }
  }
  r.score = Math.max(-10, Math.min(10, r.score));
  return r;
};

// ════════════════════════════════════════════════════════════════
// §4  INTENT CLASSIFIER (15 intents, multi-signal scoring)
// ════════════════════════════════════════════════════════════════

const INTENTS = {
  greeting: {
    w:3, thr:3,
    phrases:['hello','hi','hey','good morning','good afternoon','good evening','good night',
             'namaste','namaskar','hola','whats up','howdy','greetings','hai bhai',
             'hii','helloo','heyyy','hi there'],
    pats:[/^(hi+|hey+|hello+|namaste|namaskar|yo)\s*[!.?,]?\s*$/i,
          /^good\s+(morning|afternoon|evening|night)/i]
  },
  farewell: {
    w:4, thr:4,
    phrases:['bye','goodbye','see you','take care','later','cya','tata','have a good',
             'have a nice','good night','byebye','bbye','okbye','ttyl','talk later',
             'see you soon','bye bye'],
    pats:[/^(bye+|goodbye|tata|cya|later|gtg)\s*[!.?]?\s*$/i]
  },
  thanks: {
    w:3, thr:3,
    phrases:['thank you','thanks','thank you so much','thankyou','thanks a lot',
             'appreciate it','grateful','that helps','very helpful','helped me',
             'great help','good job','well done','thanks for help','dhanyawad'],
    pats:[/^thanks?\s*[!.?,]?\s*$/i,/^thank(s| you)\s*[!.?,]?\s*$/i]
  },
  product_inquiry: {
    w:2, thr:4,
    phrases:['do you have','is available','price of','cost of','how much is','rate of',
             'stock of','available in stock','can i buy','want to buy','looking for',
             'searching for','in stock','available','price','how much','do you sell',
             'get me','buy','purchase','is there','any stock'],
    pats:[/price.*(of|for)/i,/how much.*(is|for|cost)/i,/(do|did) you (have|sell|stock)/i,
          /is.*(available|in stock)/i,/(available|stock).*(of|for)/i,
          /can i (get|buy|order|have)/i]
  },
  order_status: {
    w:3, thr:3,
    phrases:['my order','order status','track order','where is order','order ready',
             'order update','order not received','waiting for order','check my order',
             'order number','order id','order placed','order confirmed','pickup token',
             'my token','when will order','order tracking','see my order'],
    pats:[/my order/i,/order (status|track|number|id|token|ready|update)/i,
          /when.*(order|ready|pickup|collect)/i,/track.*(order|package)/i,
          /(where|what).*(my order)/i]
  },
  store_info: {
    w:3, thr:3,
    phrases:['store timing','store hours','when open','when close','are you open',
             'shop open','shop close','opening time','closing time','store open',
             'store closed','what time','open today','currently open','closed now',
             'is the store','timings','kab khulta','kab band'],
    pats:[(/(what|when).*(time|hour)/i),(/(open|close).*(time|today|now|currently)/i),
          (/(is|are).*(shop|store).*(open|close)/i),(/store (timing|hours|schedule)/i)]
  },
  complaint: {
    w:4, thr:4,
    phrases:['wrong item','wrong product','damaged','spoiled','rotten','expired',
             'missing item','did not receive','not received','broken','quality issue',
             'bad quality','overcharged','wrong price','charged extra','paid too much',
             'not delivered','delivery issue','problem with order','order problem',
             'received wrong','got wrong','item missing','product missing',
             'sent wrong','gave wrong'],
    pats:[/(wrong|missing|damaged|expired|spoiled|broken).*(item|product|order|packet)/i,
          /(not|didn.t).*(receive|get|deliver)/i,/(over|extra|wrong).*(charged|charge|price)/i,
          /quality.*(bad|poor|issue|problem)/i,(/(item|product).*(missing|wrong|damaged)/i)]
  },
  refund_request: {
    w:5, thr:5,
    phrases:['refund','money back','return money','want refund','need refund',
             'get refund','wallet credit','reimburse','reimbursement','payback',
             'return amount','give back money','credit my wallet'],
    pats:[/refund/i,/money back/i,/return (my )?money/i,/want.*(money|refund)/i,
          /credit.*(wallet|account)/i]
  },
  cancellation: {
    w:5, thr:5,
    phrases:['cancel order','cancel my order','want to cancel','need to cancel',
             'stop my order','dont want order','order cancel','cancellation',
             'please cancel','withdraw order','take back order'],
    pats:[/cancel.*(order|my order)/i,/want.*(cancel|stop).*(order)/i,
          /order.*(cancel|stop|withdraw)/i]
  },
  privacy_policy: {
    w:4, thr:4,
    phrases:['privacy policy','data privacy','my data','personal information',
             'data security','how data used','share my data','protect data',
             'data protection','delete my account','delete account','my information',
             'what data','safe to use','is my data safe','store my data','gdpr',
             'information security','personal data'],
    pats:[/privacy.*(policy|data)/i,/data.*(privacy|security|safe|protect)/i,
          /my.*(data|information).*(safe|secure|protected|used)/i,
          /delete.*(account|data|my data)/i]
  },
  payment_inquiry: {
    w:3, thr:3,
    phrases:['payment','how to pay','payment method','upi','gpay','google pay','paytm',
             'phonepe','bhim','cash','card','online payment','payment failed',
             'payment issue','debit card','credit card','net banking','payment options',
             'pay online','accept upi','payment not done','transaction failed',
             'deducted','amount deducted','money deducted'],
    pats:[/payment.*(method|option|mode|failed|issue|not done)/i,
          /how.*(pay|payment)/i,/(upi|gpay|paytm|phonepe|cash|card).*(accept|pay|use)/i,
          /(amount|money).*(deducted|debited)/i]
  },
  delivery_inquiry: {
    w:3, thr:3,
    phrases:['delivery','home delivery','deliver to','delivery charge','delivery time',
             'delivery available','do you deliver','can you deliver','pickup',
             'how to collect','collect order','pickup point','pickup location',
             'door delivery','where to collect','where to pick'],
    pats:[/deliver(y|ing).*(available|home|charge|time|option)/i,
          /do you (deliver|give delivery)/i,/home.*(delivery|deliver)/i,
          /pickup.*(point|location|where|how)/i,/how.*(collect|pickup)/i]
  },
  return_policy: {
    w:4, thr:4,
    phrases:['return policy','return item','exchange','replace item','replacement',
             'want to return','can i return','how to return','return product',
             'give back','return procedure','exchange policy','return rules'],
    pats:[/return.*(policy|item|product|order)/i,
          /(exchange|replace|replacement).*(item|product)/i,
          /can i (return|exchange|replace)/i,/how.*(return|exchange)/i]
  },
  about_store: {
    w:3, thr:3,
    phrases:['about store','lakshmi stores','about lakshmi','who are you',
             'what are you','tell me about','store info','store information',
             'contact','location','address','where are you','store address',
             'phone number','contact number','tell me more','what is lakshmi'],
    pats:[/about.*(store|lakshmi|you)/i,/(contact|address|location|phone)/i,
          /where.*(you|store|shop|located)/i,/tell me (about|more)/i]
  },
  human_request: {
    w:6, thr:6,
    phrases:['talk to human','speak to human','real person','talk to manager',
             'connect to manager','speak to manager','human agent','customer care',
             'support team','talk to someone','need help from human','connect me',
             'need a person','want to speak','get manager','call manager',
             'speak with someone','chat with human','i need human'],
    pats:[(/(talk|speak|connect|chat).*(human|person|manager|agent|someone)/i),
          (/real (person|human|agent|representative)/i),
          (/customer (care|support|service)/i),
          (/(get|call|need).*(manager|owner|supervisor)/i)]
  },
  general_help: {
    w:2, thr:2,
    phrases:['help','how does','how to','what can you do','explain','not sure',
             'confused','dont understand','help me','can you help','guide me',
             'i need help','what do you do','how can you help','what services'],
    pats:[/^help\s*[!.?]?\s*$/i,/how (to|do|does|can)/i,/can you help/i,
          /what (can|do) you/i]
  }
};

const classifyIntent = (text, ctx = {}) => {
  const n      = normalize(text);
  const tokens = tokenize(text);
  const scores = {};

  for (const [intent, cfg] of Object.entries(INTENTS)) {
    let score = 0;
    for (const ph of cfg.phrases) {
      if (n.includes(ph)) {
        score += cfg.w;
        if (n.startsWith(ph)) score += 1;
      }
    }
    if (cfg.pats) {
      for (const pat of cfg.pats) if (pat.test(n)) score += cfg.w + 2;
    }
    // Fuzzy token match against phrase words
    for (const ph of cfg.phrases) {
      for (const pw of ph.split(' ')) {
        if (pw.length < 4) continue;
        for (const tok of tokens) {
          if (tok.length < 4) continue;
          if (strSimilarity(tok, pw) > 0.85) score += 1;
        }
      }
    }
    scores[intent] = score;
  }

  // Context boosting: continue same topic naturally
  if (ctx.lastIntent) {
    scores[ctx.lastIntent] = (scores[ctx.lastIntent] || 0) + 2;
  }
  // Pending-question context boosts
  if (ctx.pendingQ === 'order_token' && /[A-Za-z0-9]{4,8}/.test(text)) {
    scores.order_status = (scores.order_status || 0) + 10;
  }
  if (ctx.pendingQ === 'product_confirm') {
    if (/\b(yes|yeah|yep|correct|right|exactly|that|sure|ok|okay|ha|haan)\b/.test(n)) scores._yes = 10;
    if (/\b(no|nope|nah|not|different|other|else|another|nahi)\b/.test(n)) scores._no = 10;
  }

  let top = 'product_inquiry';
  let topScore = 0;
  for (const [intent, score] of Object.entries(scores)) {
    const thr = INTENTS[intent]?.thr || 2;
    if (score >= thr && score > topScore) { topScore = score; top = intent; }
  }

  return { intent: top, score: topScore, allScores: scores, tokens, normalized: n };
};

// ════════════════════════════════════════════════════════════════
// §5  ENTITY EXTRACTOR
// ════════════════════════════════════════════════════════════════

const extractEntities = (text) => {
  const n = normalize(text);
  const raw = String(text);
  const e = { quantity:null, priceLimit:null, orderToken:null, productKeywords:[] };

  // Quantity: "2 kg", "500g", "1 liter", "3 packets"
  const qty = n.match(/(\d+\.?\d*)\s*(kg|gram|grams|g\b|liter|litre|liters|litres|l\b|ml|piece|pieces|pack|packs|packet|packets|unit|units|bottle|bottles|bag|bags|dozen|box|boxes)/i);
  if (qty) e.quantity = { amount: parseFloat(qty[1]), unit: qty[2] };

  // Price limit: "under ₹100", "less than 50"
  const pr = n.match(/(?:under|less than|below|up to|max|within|around|about)\s*(?:rs\.?|₹|inr)?\s*(\d+)/i);
  if (pr) e.priceLimit = parseInt(pr[1]);

  // Order token: uppercase alphanumeric 4-8 chars
  const tok = raw.match(/\b([A-Z0-9]{4,8})\b/);
  if (tok) e.orderToken = tok[1];

  // Product keywords
  e.productKeywords = tokenize(text).filter(w =>
    !['store','shop','order','today','now','time','available','price','stock',
      'open','close','please','help','need','want','buy','how','much'].includes(w)
  );
  return e;
};

// ════════════════════════════════════════════════════════════════
// §6  KNOWLEDGE BASE
// ════════════════════════════════════════════════════════════════

const KB = {
  privacy: [
    `Your personal information — like your name, phone number, and address — is used **only** to process your orders and provide customer support. We never sell or share your data with third parties, advertisers, or any outside company.`,
    `At Lakshmi Stores, we take your privacy seriously. All data you share (name, phone, email) is stored securely, used exclusively for order management, and is never shared outside our organisation.`,
    `Your data is completely safe with us. We only collect what's necessary to serve you well — contact details and order history — and it stays strictly within our system. No third-party sharing, ever.`,
    `We respect your privacy fully. Personal details you share with us are protected and used only for order processing and customer support. You can request to have your data deleted at any time by reaching out to our team.`,
    `Lakshmi Stores collects minimal personal data (name, phone, email) solely for managing your orders and improving your experience. We follow strong data-protection practices and never misuse your information.`
  ],
  returnPolicy: [
    `If something went wrong with your order — wrong item, damaged goods, or quality issue — please report it within **24 hours of pickup** and we'll make it right with a replacement or refund.`,
    `We have a fair and easy return policy. If you received a wrong or damaged item, let us know within 24 hours with your order token and we'll arrange a replacement or refund promptly.`,
    `Quality and correctness of orders is our responsibility. For any issue with an order — wrong item, spoiled product, or short quantity — raise it within 24 hours and we'll resolve it to your satisfaction.`,
    `Returns and replacements are accepted for damaged, expired, or incorrectly packed items. Just contact us within 24 hours of pickup with your order number and we'll sort it out right away.`
  ],
  payment: [
    `We accept **UPI** (GPay, PhonePe, Paytm, BHIM, any UPI app), **debit/credit cards**, and **cash** at the counter. Online payments go through our secure Cashfree payment gateway.`,
    `You can pay using any UPI app (Google Pay, PhonePe, Paytm, BHIM), debit or credit card, or good old cash. Our payment gateway is fully secure and we don't store your card details.`,
    `Payment options at Lakshmi Stores: UPI (any app), debit/credit card, or cash. All online transactions are encrypted and processed by our trusted payment partner.`,
    `We support all popular payment methods — UPI, cards (debit/credit), and cash. If you're paying online, the transaction is completely secure. We'd never store your payment credentials.`
  ],
  delivery: [
    `Currently, we operate as a **pickup-only** store. You can place your order online and collect it at our counter — it's usually packed and ready in just ${PICKUP_READY_MINUTES} minutes!`,
    `We offer a convenient order-online, collect-in-store model. Place your order through the app, and your items will be packed and waiting at the counter within about ${PICKUP_READY_MINUTES} minutes.`,
    `We don't offer home delivery at the moment, but our in-store pickup is really quick — typically under ${PICKUP_READY_MINUTES} minutes from order to collection!`,
    `Orders are prepared for counter pickup. Just order through the app, and by the time you walk in, your items will be ready and bagged. Usually takes ${PICKUP_READY_MINUTES} minutes or less!`
  ],
  about: [
    `Lakshmi Stores is your friendly neighbourhood grocery and convenience shop! We stock a wide range of daily essentials — fresh produce, packaged foods, snacks, beverages, dairy, and more.`,
    `We're Lakshmi Stores — a trusted local grocery shop serving the community. From fresh vegetables to packaged goods, dal to dairy, we've got your daily needs covered!`,
    `Lakshmi Stores is a neighbourhood convenience store offering quality groceries, snacks, beverages, and daily essentials at fair prices. We're here to make your shopping easy and pleasant!`,
    `Welcome to Lakshmi Stores! We're your one-stop shop for everyday groceries and household needs — fresh, affordable, and always there for you whenever you need us.`
  ],
  offers: [
    `We regularly run special deals and offers on our app. Keep an eye on the offers section for the latest discounts on popular items!`,
    `Check out the app's offers section for our latest deals. We frequently have discounts on essentials and popular products.`,
    `We do have special offers from time to time! You'll find the current deals on our app. Stay tuned — we update them regularly.`,
    `Our team updates offers regularly on the app. Make sure to check the offers section before placing your order to grab the best deals!`
  ]
};

// ════════════════════════════════════════════════════════════════
// §7  RESPONSE LIBRARY — 350+ unique reply variants
// ════════════════════════════════════════════════════════════════

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Small building blocks for natural variety
const OPENER = {
  positive:  ()=>pick(['Sure!','Absolutely!','Of course!','Happy to help!','Great!','Certainly!']),
  empathy:   ()=>pick(['I completely understand.','I hear you.','I\'m sorry about that.','That\'s frustrating, I know.']),
  checking:  ()=>pick(['Let me check that for you...','One moment while I look that up!','Checking now...','Let me look into that!']),
  found:     ()=>pick(['Good news!','Great news!','Found it!','Here you go!']),
  notFound:  ()=>pick(['Hmm...','Unfortunately...','Sorry about this —','I\'m afraid...'])
};
const CLOSER = {
  help:     ()=>pick(['Is there anything else I can help with?','Anything else on your mind?','Need help with anything else?','What else can I do for you?','Feel free to ask if you need anything else!']),
  care:     ()=>pick(['Please don\'t hesitate to ask if you need more help!','I\'m always here if you need me!','Reach out anytime!']),
  resolve:  ()=>pick(['I want to make sure this gets sorted for you!','We\'re on it!','Our team will take care of this promptly.'])
};

const R = {

  // ── Greetings ────────────────────────────────────────────────
  greet: (name, hour) => {
    const first = name ? `, ${name.split(' ')[0]}` : '';
    const tg = hour<12 ? 'Good morning' : hour<17 ? 'Good afternoon' : 'Good evening';
    return pick([
      `${tg}${first}! Welcome to Lakshmi Stores. How can I help you today?`,
      `Hello${first}! Welcome. I'm your Lakshmi Stores assistant — ask me anything about products, orders, or the store!`,
      `Hi${first}! Great to see you at Lakshmi Stores. What can I do for you?`,
      `${tg}${first}! I'm here to help with product availability, prices, orders, store info — just ask!`,
      `Namaste${first}! Welcome to Lakshmi Stores. What are you looking for today?`,
      `Hey there${first}! Welcome. How can I make things easier for you today?`,
      `Hello${first}! Lakshmi Stores at your service. Whether it's a product price or your order status — I've got you covered. What's up?`,
      `Hi${first}! Nice to hear from you. I can help with products, store timings, your order, and more. What do you need?`,
      `${tg}${first}! Welcome to Lakshmi Stores. Feel free to ask about anything at all — I'm here!`,
      `Namaste${first}! How can I assist you today? Whether it's products, orders, or store info — I'm all ears!`
    ]);
  },

  // ── Farewell ─────────────────────────────────────────────────
  farewell: (name) => {
    const n = name ? `, ${name.split(' ')[0]}` : '';
    return pick([
      `Take care${n}! Come back soon. 😊`,
      `Goodbye${n}! Have a wonderful day ahead!`,
      `See you next time${n}! Thank you for choosing Lakshmi Stores.`,
      `Bye${n}! We're always here whenever you need us.`,
      `Take care${n}! It was great chatting with you. Have a lovely day!`,
      `Goodbye${n}! We really appreciate your business. See you soon!`,
      `All the best${n}! Feel free to drop by anytime you need help. Take care!`,
      `Byebye${n}! Have a great one. Don't hesitate to reach out anytime. 😊`,
      `See you soon${n}! Hope we could help. Wishing you a great day!`,
      `Okay${n}, take care and see you soon! Lakshmi Stores is always here for you.`
    ]);
  },

  // ── Thanks ───────────────────────────────────────────────────
  thanks: () => pick([
    `You're very welcome! Happy to help. ${CLOSER.help()}`,
    `Glad I could assist! Don't hesitate to reach out anytime. 😊`,
    `My pleasure! Come back whenever you need help.`,
    `Of course! That's what I'm here for. ${CLOSER.help()}`,
    `You're welcome, ji! Anything else I can help with?`,
    `No problem at all! It was a pleasure helping you. ${CLOSER.help()}`,
    `Anytime! Feel free to ask if something else comes up. 😊`,
    `Happy to be of service! ${CLOSER.care()}`,
    `Aww, that's kind of you! I'm glad things worked out. ${CLOSER.help()}`,
    `Of course, happy to help! Let me know if you need anything else.`
  ]),

  // ── Store Open ───────────────────────────────────────────────
  storeOpen: () => pick([
    `${OPENER.positive()} We're open right now! You can place an order and it'll be ready for pickup in about ${PICKUP_READY_MINUTES} minutes. 🎉`,
    `Yes, the store is currently open! Orders are usually packed and ready within ${PICKUP_READY_MINUTES} minutes. Go ahead and order!`,
    `We're open and ready to serve you! Place your order online and collect it at the counter in roughly ${PICKUP_READY_MINUTES} minutes.`,
    `Good news — we're up and running! Your items will be packed and waiting within ${PICKUP_READY_MINUTES} minutes of ordering.`,
    `Yes, we're open! Go ahead and place your order — we'll have it ready at the counter in about ${PICKUP_READY_MINUTES} minutes or less.`,
    `The store is open right now. Standard hours close at ${STORE_CLOSE_TIME}. Place your order and come collect it — quick and easy!`,
    `We're open! Orders go through quickly — usually packed within ${PICKUP_READY_MINUTES} minutes. Is there something specific you're looking for?`,
    `Open and fully stocked! Feel free to browse and order. Typical pickup time is ${PICKUP_READY_MINUTES} minutes. ${CLOSER.help()}`
  ]),

  // ── Closing Soon ─────────────────────────────────────────────
  closingSoon: () => pick([
    `We're still open, but heads up — we'll be closing very soon at ${STORE_CLOSE_TIME}! If you'd like to order, please do it quickly!`,
    `Yes, we're open! But just a quick heads up — we're about to close at ${STORE_CLOSE_TIME}. Please hurry and place your order if needed!`,
    `Quick update: we're open but winding down. Closing at ${STORE_CLOSE_TIME} — if you want something, please order right away!`,
    `Still open! But we're closing in a few minutes at ${STORE_CLOSE_TIME}. Place your order immediately if you'd like to!`,
    `We're open for now, but closing time is ${STORE_CLOSE_TIME} — very soon! Please place your order immediately if you need anything.`
  ]),

  // ── Store Closed ─────────────────────────────────────────────
  storeClosed: () => pick([
    `The store is currently closed. We'll be back open tomorrow — do visit us then! Usual closing time is ${STORE_CLOSE_TIME}.`,
    `We're closed right now, but we'll be back tomorrow! Feel free to browse our catalog, and order once we reopen.`,
    `The shop is closed at the moment. Come back tomorrow and we'll be happy to serve you!`,
    `We've closed for today. You're welcome to check out products anytime, but orders will be available once we reopen tomorrow.`,
    `Closed for the day — sorry about that! We open again tomorrow. ${CLOSER.care()}`,
    `The store is currently closed. We close at ${STORE_CLOSE_TIME} and reopen fresh the next morning. See you then!`,
    `Not open at the moment! We'll be back tomorrow ready to serve you. In the meantime, feel free to browse. 😊`
  ]),

  // ── Product In Stock ─────────────────────────────────────────
  productInStock: (p, stock) => {
    const u = p.isSoldByWeight ? 'per KG' : 'per piece';
    const q = `${stock} ${p.isSoldByWeight ? 'KG' : 'unit'}${stock !== 1 ? 's' : ''} available`;
    return pick([
      `${OPENER.found()} We have **${p.name}** in stock! It's priced at ₹${p.price} ${u}. (${q} right now.) ${CLOSER.help()}`,
      `Yes, **${p.name}** is available! Price: ₹${p.price} ${u}. We've got good stock — you can add it to your order right away. 😊`,
      `${OPENER.positive()} **${p.name}** is in stock at ₹${p.price} ${u}. About ${q} at the moment. ${CLOSER.help()}`,
      `We have **${p.name}**! It's ₹${p.price} ${u}, and well-stocked right now (${q}). Feel free to order!`,
      `**${p.name}** is available! Current price: ₹${p.price} ${u}. ${q}. Would you like to know about anything else?`,
      `Great news — **${p.name}** is in stock at ₹${p.price} ${u}! There are ${q}. Anything else I can check for you?`,
      `Yes! **${p.name}** — ₹${p.price} ${u}, and we have it in stock. ${q} ready. ${CLOSER.help()}`,
      `We carry **${p.name}** and it's available right now at ₹${p.price} ${u}. ${q}. Feel free to place your order!`
    ]);
  },

  // ── Product Out of Stock ─────────────────────────────────────
  productOOS: (p) => {
    const restock = p.restockEta
      ? `We expect it back in stock around **${p.restockEta}**.`
      : `We'll restock it as soon as possible.`;
    return pick([
      `${OPENER.notFound()} We do have **${p.name}** in our catalog, but it's currently out of stock. ${restock} I've noted your interest! ${CLOSER.help()}`,
      `**${p.name}** is temporarily unavailable — we're out of stock at the moment. ${restock} Sorry for the inconvenience! Can I help you find an alternative?`,
      `We carry **${p.name}**, but it looks like we're out right now. ${restock} I've logged your request so the team knows there's demand. ${CLOSER.help()}`,
      `${OPENER.notFound()} **${p.name}** is out of stock currently. ${restock} Is there something similar I can check for you?`,
      `**${p.name}** is sold out at the moment. ${restock} I've made a note of it! Anything else I can help you find?`,
      `Sorry, **${p.name}** isn't available right now — out of stock. ${restock} ${CLOSER.help()}`
    ]);
  },

  // ── Product Not Found (ask clarification) ───────────────────
  productNotFound: (term) => pick([
    `I searched our catalog but couldn't find "${term}" exactly. Could you double-check the name or try a different brand?`,
    `Hmm, I didn't find a match for "${term}" in our store. Could you give me a bit more detail — like the brand name or pack size?`,
    `"${term}" didn't come up in our inventory. Maybe try a slightly different spelling or the brand name?`,
    `I couldn't locate "${term}" in our catalog. Could you describe it differently? I'll do my best to find it!`,
    `We don't seem to have "${term}" listed, but could you try the full product name or brand? I'll look again!`,
    `I didn't find "${term}" — it's possible it's listed under a different name. Could you give me more details?`
  ]),

  // ── Item Request Logged ──────────────────────────────────────
  itemLogged: (term) => pick([
    `We don't carry "${term}" at the moment, but I've submitted a request to our manager to consider stocking it. ${CLOSER.help()}`,
    `"${term}" isn't in our catalog right now. I've logged your request — our team will review it! ${CLOSER.help()}`,
    `Currently we don't stock "${term}", but I've flagged it for the manager. We appreciate the feedback! Anything else?`,
    `"${term}" isn't available yet, but I've passed your request to our team. Hopefully we'll have it soon! ${CLOSER.help()}`,
    `We don't have "${term}" in stock, but your request has been recorded. Our team will look into it! ${CLOSER.help()}`
  ]),

  // ── Suggest Closest Match ────────────────────────────────────
  askConfirm: (suggestion) => pick([
    `I found **${suggestion}** in our catalog — is that what you're looking for?`,
    `Did you mean **${suggestion}**? Just confirm and I'll get you the price and availability!`,
    `Is **${suggestion}** the product you had in mind?`,
    `Could you be referring to **${suggestion}**? Let me know and I'll check the details!`,
    `I found something close — **${suggestion}**. Is that the one?`
  ]),

  // ── Order Found ──────────────────────────────────────────────
  orderFound: (order, token) => {
    const statusMap = {
      placed:           'Your order has been placed and is being prepared.',
      confirmed:        'Your order is confirmed and our team is packing it.',
      processing:       'Your order is currently being packed and processed.',
      ready:            '🎉 Your order is **READY for pickup**! Please come to the counter.',
      completed:        'This order has been completed and collected.',
      cancelled:        'This order was cancelled.',
      pending_payment:  'Payment is still pending for this order.'
    };
    const desc = statusMap[order.orderStatus] || `Status: **${order.orderStatus.replace(/_/g,' ').toUpperCase()}**`;
    return pick([
      `Found your order! Token **#${token}** — ${desc} Total: ₹${order.orderAmount}. ${CLOSER.help()}`,
      `Here's your order update — Token **#${token}**: ${desc} Amount: ₹${order.orderAmount}. Let me know if you need anything else!`,
      `Your latest order (Token **#${token}**): ${desc} The total was ₹${order.orderAmount}. Is there anything else I can help with?`,
      `Order **#${token}** update: ${desc} Total amount: ₹${order.orderAmount}. Feel free to ask if you have any questions!`,
      `I found your order (Token **#${token}**): ${desc} (₹${order.orderAmount}). Is everything okay with it?`
    ]);
  },

  // ── Order Not Found ──────────────────────────────────────────
  orderNotFound: () => pick([
    `I looked through your account but couldn't find any recent orders. Did you place it on a different account perhaps?`,
    `Hmm, no recent orders on your account. Could it be under a different phone number or email?`,
    `I can't see any active orders linked to your account. If you placed one recently, could you share the token or order ID?`,
    `No recent orders found. If you have an order token or confirmation number, share it and I'll look it up directly!`,
    `Your account doesn't show any recent orders. If you have a token number, I can use that to look it up!`
  ]),

  // ── Order — Guest ────────────────────────────────────────────
  orderGuest: () => pick([
    `To check your order status securely, I'd need you to log in first. Order details are tied to your account for safety.`,
    `I'd love to help track your order! Please log in and ask again — it takes just a second and I'll have the details right away.`,
    `For security, order details are only visible to logged-in users. Please sign in and I'll pull up your order instantly!`,
    `Order tracking requires you to be logged in. Once you're signed in, just ask again and I'll have the update ready!`,
    `I need you to be logged in to show order details securely. Sign in and come back — it'll be quick!`
  ]),

  // ── Ask for Order Token ──────────────────────────────────────
  askToken: () => pick([
    `Do you have your order token or PIN? That would help me find the exact order for you.`,
    `Could you share your order token (shown on your confirmation screen)? I'll pull up the details right away!`,
    `If you have the 4–6 character order token or PIN, please share it and I'll look it up immediately.`,
    `To find your specific order, could you share the token or order ID?`
  ]),

  // ── Complaint — First Response (acknowledge, don't escalate yet) ──
  complaintAck: (isAngry) => {
    const emp = isAngry ? OPENER.empathy() + ' ' : '';
    return emp + pick([
      `That's definitely not acceptable, and I sincerely apologize. Could you please share your order token or number so I can look into this for you?`,
      `I'm really sorry to hear that — you deserve a much better experience. Could you give me your order details so I can investigate right away?`,
      `That shouldn't have happened, and I apologize for the trouble. Could you share your order number so I can take this up immediately?`,
      `I completely understand your frustration and I'm sorry for this. To help you properly, could you share your order token or ID?`,
      `That's not okay at all. I'm sorry this happened. Please share your order number and I'll get this sorted for you.`,
      `I sincerely apologize for this experience. Could you share your order details so I can investigate and make it right?`
    ]);
  },

  // ── Complaint — Ask for More Details ────────────────────────
  complaintAskDetail: () => pick([
    `Could you describe what happened in a bit more detail? The more information you give, the better I can help.`,
    `That's fine! Could you tell me which item had the issue and when you placed the order?`,
    `Sure — could you describe what went wrong? For example, which product, what the issue was, and when you ordered?`,
    `No problem. Please describe the issue — which item, what was wrong, and roughly when you placed the order — and I'll flag it right away.`
  ]),

  // ── Complaint — Escalating with details ─────────────────────
  complaintEscalate: () => pick([
    `Thank you for sharing those details. I'm connecting you with our store manager right now so they can resolve this personally. Please hold on!`,
    `Got it — I've noted everything down. Let me bring in our store manager to handle this directly for you. Just a moment!`,
    `I have all the details I need. Our store manager will review this right away and help you. One moment please!`,
    `Thank you. I'm escalating this to our store manager immediately — they'll take full responsibility and sort this out for you.`,
    `Understood completely. I'm connecting you with the manager right now. They'll address this promptly and personally.`
  ]),

  // ── Refund Acknowledge ───────────────────────────────────────
  refundAck: () => pick([
    `I understand you'd like a refund — that's completely fair if something went wrong. Our store manager handles all refund requests. Let me connect you now.`,
    `Of course, if there was an issue with your order, you deserve a resolution. I'm connecting you to our manager who can process the refund for you.`,
    `A refund is absolutely something our manager can handle. Let me bring them in right away — please hold on!`,
    `I hear you. Refunds are processed directly by our store team. I'll connect you with the manager immediately!`,
    `Understood — I'll get the store manager to assist you with this right away. Just a moment, please!`
  ]),

  // ── Cancellation Acknowledge ─────────────────────────────────
  cancelAck: () => pick([
    `Sure, I can help with that! Order cancellations are handled by our store team. Let me get the manager for you right away.`,
    `Got it — I'll connect you with our store manager who can process the cancellation. Please hold on!`,
    `Cancellations need to be done by our store team. I'm bringing in the manager — one moment!`,
    `Of course — I'll get this sorted for you! Let me connect you with the manager to cancel your order.`,
    `Understood. I'm looping in our store manager to process your cancellation right away.`
  ]),

  // ── Human Request ────────────────────────────────────────────
  humanHandoff: () => pick([
    `Absolutely! Let me connect you with our store manager right away. Please hold on a moment!`,
    `Of course! I'm bringing in a team member to assist you. Just a moment!`,
    `Sure thing — I'll get the store manager into this chat right now. Please hold!`,
    `No problem at all! I'm connecting you to our team — they'll be with you shortly.`,
    `Understood! Sometimes you just need a human touch. I'm getting our manager for you right now!`,
    `Of course — I'm bringing in the store manager. One moment please!`
  ]),

  // ── Payment Normal ───────────────────────────────────────────
  payment: () => pick(KB.payment) + ` ${CLOSER.help()}`,

  // ── Payment Failed ───────────────────────────────────────────
  paymentFailed: () => pick([
    `Sorry to hear about the payment issue! This can happen due to bank or network timeouts. Please try again — if it still fails, try a different UPI app or payment method. If money was deducted but no order was placed, let me know and I'll escalate that immediately.`,
    `Payment failures do happen sometimes, usually due to network issues. Please retry — and if the amount was debited but the order wasn't created, share your details and our team will investigate right away.`,
    `I'm sorry about the failed payment! Please try once more, or switch to a different payment method. If you were charged without the order going through, that's a serious issue — let me know and I'll get the manager involved.`,
    `Payment issues can occur due to network instability. First, try the payment again. If your bank account was debited but the order wasn't confirmed, please share your details so I can get this escalated right away.`
  ]),

  // ── Delivery Info ─────────────────────────────────────────────
  delivery: () => pick(KB.delivery) + ` ${CLOSER.help()}`,

  // ── About Store ───────────────────────────────────────────────
  aboutStore: () => pick(KB.about) + ` ${CLOSER.help()}`,

  // ── Privacy Policy ───────────────────────────────────────────
  privacy: () => pick(KB.privacy) + ` ${CLOSER.help()}`,

  // ── Return Policy ────────────────────────────────────────────
  returnPolicy: () => pick(KB.returnPolicy) + ` Would you like to report an issue with an order?`,

  // ── Offers ───────────────────────────────────────────────────
  offers: () => pick(KB.offers) + ` ${CLOSER.help()}`,

  // ── Help Menu ────────────────────────────────────────────────
  help: () => pick([
    `Happy to help! Here's what I can do:\n• **Product search** — check availability & prices\n• **Order tracking** — check your order status (login needed)\n• **Store info** — hours, location, pickup time\n• **Policies** — returns, privacy, payment methods\n• **General queries** — anything about our store!\n\nJust ask away!`,
    `I'm your Lakshmi Stores assistant. You can ask me about:\n1. Product prices and availability\n2. Your order status and tracking\n3. Whether the store is open\n4. Payment methods and delivery info\n5. Return policy, privacy, and more\n\nWhat would you like to know?`,
    `Here's how I can assist:\n— Check if a product is in stock and get the price\n— Track your latest order\n— Tell you if the store is open\n— Explain our policies (returns, privacy, etc.)\n— Answer general store questions\n\nGo ahead — ask me anything!`,
    `Hello! I can help you with product searches, order tracking, store timings, payment info, return policy, and general queries about Lakshmi Stores. What's on your mind?`
  ]),

  // ── Compliment/Positive ──────────────────────────────────────
  compliment: () => pick([
    `That's so kind of you to say! We really try our best for our customers. 😊 ${CLOSER.help()}`,
    `Thank you so much for the kind words! It means a lot to our team. ${CLOSER.help()}`,
    `We really appreciate the lovely feedback! Our goal is always to give you a great experience. ${CLOSER.help()}`,
    `That makes our day! Thank you for the kind words. We hope to keep serving you well! 😊`,
    `Aww, thank you! We always try to do our best. It's great to know you're happy. ${CLOSER.help()}`
  ]),

  // ── Fallback ─────────────────────────────────────────────────
  fallback: (name) => {
    const n = name ? `, ${name.split(' ')[0]}` : '';
    return pick([
      `I'm not entirely sure I understood that${n}. Could you rephrase it? I want to give you the right answer!`,
      `Hmm, I'm having a bit of trouble understanding that. Could you say it in a different way?`,
      `I want to help${n}, but I'm not sure exactly what you're asking. Are you looking for a product, checking an order, or asking about the store?`,
      `I didn't quite catch that${n}. Could you try asking a different way? A bit more detail would really help me assist you!`,
      `Sorry, I'm not sure I followed that correctly. Could you tell me: are you looking for a product, checking your order, or something else?`,
      `I want to make sure I get this right — could you be a bit more specific${n}? Even a few extra words would help me point you in the right direction!`
    ]);
  },

  // ── Empathy only (for very angry customers) ──────────────────
  empathyOnly: () => pick([
    `I completely understand your frustration, and I'm genuinely sorry this happened. You deserve a much better experience.`,
    `I hear you, and I apologize for this. Please know that we take this very seriously.`,
    `That sounds really frustrating, and I sincerely apologize. I want to help make this right.`,
    `Your frustration is completely valid, and I'm sorry for the trouble this has caused.`,
    `I understand, and I'm sorry about this experience. Let me do everything I can to help you.`
  ]),

  // ── Related Products Suggestion ───────────────────────────────
  relatedSuffix: (relatedItems) =>
    relatedItems.length
      ? ` We also have ${relatedItems.map(p=>`**${p.name}** (₹${p.price})`).join(', ')} if you're interested!`
      : ''
};

// ════════════════════════════════════════════════════════════════
// §8  IN-MEMORY CONVERSATION CONTEXT (TTL-managed per thread)
// ════════════════════════════════════════════════════════════════

const _ctx = new Map();
const CTX_TTL = 30 * 60 * 1000; // 30 min

const getCtx = (id) => {
  if (!_ctx.has(id)) {
    _ctx.set(id, {
      msgCount:         0,
      frustration:      0,   // 0-10
      lastIntent:       null,
      pendingQ:         null, // 'order_token'|'product_confirm'|'complaint_detail'
      pendingProd:      null, // product name waiting for confirmation
      mentionedProds:   [],
      complaintCount:   0,
      unresolved:       false,
      paymentFailed:    false,
      touchedAt:        Date.now()
    });
  }
  const c = _ctx.get(id);
  c.touchedAt = Date.now();
  return c;
};

const setCtx = (id, patch) => Object.assign(getCtx(id), patch, { touchedAt: Date.now() });

// TTL cleanup every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [k, c] of _ctx.entries()) {
    if (now - c.touchedAt > CTX_TTL) _ctx.delete(k);
  }
}, 10 * 60 * 1000);

// ════════════════════════════════════════════════════════════════
// §9  SMART ESCALATION (never on first message, always deliberate)
// ════════════════════════════════════════════════════════════════

const checkEscalate = (intent, sentiment, ctx) => {
  // Explicit human request — always escalate
  if (intent === 'human_request')
    return { yes:true, reason:'Customer explicitly requested a human agent.' };

  // Refund or cancellation request — always escalate
  if (intent === 'refund_request')
    return { yes:true, reason:'Customer requesting a refund — manager authority required.' };
  if (intent === 'cancellation')
    return { yes:true, reason:'Customer requesting order cancellation.' };

  // Complaint — escalate only AFTER we asked for details (second complaint message)
  if (intent === 'complaint' && ctx.complaintCount >= 2 && ctx.pendingQ === null)
    return { yes:true, reason:`Repeated complaint (${ctx.complaintCount}x) — escalating to manager.` };

  // complaint_detail pending — next message should be escalated
  if (ctx.pendingQ === 'complaint_detail')
    return { yes:true, reason:`Customer provided complaint details — needs manager review.` };

  // High frustration across several messages
  if (ctx.frustration >= 8 && ctx.msgCount >= 3)
    return { yes:true, reason:`High frustration level (${ctx.frustration}/10) across ${ctx.msgCount} messages.` };

  // Very angry + complaint together, not first message
  if (sentiment.veryAngry && sentiment.hasComplaint && ctx.msgCount > 1)
    return { yes:true, reason:'Very angry customer with active complaint.' };

  return { yes:false };
};

// ════════════════════════════════════════════════════════════════
// §10  PRODUCT SEARCH ENGINE
// ════════════════════════════════════════════════════════════════

const scoreProduct = (product, qTokens, fullQuery) => {
  const pn  = product.name.toLowerCase();
  const fq  = fullQuery.toLowerCase();
  let score = 0;

  if (pn === fq)                            return 100;
  if (pn.includes(fq) || fq.includes(pn))  score += 30;

  const pToks = tokenize(product.name);
  for (const qt of qTokens) {
    if (pn.includes(qt))                    score += 8;
    for (const pt of pToks) {
      if (qt === pt)                        { score += 12; continue; }
      const sim = strSimilarity(qt, pt);
      if (sim >= 0.90)       score += 10;
      else if (sim >= 0.80)  score += 6;
      else if (sim >= 0.65)  score += 3;
    }
  }
  return score;
};

const searchProducts = (products, query) => {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  return products
    .map(p => ({ p, s: scoreProduct(p, tokens, query) }))
    .filter(x => x.s >= 10)
    .sort((a, b) => b.s - a.s)
    .map(x => x.p);
};

// ════════════════════════════════════════════════════════════════
// §11  PENDING QUESTION RESOLVER
// ════════════════════════════════════════════════════════════════

const resolvePending = async (normalized, ctx, user) => {
  if (!ctx.pendingQ) return { handled: false };

  // "Did you mean X?" → yes/no
  if (ctx.pendingQ === 'product_confirm') {
    const isYes = /\b(yes|yeah|yep|yup|correct|right|exactly|that|sure|ok|okay|ha|haan)\b/.test(normalized);
    const isNo  = /\b(no|nope|nah|not|different|other|else|another|nahi)\b/.test(normalized);

    if (isYes && ctx.pendingProd) {
      const all   = await Product.findAll({ where:{ isActive:true } });
      const match = all.find(p => p.name.toLowerCase() === ctx.pendingProd.toLowerCase());
      if (match) {
        const safe = Math.max(0, (match.real_stock||0) - (match.buffer??2));
        setCtx(ctx._id, { pendingQ:null, pendingProd:null });
        return { handled:true, reply: safe>0 ? R.productInStock(match,safe) : R.productOOS(match) };
      }
    }
    if (isNo) {
      setCtx(ctx._id, { pendingQ:null, pendingProd:null });
      return { handled:true, reply: pick([
        "Got it! Could you give me more details about what you're looking for?",
        "No problem! What product were you actually looking for?",
        "Alright! Could you try describing it differently? I'll search again."
      ])};
    }
  }
  return { handled: false };
};

// ════════════════════════════════════════════════════════════════
// §12  MAIN NLP DECISION ENGINE
// ════════════════════════════════════════════════════════════════

const processNLP = async (message, user, threadId) => {
  const ctx = getCtx(threadId);
  ctx._id   = threadId;
  ctx.msgCount++;

  const sentiment = analyzeSentiment(message);
  const entities  = extractEntities(message);
  const cls       = classifyIntent(message, ctx);
  const { intent, tokens, normalized } = cls;
  const hour = new Date().getHours();
  const name = user?.name || null;

  // ── Update frustration score ──
  if (sentiment.veryAngry)        ctx.frustration = Math.min(10, ctx.frustration + 4);
  else if (sentiment.isAngry)     ctx.frustration = Math.min(10, ctx.frustration + 2);
  else if (sentiment.hasComplaint)ctx.frustration = Math.min(10, ctx.frustration + 1);
  else if (sentiment.isHappy || sentiment.isThankful)
                                  ctx.frustration = Math.max(0, ctx.frustration - 1);

  // ── Resolve any pending cross-question first ──
  const pending = await resolvePending(normalized, ctx, user);
  if (pending.handled) {
    setCtx(threadId, { lastIntent: intent });
    return { type:'answer', reply: pending.reply };
  }

  // ── Check escalation conditions ──
  const esc = checkEscalate(intent, sentiment, ctx);
  if (esc.yes) {
    let reply = '';
    if (intent === 'human_request')   reply = R.humanHandoff();
    else if (intent === 'refund_request') reply = R.refundAck();
    else if (intent === 'cancellation')   reply = R.cancelAck();
    else if (sentiment.veryAngry || ctx.frustration >= 8)
      reply = R.empathyOnly() + ' ' + pick([
        "I'm getting the store manager to help you with this right now.",
        "Let me connect you with our store manager immediately.",
        "I'm bringing in our manager to resolve this personally for you."
      ]);
    else
      reply = R.complaintEscalate();

    setCtx(threadId, { lastIntent:intent, unresolved:true });
    return { type:'escalate', reason: esc.reason, reply };
  }

  // ── Intent routing ──

  if (intent === 'greeting') {
    setCtx(threadId, { lastIntent:'greeting' });
    return { type:'answer', reply: R.greet(name, hour) };
  }

  if (intent === 'farewell') {
    setCtx(threadId, { lastIntent:'farewell' });
    return { type:'answer', reply: R.farewell(name) };
  }

  if (intent === 'thanks') {
    setCtx(threadId, { lastIntent:'thanks', unresolved:false });
    return { type:'answer', reply: R.thanks() };
  }

  // Compliment / very positive message (not a product question)
  if (sentiment.isHappy && !sentiment.hasComplaint && intent !== 'product_inquiry'
      && intent !== 'order_status' && intent !== 'store_info') {
    return { type:'answer', reply: R.compliment() };
  }

  if (intent === 'store_info') {
    setCtx(threadId, { lastIntent:'store_info' });
    const store = await StoreSetting.findByPk(1);
    if (!store || !store.isOpen)       return { type:'answer', reply: R.storeClosed() };
    if (store.closingWarningActive)    return { type:'answer', reply: R.closingSoon() };
    return { type:'answer', reply: R.storeOpen() };
  }

  if (intent === 'order_status') {
    setCtx(threadId, { lastIntent:'order_status' });
    if (!user) return { type:'answer', reply: R.orderGuest() };
    const order = await Order.findOne({
      where:{ userId:String(user.id) },
      order:[['createdAt','DESC']],
      include:[{ model:OrderItem, as:'items' }]
    });
    if (!order) return { type:'answer', reply: R.orderNotFound() };
    const token = order.orderToken && order.orderToken !== 'WAIT'
      ? order.orderToken : (order.cashfreeOrderId||'').slice(-4);
    return { type:'answer', reply: R.orderFound(order, token) };
  }

  if (intent === 'complaint') {
    ctx.complaintCount++;
    setCtx(threadId, { lastIntent:'complaint', unresolved:true, pendingQ:'complaint_detail' });
    return { type:'answer', reply: R.complaintAck(sentiment.isAngry || sentiment.veryAngry) };
  }

  if (intent === 'privacy_policy') {
    setCtx(threadId, { lastIntent:'privacy_policy' });
    return { type:'answer', reply: R.privacy() };
  }

  if (intent === 'return_policy') {
    setCtx(threadId, { lastIntent:'return_policy' });
    return { type:'answer', reply: R.returnPolicy() };
  }

  if (intent === 'payment_inquiry') {
    setCtx(threadId, { lastIntent:'payment_inquiry' });
    const failed = /fail|failed|not work|declin|error|issue|deducted|debited|wrong amount/.test(normalized);
    return { type:'answer', reply: failed ? R.paymentFailed() : R.payment() };
  }

  if (intent === 'delivery_inquiry') {
    setCtx(threadId, { lastIntent:'delivery_inquiry' });
    return { type:'answer', reply: R.delivery() };
  }

  if (intent === 'about_store') {
    setCtx(threadId, { lastIntent:'about_store' });
    if (/offer|deal|discount|sale/.test(normalized)) return { type:'answer', reply: R.offers() };
    return { type:'answer', reply: R.aboutStore() };
  }

  if (intent === 'general_help') {
    setCtx(threadId, { lastIntent:'general_help' });
    return { type:'answer', reply: R.help() };
  }

  // ── Default: Product inquiry ──
  {
    const allProducts = await Product.findAll({ where:{ isActive:true } });
    const queryStr = entities.productKeywords.join(' ') || normalized;
    const matches  = searchProducts(allProducts, queryStr);

    if (matches.length >= 1) {
      const best  = matches[0];
      const safe  = Math.max(0, (best.real_stock||0) - (best.buffer??2));
      const related = matches.slice(1,3);
      const relStr  = R.relatedSuffix(related);

      setCtx(threadId, {
        lastIntent:      'product_inquiry',
        pendingQ:        null,
        mentionedProds:  [...ctx.mentionedProds, best.name].slice(-5)
      });

      return {
        type: 'answer',
        reply: (safe > 0 ? R.productInStock(best, safe) : R.productOOS(best)) + relStr
      };
    }

    // Partial search for confirmation
    const partial = tokens.slice(0,2).join(' ');
    if (partial.length >= 3) {
      const partialMatches = searchProducts(allProducts, partial);
      if (partialMatches.length) {
        const suggestion = partialMatches[0].name;
        setCtx(threadId, {
          lastIntent:  'product_inquiry',
          pendingQ:    'product_confirm',
          pendingProd: suggestion
        });
        return { type:'answer', reply: R.askConfirm(suggestion) };
      }
    }

    // Not found at all — log it, inform customer
    if (tokens.length > 0) {
      const candidate = tokens.slice(0,3).join(' ');
      await ItemRequest.findOrCreate({ where:{ itemName:candidate }, defaults:{ requestCount:1 } })
        .then(([rec, created]) => { if (!created) rec.increment('requestCount'); })
        .catch(() => {});
      setCtx(threadId, { lastIntent:'product_inquiry', pendingQ:null });

      // Check if maybe it's a vague query — offer help
      if (tokens.length === 1) return { type:'answer', reply: R.productNotFound(candidate) };
      return { type:'answer', reply: R.itemLogged(candidate) };
    }

    setCtx(threadId, { lastIntent:null });
    return { type:'answer', reply: R.fallback(name) };
  }
};

// ════════════════════════════════════════════════════════════════
// ROUTING HELPERS
// ════════════════════════════════════════════════════════════════

const getOptionalUser = async (req) => {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const decoded = jwt.verify(h.split(' ')[1], process.env.JWT_ACCESS_SECRET);
    return await User.findByPk(decoded.id, {
      attributes:['id','name','email','phone','role','isVerified']
    });
  } catch { return null; }
};

const serializeThread = async (thread) => {
  const messages = await SupportMessage.findAll({
    where:{ threadId:thread.id }, order:[['createdAt','ASC']]
  });
  return { ...thread.toJSON(), messages };
};

const notifyAdmin = async (req, thread, reason, customerMessage) => {
  await Notification.create({
    userId:'GLOBAL',
    title:'Customer needs help',
    message:`${thread.customerName||'Customer'}: ${String(customerMessage).slice(0,100)}...`,
    isRead:false
  });
  const io = req.app.get('io');
  if (io) {
    io.emit('supportUpdated', { threadId:thread.id, status:THREAD_STATUS.NEEDS_ADMIN, reason });
    io.emit('storeUpdated');
  }
};

const appendMessage = async (thread, senderType, body, senderName = null) => {
  const msg = await SupportMessage.create({ threadId:thread.id, senderType, senderName, body });
  await thread.update({
    lastMessagePreview:    String(body).slice(0,500),
    lastCustomerMessageAt: senderType==='customer' ? new Date() : thread.lastCustomerMessageAt
  });
  return msg;
};

// ════════════════════════════════════════════════════════════════
// MAIN CHAT ENDPOINT
// ════════════════════════════════════════════════════════════════

exports.chat = async (req, res) => {
  try {
    const message = String(req.body.message||'').trim().slice(0,1000);
    if (!message) return res.status(400).json({ success:false, message:'Message is required.' });

    const user   = await getOptionalUser(req);
    let   thread = req.body.threadId ? await SupportThread.findByPk(req.body.threadId) : null;

    if (!thread) {
      thread = await SupportThread.create({
        userId:req.body.userId||null, customerName:user?.name,
        customerEmail:user?.email,    customerPhone:user?.phone,
        status:THREAD_STATUS.AI,      aiEnabled:true
      });
    } else if (thread.status === THREAD_STATUS.RESOLVED) {
      await thread.update({
        status:THREAD_STATUS.AI, aiEnabled:true,
        resolvedAt:null, handledBy:null, escalationReason:null
      });
      _ctx.delete(thread.id); // Fresh context on reopen
    }

    await appendMessage(thread, 'customer', message, user?.name||'Customer');

    // Human is handling — just queue the message
    if (!thread.aiEnabled || [THREAD_STATUS.NEEDS_ADMIN, THREAD_STATUS.HUMAN_ACTIVE].includes(thread.status)) {
      const next = thread.status===THREAD_STATUS.AI ? THREAD_STATUS.NEEDS_ADMIN : thread.status;
      await thread.update({ status:next });
      const io = req.app.get('io');
      if (io) io.emit('supportUpdated', { threadId:thread.id, status:next });
      return res.json({ success:true, thread: await serializeThread(thread) });
    }

    const decision = await processNLP(message, user, thread.id);

    if (decision.reply) await appendMessage(thread, 'assistant', decision.reply, 'Lakshmi Assistant');

    if (decision.type === 'escalate') {
      await thread.update({ status:THREAD_STATUS.NEEDS_ADMIN, priority:'urgent', escalationReason:decision.reason, aiEnabled:false });
      await notifyAdmin(req, thread, decision.reason, message);
    } else {
      await thread.update({ status:THREAD_STATUS.AI, priority:'normal', aiEnabled:true });
    }

    return res.json({ success:true, thread: await serializeThread(thread) });
  } catch (error) {
    console.error('NLP Engine error:', error);
    return res.status(500).json({ success:false, message:'Support assistant failed to respond.' });
  }
};

// ════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ════════════════════════════════════════════════════════════════

exports.getPublicThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success:false, message:'Thread not found.' });
    res.json({ success:true, thread: await serializeThread(thread) });
  } catch { res.status(500).json({ success:false, message:'Failed to fetch thread.' }); }
};

exports.getThreads = async (req, res) => {
  try {
    const { status } = req.query;
    const where = status==='active' ? { status:{ [Op.ne]:THREAD_STATUS.RESOLVED } }
                : status            ? { status }
                :                     {};
    const threads = await SupportThread.findAll({ where, order:[['updatedAt','DESC']], limit:50 });
    res.json({ success:true, data: await Promise.all(threads.map(serializeThread)) });
  } catch { res.status(500).json({ success:false, message:'Failed to fetch threads.' }); }
};

exports.adminReply = async (req, res) => {
  try {
    const message = String(req.body.message||'').trim();
    if (!message) return res.status(400).json({ success:false, message:'Message is required.' });
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success:false, message:'Thread not found.' });

    await appendMessage(thread, 'admin', message, req.user?.name||'Store Manager');
    await thread.update({ status:THREAD_STATUS.HUMAN_ACTIVE, aiEnabled:false, handledBy:req.user?.name });

    const io = req.app.get('io');
    if (io) io.emit('supportUpdated', { threadId:thread.id, status:thread.status });
    res.json({ success:true, thread: await serializeThread(thread) });
  } catch { res.status(500).json({ success:false, message:'Failed to send reply.' }); }
};

exports.resolveThread = async (req, res) => {
  try {
    const thread = await SupportThread.findByPk(req.params.id);
    if (!thread) return res.status(404).json({ success:false, message:'Thread not found.' });

    await appendMessage(thread, 'system', 'Conversation marked resolved by the store team.', 'System');
    await thread.update({ status:THREAD_STATUS.RESOLVED, aiEnabled:false, resolvedAt:new Date() });

    const io = req.app.get('io');
    if (io) io.emit('supportUpdated', { threadId:thread.id, status:thread.status });
    res.json({ success:true, thread: await serializeThread(thread) });
  } catch { res.status(500).json({ success:false, message:'Failed to resolve thread.' }); }
};

