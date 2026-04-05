const User = require('../models/User'); 
require('dotenv').config();

const seedAdmin = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@lakshmistores.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Kavitha@123';

    const existingAdmin = await User.findOne({ where: { email: adminEmail } });

    if (!existingAdmin) {
      await User.create({
        name: 'Master Admin',
        email: adminEmail,
        phone: '9999999999',
        
        // 🚨 FINAL AUDIT FIX: Passed as plain text! 
        // The Sequelize 'beforeCreate' hook handles the hashing automatically. No more double-hashing lockouts.
        password: adminPassword, 
        
        role: 'admin',            
        isVerified: true,        
        walletBalance: 0,
        khataBalance: 0,
        isKhataAllowed: false
      }); 
      console.log('✅ Master Admin account verified and secured!');
    } else {
      console.log('✅ Master Admin account already exists. Skipping seed.');
    }

  } catch (error) {
    console.error('❌ Failed to seed admin:', error);
  }
};

module.exports = seedAdmin;