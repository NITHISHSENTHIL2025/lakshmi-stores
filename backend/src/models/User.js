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
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { isEmail: true }
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('customer', 'admin'),
    defaultValue: 'customer'
  },
  isVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },

  // OTP (stored hashed)
  otp: { type: DataTypes.STRING, allowNull: true },
  otpExpiry: { type: DataTypes.DATE, allowNull: true },
  otpAttempts: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastOtpSentAt: { type: DataTypes.DATE, allowNull: true },

  // 🚨 PRODUCTION FIX: OTP Spam Limits (Prevents SMS/Email Bombing)
  otpResendsToday: { type: DataTypes.INTEGER, defaultValue: 0 },
  lastOtpResendDate: { type: DataTypes.STRING, allowNull: true },

  // Session & brute force protection
  loginAttempts: { type: DataTypes.INTEGER, defaultValue: 0 },
  lockUntil: { type: DataTypes.DATE, allowNull: true },

  // Password reset
  resetPasswordToken: { type: DataTypes.STRING, allowNull: true },
  resetPasswordExpire: { type: DataTypes.DATE, allowNull: true },

  // 🚨 PRODUCTION FIX: Changed FLOAT to DECIMAL(10,2) for exact financial math
  walletBalance: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 },
  isKhataAllowed: { type: DataTypes.BOOLEAN, defaultValue: false },
  khataBalance: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 }

}, {
  timestamps: true,
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

User.prototype.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = User;