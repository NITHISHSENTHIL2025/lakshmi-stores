const Product = require('../models/Product');
const { Op } = require('sequelize');
const dbExport = require('../config/db');
const sequelize = dbExport.sequelize || dbExport;

// ============================================================
// GET ALL PRODUCTS — 🚨 PRODUCTION FIX: PAGINATION ADDED
// ============================================================
exports.getAllProducts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 50); // Default to 50 items
    const offset = (page - 1) * limit;

    const { count, rows: products } = await Product.findAndCountAll({
      where: { isActive: true },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.status(200).json({
      success: true,
      data: products,
      pagination: {
        total: count,
        page,
        pages: Math.ceil(count / limit),
        limit
      }
    });
  } catch (error) {
    console.error('❌ getAllProducts error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching products.' });
  }
};

// ============================================================
// CREATE PRODUCT — Admin only
// ============================================================
exports.createProduct = async (req, res) => {
  try {
    const { name, description, category, price, stock } = req.body;

    if (!name || !price) {
      return res.status(400).json({ success: false, message: 'Product name and price are required.' });
    }

    const parsedPrice = parseFloat(price);
    const parsedStock = parseInt(stock, 10);

    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({ success: false, message: 'Price must be a positive number.' });
    }
    if (isNaN(parsedStock) || parsedStock < 0) {
      return res.status(400).json({ success: false, message: 'Stock must be a non-negative integer.' });
    }

    let imageUrl = '';
    if (req.file) imageUrl = req.file.path;

    // 🚨 PRODUCTION FIX: Auto-detect weight boolean to stop string-matching bugs
    const isSoldByWeight = category?.toLowerCase().includes('loose');

    const product = await Product.create({
      name: name.trim(),
      description: description?.trim() || '',
      category: category?.trim() || 'General',
      price: parsedPrice,
      real_stock: parsedStock,
      isSoldByWeight: isSoldByWeight, 
      imageUrl
    });

    res.status(201).json({ success: true, data: product });
  } catch (error) {
    console.error('❌ createProduct error:', error);
    res.status(500).json({ success: false, message: 'Failed to create product.' });
  }
};

// ============================================================
// UPDATE PRODUCT — Admin only
// ============================================================
exports.updateProduct = async (req, res) => {
  try {
    const { name, description, category, price, stock } = req.body;
    const product = await Product.findByPk(req.params.id);

    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });

    if (name) product.name = name.trim();
    if (description !== undefined) product.description = description.trim();
    
    if (category) {
      product.category = category.trim();
      product.isSoldByWeight = category.toLowerCase().includes('loose');
    }

    if (price !== undefined) {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        return res.status(400).json({ success: false, message: 'Price must be a positive number.' });
      }
      product.price = parsedPrice;
    }

    if (stock !== undefined) {
      const parsedStock = parseInt(stock, 10);
      if (isNaN(parsedStock) || parsedStock < 0) {
        return res.status(400).json({ success: false, message: 'Stock must be a non-negative integer.' });
      }
      product.real_stock = parsedStock;
    }

    if (req.file) product.imageUrl = req.file.path;

    await product.save();
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    console.error('❌ updateProduct error:', error);
    res.status(500).json({ success: false, message: 'Failed to update product.' });
  }
};

// ============================================================
// DELETE PRODUCT — Soft delete
// ============================================================
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });

    product.isActive = false;
    await product.save();

    res.status(200).json({ success: true, message: 'Product archived successfully.' });
  } catch (error) {
    console.error('❌ deleteProduct error:', error);
    res.status(500).json({ success: false, message: 'Failed to archive product.' });
  }
};

// ============================================================
// QUICK STOCK UPDATE — Atomic increment/decrement
// ============================================================
exports.quickStockUpdate = async (req, res) => {
  try {
    const { action } = req.body;

    if (!['sell', 'decrease', 'add', 'increase'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Use: sell, decrease, add, or increase.' });
    }

    // 🚨 PRODUCTION FIX: Atomic Database Level Updates (Solves TOCTOU Race Condition)
    if (action === 'sell' || action === 'decrease') {
      const [updatedRows] = await Product.update(
        { real_stock: sequelize.literal('real_stock - 1') },
        { where: { id: req.params.id, real_stock: { [Op.gt]: 0 } } } // Only update if stock > 0
      );
      
      if (updatedRows === 0) {
        return res.status(400).json({ success: false, message: 'Cannot reduce stock below 0.' });
      }
    } else if (action === 'add' || action === 'increase') {
      await Product.update(
        { real_stock: sequelize.literal('real_stock + 1') },
        { where: { id: req.params.id } }
      );
    }

    const updatedProduct = await Product.findByPk(req.params.id);
    res.status(200).json({ success: true, real_stock: updatedProduct.real_stock });
  } catch (error) {
    console.error('❌ quickStockUpdate error:', error);
    res.status(500).json({ success: false, message: 'Server error updating stock.' });
  }
};