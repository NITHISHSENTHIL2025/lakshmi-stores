const { DataTypes } = require('sequelize');
const dbExport = require('../config/db'); 
const sequelize = dbExport.sequelize || dbExport;


const Session = sequelize.define('Session', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    // This will link back to your User model
  },
  hashedToken: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  ipAddress: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  userAgent: {
    type: DataTypes.STRING,
    allowNull: true, // Will store things like "Chrome on Windows" or "Safari on iPhone"
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
  }},{
  // 🚨 NEW: High-performance indexes so the DB doesn't slow down at scale
  indexes: [
    { fields: ['userId'] },
    { fields: ['hashedToken'] }
  ]
});

module.exports = Session;