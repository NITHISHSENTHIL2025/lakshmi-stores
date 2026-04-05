const Product = require('../models/Product');
const dbExport = require('../config/db');

// Get all products (🚨 SPRINT 5 FIX: Only fetch ACTIVE products!)
exports.getAllProducts = async (req, res) => {
  try {
    const products = await Product.findAll({ 
      where: { isActive: true }, // Hides deleted products
      order: [['createdAt', 'DESC']] 
    });
    res.status(200).json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Create product
exports.createProduct = async (req, res) => {
  try {
    let imageUrl = '';
    if (req.file) imageUrl = req.file.path; 

    const { name, description, category, price, stock } = req.body;
    
    const product = await Product.create({
      name, description, category, price, 
      real_stock: stock || 0,
      imageUrl: imageUrl 
    });
    
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    console.error("Create Product Error:", error);
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
};

// Update product
exports.updateProduct = async (req, res) => {
  try {
    const { name, description, category, price, stock } = req.body;
    const product = await Product.findByPk(req.params.id);
    
    if (!product) return res.status(404).json({ success: false, message: 'Not found' });

    product.name = name || product.name;
    product.description = description || product.description;
    product.category = category || product.category;
    product.price = price || product.price;
    if (stock !== undefined) product.real_stock = stock;

    if (req.file) product.imageUrl = req.file.path;

    await product.save();
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update' });
  }
};

// Delete product (🚨 TIER 1 FIX: SOFT DELETE)
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Not found' });
    
    // We do NOT use product.destroy() anymore. That breaks historical receipts!
    product.isActive = false; 
    await product.save();
    
    res.status(200).json({ success: true, message: 'Product securely archived' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete' });
  }
};

// Quick POS (🚨 TIER 2 FIX: ATOMIC INCREMENTS PREVENT RACE CONDITIONS)
exports.quickStockUpdate = async (req, res) => {
  try {
    const { action } = req.body; 
    const product = await Product.findByPk(req.params.id);
    
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // Atomic database queries. Prevents 2 cashiers from tapping at the exact same millisecond and causing a glitch.
    if ((action === 'sell' || action === 'decrease') && product.real_stock > 0) {
      await product.decrement('real_stock', { by: 1 });
    } else if (action === 'add' || action === 'increase') {
      await product.increment('real_stock', { by: 1 });
    }

    // Fetch fresh data to return to frontend
    const updatedProduct = await Product.findByPk(req.params.id);

    res.status(200).json({ 
      success: true, 
      real_stock: updatedProduct.real_stock
    });
  } catch (error) {
    console.error('Quick Stock Error:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};