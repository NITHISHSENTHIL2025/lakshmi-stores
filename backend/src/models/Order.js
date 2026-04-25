const { DataTypes } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

const Order = sequelize.define('Order', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  
  // 🚨 PRODUCTION FIX: DECIMAL(10,2) prevents Cashfree signature errors
  totalAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  orderAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  orderStatus: {
    type: DataTypes.STRING,
    defaultValue: 'pending'
  },
  paymentType: {
    type: DataTypes.STRING,
    defaultValue: 'ONLINE'
  },

  // 🚨 PRODUCTION FIX: Idempotency Key & Session Tracking
  idempotencyKey: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true
  },
  paymentSessionId: {
    type: DataTypes.STRING,
    allowNull: true
  },

  cashfreeOrderId: {
    type: DataTypes.STRING
  },
  orderToken: {
    type: DataTypes.STRING
  },
  pickupPin: {
    type: DataTypes.STRING,
    allowNull: true
  },
  pickupTime: {
    type: DataTypes.STRING,
    defaultValue: 'ASAP'
  },
  customerNote: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  customerEmail: {
    type: DataTypes.STRING
  },
  customerPhone: {
    type: DataTypes.STRING
  }
}, {
  timestamps: true,
  indexes: [
    { fields: ['userId'] },
    { fields: ['cashfreeOrderId'] },
    { fields: ['createdAt'] },
    { fields: ['orderStatus'] },
    { fields: ['idempotencyKey'] } // Fast lookups for double-clicks
  ]
});

module.exports = Order;