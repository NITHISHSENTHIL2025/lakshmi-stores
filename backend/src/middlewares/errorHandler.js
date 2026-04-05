// 🚨 AUDIT FIX: Centralized Error Handling & Response Standardization
const errorHandler = (err, req, res, next) => {
  console.error(`🚨 Global Error Caught: ${err.message}`);

  // Catch Multer File Size Error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'File is too large. Max size is 3MB.' });
  }

  // Catch Malicious Upload Error
  if (err.message === 'LIMIT_FILE_TYPES') {
     return res.status(400).json({ success: false, message: 'Security Error: Only .png, .jpg and .webp formats allowed!' });
  }

  // Standardized Swiggy-Level Response Format
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  return res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
    data: null
  });
};

module.exports = errorHandler;