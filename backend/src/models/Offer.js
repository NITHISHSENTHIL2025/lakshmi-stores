const { DataTypes } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

const Offer = sequelize.define('Offer', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  type: { type: DataTypes.STRING, allowNull: false }, // 'COMBO', 'DISCOUNT', 'BOGO'
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.STRING, allowNull: true },
  
  // The actual pricing logic
  discountPercentage: { type: DataTypes.INTEGER, defaultValue: 0 },
  comboPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  
  // JSON array of Product IDs involved in this offer
  targetProductIds: { type: DataTypes.JSON, defaultValue: [] }, 
  
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  bannerImage: { type: DataTypes.STRING, allowNull: true }
}, {
  timestamps: true,
  indexes: [{ fields: ['isActive'] }, { fields: ['type'] }]
});

module.exports = Offer;