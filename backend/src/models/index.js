const Order = require('./Order');
const Product = require('./Product');
const User = require('./User');
const OrderItem = require('./OrderItem');

// 1 Order has many Order Items
Order.hasMany(OrderItem, { foreignKey: 'orderId', as: 'items', onDelete: 'CASCADE' });
OrderItem.belongsTo(Order, { foreignKey: 'orderId' });

// 1 Order Item belongs to 1 specific Product
OrderItem.belongsTo(Product, { foreignKey: 'productId' });
Product.hasMany(OrderItem, { foreignKey: 'productId' });

// 🚨 TIER 1 FIX: Turn off strict constraints for User <-> Order
// This allows 'userId' in the Orders table to hold either a User's UUID OR a Guest's "CUST_123" string!
User.hasMany(Order, { foreignKey: 'userId', constraints: false });
Order.belongsTo(User, { foreignKey: 'userId', constraints: false });

module.exports = {
  Order,
  Product,
  User,
  OrderItem
};