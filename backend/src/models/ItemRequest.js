const { DataTypes } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

const ItemRequest = sequelize.define('ItemRequest', {
  itemName: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  requestCount: { type: DataTypes.INTEGER, defaultValue: 1 }
});

module.exports = ItemRequest;
