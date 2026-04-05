const { Sequelize } = require('sequelize');
require('dotenv').config();

let sequelize;

// 🚨 CLOUD MODE: If Render provides a DATABASE_URL, use it with strict SSL
if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // Required to connect to Neon.tech from Render
      }
    }
  });
} 
// 💻 LOCAL MODE: Fallback to your local computer's separate variables
else {
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
      host: process.env.DB_HOST,
      dialect: 'postgres',
      logging: false, 
    }
  );
}

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ PostgreSQL Database (LSD) Connected Successfully');
  } catch (error) {
    console.error('❌ Database Connection Failed:', error.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };