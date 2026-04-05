const Product = require('../models/Product'); // <-- Direct import bypasses the issue
const { connectDB } = require('../config/db');

const seedData = async () => {
  await connectDB();
  
  const products = [
    { name: 'Premium Wireless Headphones', price: 2999.00, stock: 50, category: 'Electronics', description: 'Noise-cancelling over-ear headphones.', imageUrl: 'https://via.placeholder.com/150' },
    { name: 'Mechanical Gaming Keyboard', price: 4500.00, stock: 30, category: 'Electronics', description: 'RGB mechanical keyboard with blue switches.', imageUrl: 'https://via.placeholder.com/150' },
    { name: 'Cotton Casual T-Shirt', price: 499.00, stock: 100, category: 'Apparel', description: '100% pure cotton everyday t-shirt.', imageUrl: 'https://via.placeholder.com/150' },
    { name: 'Smart Fitness Watch', price: 1999.00, stock: 45, category: 'Accessories', description: 'Tracks heart rate, steps, and sleep.', imageUrl: 'https://via.placeholder.com/150' }
  ];

  try {
    // Force sync the specific table just in case it isn't ready
    await Product.sync(); 
    
    for (const item of products) {
      await Product.findOrCreate({ where: { name: item.name }, defaults: item });
    }
    console.log('🛒 Dummy Products Seeded Successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
};

seedData();