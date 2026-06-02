const { DataTypes } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

const SupportMessage = sequelize.define('SupportMessage', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  threadId: { type: DataTypes.UUID, allowNull: false },
  senderType: { type: DataTypes.STRING, allowNull: false },
  senderName: { type: DataTypes.STRING, allowNull: true },
  body: { type: DataTypes.TEXT, allowNull: false },
  metadata: { type: DataTypes.JSON, allowNull: true }
}, {
  timestamps: true,
  indexes: [
    { fields: ['threadId'] },
    { fields: ['createdAt'] }
  ]
});

module.exports = SupportMessage;
