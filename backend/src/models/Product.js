const { DataTypes } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

const Product = sequelize.define('Product', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  category: { type: DataTypes.STRING, defaultValue: 'General' },
  
  // 🚨 FIX: Changed FLOAT to DECIMAL(10,2)
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, validate: { min: 0.01 } },
  
  real_stock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
  buffer: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2 },
  imageUrl: { type: DataTypes.STRING },
  
  // 🚨 FIX: Hard boolean for weight items so we don't rely on string matching
  isSoldByWeight: { type: DataTypes.BOOLEAN, defaultValue: false },
  
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
  timestamps: true
});

module.exports = Product;