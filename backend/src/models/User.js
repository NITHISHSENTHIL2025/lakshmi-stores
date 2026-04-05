const { DataTypes } = require('sequelize');
const dbExport = require('../config/db'); 
const sequelize = dbExport.sequelize || dbExport;
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  lastOtpSentAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('customer', 'admin'), defaultValue: 'customer' },
  isVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
  
  // OTP is securely hashed
  otp: { type: DataTypes.STRING, allowNull: true },
  otpExpiry: { type: DataTypes.DATE, allowNull: true },

  // SECURE SESSIONS & BRUTE FORCE PROTECTION
  refreshToken: { type: DataTypes.STRING, allowNull: true },
  loginAttempts: { type: DataTypes.INTEGER, defaultValue: 0 },
  otpAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  lockUntil: { type: DataTypes.DATE, allowNull: true },

  // FORGOT PASSWORD FLOW
  resetPasswordToken: { type: DataTypes.STRING, allowNull: true },
  resetPasswordExpire: { type: DataTypes.DATE, allowNull: true }
}, {
  indexes: [{ unique: true, fields: ['email'] }],
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    }
  }
});

User.prototype.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = User;