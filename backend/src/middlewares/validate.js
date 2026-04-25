// ============================================================
// ZOD SCHEMA VALIDATION MIDDLEWARE
// ============================================================
const validate = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body);
    next();
  } catch (err) {
    const errorMessages = err.errors
      .map(e => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    return res.status(400).json({
      success: false,
      message: `Validation failed — ${errorMessages}`,
      data: null
    });
  }
};

module.exports = validate;