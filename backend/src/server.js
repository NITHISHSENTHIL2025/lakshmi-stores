require('dotenv').config();

// ============================================================
// SECURITY GATEKEEPER — Fail fast if secrets are missing
// ============================================================
if (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET.length < 32) {
  console.error('🔴 FATAL: JWT_ACCESS_SECRET is missing or too short (min 32 chars).');
  process.exit(1);
}
if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
  console.error('🔴 FATAL: JWT_REFRESH_SECRET is missing or too short (min 32 chars).');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cron = require('node-cron');
const { Op } = require('sequelize');

const dbExport = require('./config/db');
const sequelize = dbExport.sequelize || dbExport;
const connectDB = dbExport.connectDB || (async () => { await sequelize.authenticate(); });

const Session = require('./models/Session');
const Order = require('./models/Order');
const OrderItem = require('./models/OrderItem');
const Product = require('./models/Product');

require('./models');

const seedAdmin = require('./utils/seedAdmin');

const authRoutes = require('./routes/authRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const storeRoutes = require('./routes/storeRoutes');
const userRoutes = require('./routes/userRoutes');

const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Trust Render's load balancer proxy (1 hop)
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST']
  }
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log('⚡ Dashboard connected:', socket.id);
  socket.on('disconnect', () => console.log('💤 Dashboard disconnected:', socket.id));
});

// ============================================================
// HELMET — Properly configured CSP (not disabled)
// ============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://sdk.cashfree.com",
        "https://www.cashfree.com"
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: [
        "'self'",
        "data:",
        "https://res.cloudinary.com",
        "https://via.placeholder.com"
      ],
      connectSrc: [
        "'self'",
        "https://sandbox.cashfree.com",
        "https://api.cashfree.com",
        process.env.FRONTEND_URL || 'http://localhost:5173'
      ],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    }
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-signature', 'x-webhook-timestamp', 'x-idempotency-key']
}));

// ============================================================
// 🚨 CRITICAL FIX: Webhook MUST be parsed as RAW buffer BEFORE express.json()
// ============================================================
const paymentController = require('./controllers/paymentController');
app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), paymentController.cashfreeWebhook);

// Now apply JSON parsing for everything else
app.use(express.json({ limit: '10kb' })); 
app.use(cookieParser());

// ============================================================
// RATE LIMITERS
// ============================================================
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests from this IP. Please try again later.' }
});
app.use('/api', globalLimiter);

// ============================================================
// ROUTES
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/users', userRoutes);

app.use(errorHandler);

// Catch-all: 404 for unknown API routes in dev, SPA fallback in prod
app.get(/.*/, (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.sendFile(path.resolve(__dirname, '../frontend/dist', 'index.html'));
  } else {
    res.status(404).json({ success: false, message: `Endpoint ${req.originalUrl} not found.` });
  }
});

// ============================================================
// CRON: Daily expired session cleanup
// ============================================================
cron.schedule('0 0 * * *', async () => {
  try {
    const deletedCount = await Session.destroy({
      where: { expiresAt: { [Op.lt]: new Date() } }
    });
    console.log(`🧹 Session cleanup: removed ${deletedCount} expired sessions.`);
  } catch (error) {
    console.error('❌ Session cleanup error:', error);
  }
});

// ============================================================
// CRON: Every 5 min — recover stock from abandoned online orders
// ============================================================
cron.schedule('*/5 * * * *', async () => {
  try {
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);

    const abandonedOrders = await Order.findAll({
      where: {
        orderStatus: 'pending_payment',
        createdAt: { [Op.lt]: fifteenMinsAgo }
      },
      include: [{ model: OrderItem, as: 'items' }]
    });

    for (let order of abandonedOrders) {
      const t = await sequelize.transaction();
      try {
        order.orderStatus = 'failed';
        await order.save({ transaction: t });

        for (let item of order.items) {
          await Product.increment('real_stock', {
            by: item.quantity,
            where: { id: item.productId },
            transaction: t
          });
        }
        await t.commit();
        console.log(`♻️ Recovered stock from abandoned order: ${order.orderToken}`);
      } catch (err) {
        await t.rollback();
        console.error(`❌ Failed to recover order ${order.id}:`, err.message);
      }
    }

    if (abandonedOrders.length > 0) {
      const ioInstance = app.get('io');
      if (ioInstance) ioInstance.emit('storeUpdated');
    }
  } catch (error) {
    console.error('❌ Abandoned cart recovery error:', error);
  }
});

// ============================================================
// START
// ============================================================
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    // 🚨 FIX FOR THE 500 ERROR: Forcing alter:true safely so the database adds the missing idempotencyKey column
    await sequelize.sync({ alter: true });
    console.log('✅ Database connected & synced (Safely updated missing columns)');

    await seedAdmin();

    server.listen(PORT, () => {
      console.log(`🚀 Server & WebSockets running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Server failed to start:', error);
    process.exit(1);
  }
};

startServer();