const { DataTypes } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

const Product = sequelize.define('Product', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
  },
  category: {
    type: DataTypes.STRING,
  },
  price: {
    type: DataTypes.FLOAT,
    allowNull: false,
  },
  // 🔥 CHANGED TO REAL STOCK
  real_stock: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  // 🔥 ADDED BUFFER FOR THE APP
  buffer: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 2, 
  },
  imageUrl: {
    type: DataTypes.STRING,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  }
}, {
  timestamps: true,
});

module.exports = Product;