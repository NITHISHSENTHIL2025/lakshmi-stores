const { DataTypes } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

const SupportThread = sequelize.define('SupportThread', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: true },
  customerName: { type: DataTypes.STRING, allowNull: true },
  customerEmail: { type: DataTypes.STRING, allowNull: true },
  customerPhone: { type: DataTypes.STRING, allowNull: true },
  status: { type: DataTypes.STRING, defaultValue: 'ai_answering' },
  priority: { type: DataTypes.STRING, defaultValue: 'normal' },
  escalationReason: { type: DataTypes.STRING, allowNull: true },
  aiEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
  handledBy: { type: DataTypes.STRING, allowNull: true },
  lastMessagePreview: { type: DataTypes.STRING(500), allowNull: true },
  lastCustomerMessageAt: { type: DataTypes.DATE, allowNull: true },
  lastAdminMessageAt: { type: DataTypes.DATE, allowNull: true },
  resolvedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  timestamps: true,
  indexes: [
    { fields: ['userId'] },
    { fields: ['status'] },
    { fields: ['updatedAt'] }
  ]
});

module.exports = SupportThread;
