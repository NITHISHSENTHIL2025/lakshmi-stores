// 🚨 SPRINT 3 FIX: Input Validation Middleware
const validate = (schema) => (req, res, next) => {
  try {
    // Check if the incoming request body matches our strict rules
    schema.parse(req.body);
    next(); // It's clean! Let it pass to the controller.
  } catch (err) {
    // It failed validation. Extract the exact errors and reject it.
    const errorMessages = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return res.status(400).json({
      success: false,
      message: `Invalid input - ${errorMessages}`,
      data: null
    });
  }
};

module.exports = validate;