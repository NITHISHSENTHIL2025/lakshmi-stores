const { DataTypes } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

const StoreSetting = sequelize.define('StoreSetting', {
  id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
  isOpen: { type: DataTypes.BOOLEAN, defaultValue: true },
  closingWarningActive: { type: DataTypes.BOOLEAN, defaultValue: false },
  warningStartTime: { type: DataTypes.DATE, allowNull: true }
});

module.exports = StoreSetting;
