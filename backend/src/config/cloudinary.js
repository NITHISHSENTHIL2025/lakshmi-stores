const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'lakshmi_stores_products', 
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'], 
    transformation: [{ width: 800, height: 800, crop: 'limit' }]
  },
});

// 🚨 AUDIT FIX: Strict File Validations
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB Max size
  fileFilter: (req, file, cb) => {
    // Strictly allow ONLY images
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png' || file.mimetype === 'image/webp') {
      cb(null, true);
    } else {
      // Reject any other extension (e.g. .php, .sh, .exe)
      cb(new Error('LIMIT_FILE_TYPES'), false);
    }
  }
});

module.exports = { cloudinary, upload };