const SEVERITY_LEVELS = {
  fraud_report: 100, account_hacked: 100, legal_complaint: 100, negative_sentiment: 95,
  payment_issue: 90, double_payment: 90, refund_request: 85, refund_status: 85,
  missing_order: 80, delayed_order: 80, account_locked: 80,
  wrong_item: 75, damaged_item: 75, missing_item: 75, expired_item: 75,
  login_issue: 60, otp_issue: 60, password_reset: 60, account_update: 50,
  technical_issue: 45, cart_issue: 45, checkout_issue: 45, website_issue: 45,
  human_request: 40,
  order_status: 30, order_history: 30, transaction_pending: 30,
  price_query: 20, stock_query: 20, product_search: 20, category_search: 20, recommendation: 20,
  store_info: 10, store_hours: 10,
  greeting: 5, goodbye: 5, thanks: 5, unknown: 0
};

const ESCALATION_TIERS = {
  LEVEL_3: ['fraud_report', 'account_hacked', 'legal_complaint', 'negative_sentiment'],
  LEVEL_2: ['payment_issue', 'double_payment', 'refund_request', 'wrong_item', 'damaged_item', 'missing_item', 'expired_item', 'human_request'],
  LEVEL_1: ['login_issue', 'otp_issue', 'password_reset', 'account_locked', 'technical_issue', 'cart_issue', 'checkout_issue', 'website_issue']
};

const INTENT_KEYWORDS = {
  fraud_report: ['fraud', 'scam', 'cheating', 'stole', 'fake', 'unauthorized'],
  account_hacked: ['hacked', 'compromised', 'someone else used'],
  payment_issue: ['deducted', 'charged', 'payment failed', 'money gone', 'balance deducted', 'upi success', 'paid but', 'amount debited'],
  double_payment: ['charged twice', 'paid twice', 'double deducted'],
  refund_request: ['refund', 'money back', 'return money', 'cashback'],
  missing_order: ['not here', 'not received', 'never arrived', 'where is order', 'not delivered'],
  delayed_order: ['late', 'still waiting', 'waiting since', 'delay', 'taking too long'],
  wrong_item: ['instead', 'wrong item', 'different item', 'replaced'],
  damaged_item: ['leaking', 'broken', 'damaged', 'spoiled', 'rotten', 'smelling'],
  expired_item: ['expired', 'out of date', 'past date'],
  login_issue: ['login', 'sign in', 'log in', 'cannot access'],
  otp_issue: ['otp', 'verification code', 'code not coming', 'not receiving sms'],
  technical_issue: ['loading forever', 'stuck', 'freeze', 'crash', 'error', 'useless app'],
  cart_issue: ['cart button', 'add to cart', 'cannot add'],
  human_request: ['manager', 'real person', 'human', 'agent', 'support executive'],
  greeting: ['hello', 'hey', 'hi', 'morning', 'evening', 'hii', 'heyy', 'hlw'],
  product_search: ['price', 'cost', 'rate', 'rupees', 'rs', 'how much', 'buy']
};

module.exports = { SEVERITY_LEVELS, ESCALATION_TIERS, INTENT_KEYWORDS };