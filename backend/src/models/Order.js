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
  totalAmount: { 
    type: DataTypes.FLOAT, 
    allowNull: false 
  },
  orderAmount: { 
    type: DataTypes.FLOAT, 
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
  cashfreeOrderId: { 
    type: DataTypes.STRING 
  },
  orderToken: { 
    type: DataTypes.STRING 
  },
  // 🚨 AUDIT FIX: The real, randomized secret PIN
  pickupPin: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  pickupTime: { 
    type: DataTypes.STRING, 
    defaultValue: 'ASAP' 
  },
  customerNote: { 
    type: DataTypes.TEXT 
  },
  customerEmail: { 
    type: DataTypes.STRING 
  },
  customerPhone: { 
    type: DataTypes.STRING 
  }
}, {
  indexes: [
    { fields: ['userId'] },
    { fields: ['cashfreeOrderId'] },
    { fields: ['createdAt'] },
    { fields: ['orderStatus'] }
  ]
});

module.exports = Order;