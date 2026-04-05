const { DataTypes } = require('sequelize');
// Adjust this path if your db export is located somewhere else
const dbExport = require('../config/db'); 
const sequelize = dbExport.sequelize || dbExport;

const OrderItem = sequelize.define('OrderItem', {
  id: { 
    type: DataTypes.UUID, 
    defaultValue: DataTypes.UUIDV4, 
    primaryKey: true 
  },
  orderId: { 
    type: DataTypes.UUID, // Or INTEGER if your Order IDs are numbers
    allowNull: false 
  },
  productId: { 
    type: DataTypes.UUID, // Or INTEGER if your Product IDs are numbers
    allowNull: false 
  },
  name: { 
    type: DataTypes.STRING, 
    allowNull: false // We save the name so if the product is deleted later, the receipt doesn't break
  },
  quantity: { 
    type: DataTypes.FLOAT, // Float allows for loose items like 0.5kg
    allowNull: false 
  },
  price: { 
    type: DataTypes.FLOAT, 
    allowNull: false // Save the exact price they paid at that moment
  }
});

module.exports = OrderItem;