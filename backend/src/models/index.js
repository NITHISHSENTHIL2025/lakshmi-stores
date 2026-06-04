const Order = require('./Order');
const Product = require('./Product');
const User = require('./User');
const OrderItem = require('./OrderItem');
const Session = require('./Session');
const Notification = require('./Notification');
const StoreSetting = require('./StoreSetting');
const ItemRequest = require('./ItemRequest');
const SupportThread = require('./SupportThread');
const SupportMessage = require('./SupportMessage');
const Offer = require('./Offer'); // 🚨 NEW OFFER MODEL

// Order → OrderItems (cascade delete)
Order.hasMany(OrderItem, { foreignKey: 'orderId', as: 'items', onDelete: 'CASCADE' });
OrderItem.belongsTo(Order, { foreignKey: 'orderId' });

// OrderItem → Product
OrderItem.belongsTo(Product, { foreignKey: 'productId', constraints: false });
Product.hasMany(OrderItem, { foreignKey: 'productId', constraints: false });

// User → Orders
User.hasMany(Order, { foreignKey: 'userId', constraints: false });
Order.belongsTo(User, { foreignKey: 'userId', constraints: false });

SupportThread.hasMany(SupportMessage, { foreignKey: 'threadId', as: 'messages', onDelete: 'CASCADE' });
SupportMessage.belongsTo(SupportThread, { foreignKey: 'threadId' });

module.exports = {
  Order,
  Product,
  User,
  OrderItem,
  Session,
  Notification,
  StoreSetting,
  ItemRequest,
  SupportThread,
  SupportMessage,
  Offer // 🚨 EXPORTED
};