const Order = require('./Order');
const Product = require('./Product');
const User = require('./User');
const OrderItem = require('./OrderItem');
const Session = require('./Session');

// Order → OrderItems (cascade delete)
Order.hasMany(OrderItem, { foreignKey: 'orderId', as: 'items', onDelete: 'CASCADE' });
OrderItem.belongsTo(Order, { foreignKey: 'orderId' });

// OrderItem → Product (no constraints — product can be archived after purchase)
OrderItem.belongsTo(Product, { foreignKey: 'productId', constraints: false });
Product.hasMany(OrderItem, { foreignKey: 'productId', constraints: false });

// User → Orders (no FK constraints — userId can be a UUID or legacy string)
User.hasMany(Order, { foreignKey: 'userId', constraints: false });
Order.belongsTo(User, { foreignKey: 'userId', constraints: false });

module.exports = { Order, Product, User, OrderItem, Session };