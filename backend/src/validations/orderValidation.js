const { z } = require('zod');

// Define exactly what a valid order request must look like
const createOrderSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      quantity: z.number().min(0.1, "Quantity must be at least 0.1"),
      name: z.string(),
      price: z.number()
    })
  ).min(1, "You must have at least 1 item in the cart to checkout"),
  paymentMethod: z.enum(['cash', 'online'], { required_error: "Payment method is required" }),
  customerEmail: z.string().email("Invalid email format").optional().or(z.literal('')),
  customerPhone: z.string().min(10, "Phone number must be at least 10 digits").optional().or(z.literal('')),
  pickupTime: z.string().optional(),
  customerNote: z.string().optional()
});

module.exports = { createOrderSchema };