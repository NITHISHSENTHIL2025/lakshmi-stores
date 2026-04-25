const { z } = require('zod');

const createOrderSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid('Invalid product ID format'),
      // Integer quantities only — no 0.5 items in a grocery store
      quantity: z.number().int('Quantity must be a whole number').min(1, 'Quantity must be at least 1').max(100, 'Quantity cannot exceed 100'),
      name: z.string().min(1).max(200),
      price: z.number().positive('Price must be positive')
    })
  ).min(1, 'Cart must have at least 1 item').max(50, 'Cart cannot have more than 50 line items'),

  paymentMethod: z.enum(['cash', 'online'], {
    required_error: 'Payment method is required',
    invalid_type_error: 'Payment method must be cash or online'
  }),

  customerEmail: z.string().email('Invalid email format').max(254).optional().or(z.literal('')),
  customerPhone: z.string().regex(/^[0-9]{10}$/, 'Phone must be exactly 10 digits').optional().or(z.literal('')),
  pickupTime: z.string().max(20).optional(),
  customerNote: z.string().max(500, 'Note cannot exceed 500 characters').optional().or(z.literal(''))
});

module.exports = { createOrderSchema };