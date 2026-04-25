const User = require('../models/User');
require('dotenv').config();

const seedAdmin = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      console.warn('⚠️ ADMIN_EMAIL or ADMIN_PASSWORD not set in .env. Skipping admin seed.');
      return;
    }

    const existingAdmin = await User.findOne({ where: { email: adminEmail.toLowerCase() } });

    if (!existingAdmin) {
      await User.create({
        name: 'Master Admin',
        email: adminEmail.toLowerCase(),
        phone: process.env.ADMIN_PHONE || '9999999999',
        password: adminPassword, // Hashed by the beforeCreate Sequelize hook
        role: 'admin',
        isVerified: true,
        walletBalance: 0,
        khataBalance: 0,
        isKhataAllowed: false
      });
      console.log('✅ Admin account created successfully.');
    } else {
      console.log('✅ Admin account already exists. Skipping seed.');
    }
  } catch (error) {
    console.error('❌ Failed to seed admin:', error);
  }
};

module.exports = seedAdmin;