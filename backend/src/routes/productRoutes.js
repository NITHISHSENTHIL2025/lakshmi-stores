const express = require('express');
const router = express.Router();
const { getAllProducts, createProduct, updateProduct, deleteProduct, quickStockUpdate } = require('../controllers/productController');
const { protect, admin } = require('../middlewares/authMiddleware');
const { upload } = require('../config/cloudinary');

// Public: view all active products
router.get('/', getAllProducts);

// Admin only: create, edit, delete, adjust stock
router.post('/', protect, admin, upload.single('image'), createProduct);
router.put('/:id', protect, admin, upload.single('image'), updateProduct);
router.delete('/:id', protect, admin, deleteProduct);
router.put('/:id/quick-stock', protect, admin, quickStockUpdate);

module.exports = router;