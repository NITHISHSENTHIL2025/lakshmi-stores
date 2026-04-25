// ============================================================
// CENTRALIZED ERROR HANDLER
// ============================================================
const errorHandler = (err, req, res, next) => {
  // Log full error details on the server side
  console.error(`🚨 [${new Date().toISOString()}] ${req.method} ${req.originalUrl} — ${err.message}`);
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // Multer: file too large
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'File is too large. Maximum size is 3MB.' });
  }

  // Multer: wrong file type
  if (err.message === 'LIMIT_FILE_TYPES') {
    return res.status(400).json({ success: false, message: 'Invalid file type. Only .jpg, .png, and .webp are allowed.' });
  }

  // Sequelize unique constraint violation
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ success: false, message: 'A record with that value already exists.' });
  }

  // Sequelize validation error
  if (err.name === 'SequelizeValidationError') {
    const message = err.errors.map(e => e.message).join(', ');
    return res.status(400).json({ success: false, message });
  }

  // Default: hide internal details in production
  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  return res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'An internal server error occurred.' : err.message,
    data: null
  });
};

module.exports = errorHandler;