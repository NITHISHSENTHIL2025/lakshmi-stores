const { DataTypes } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

const Notification = sequelize.define('Notification', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false }, // 🚨 FIX: Changed to STRING to support IDs and 'GLOBAL' broadcasts
  title: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  isRead: { type: DataTypes.BOOLEAN, defaultValue: false }
});

module.exports = Notification;