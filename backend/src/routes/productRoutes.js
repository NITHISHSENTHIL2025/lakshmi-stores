const express = require('express');
const router = express.Router();
const { 
  getAllProducts, 
  createProduct, 
  updateProduct, 
  deleteProduct, 
  quickStockUpdate 
} = require('../controllers/productController');

// 🚨 IMPORT SECURITY & UPLOAD MIDDLEWARE
const { protect, admin } = require('../middlewares/authMiddleware');
// ✅ Correct way to import it:
const { upload } = require('../config/cloudinary'); // 🚨 SPRINT 4 FIX: Cloudinary uploader

// 🟢 PUBLIC: Anyone can view the catalog
router.get('/', getAllProducts);

// 🔴 SECURE: Only Admins can add new items (Now expects an 'image' file!)
router.post('/', protect, admin, upload.single('image'), createProduct);

// 🔴 SECURE: Only Admins can edit items (Now expects an 'image' file!)
router.put('/:id', protect, admin, upload.single('image'), updateProduct);

// 🔴 SECURE: Only Admins can delete items
router.delete('/:id', protect, admin, deleteProduct);

// 🔴 SECURE: Only Admins can use the Quick POS buttons (+ / - stock)
router.put('/:id/quick-stock', protect, admin, quickStockUpdate);

module.exports = router;