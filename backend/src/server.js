require('dotenv').config(); 

// 🚨 FINAL SECURITY GATEKEEPER: Enforces cryptographic strength
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("🔴 FATAL ERROR: JWT_SECRET is missing or too weak!");
  console.error("🔴 It must be at least 32 characters long. Generate one using crypto.randomBytes(64).");
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

app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(cookieParser());

// 🚨 AUDIT FIX: Rate Limiter dialed in for production safety (Max 200)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 200, 
  message: { success: false, message: 'Too many requests from this IP. Please try again later.' }
});
app.use('/api', limiter);

app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/users', userRoutes);

app.use(errorHandler);

app.get(/.*/, (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.sendFile(path.resolve(__dirname, '../frontend/dist', 'index.html'));
  } else {
    if (req.originalUrl && req.originalUrl.startsWith('/api')) {
       return res.status(404).json({ success: false, message: `API endpoint ${req.originalUrl} not found.` });
    }
    res.status(404).send('Backend is running. Use Port 5173 for the React UI.');
  }
});

cron.schedule('0 0 * * *', async () => {
  try {
    const deletedCount = await Session.destroy({ 
      where: { expiresAt: { [Op.lt]: new Date() } } 
    });
    console.log(`🧹 Daily Cleanup: Removed ${deletedCount} expired sessions.`);
  } catch (error) {
    console.error('❌ Session cleanup error:', error);
  }
});

cron.schedule('*/5 * * * *', async () => {
  try {
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    // 🚨 AUDIT FIX: Safely targets ONLY 'pending_payment'. Saves legitimate processing/cash orders.
    const abandonedOrders = await Order.findAll({
      where: {
        orderStatus: 'pending_payment',
        createdAt: { [Op.lt]: fifteenMinsAgo }
      },
      include: [{ model: OrderItem, as: 'items' }] 
    });

    for (let order of abandonedOrders) {
      order.orderStatus = 'failed';
      await order.save();

      for (let item of order.items) {
        const product = await Product.findByPk(item.productId);
        if (product) { 
          await product.increment('real_stock', { by: item.quantity }); 
        }
      }
      console.log(`♻️ Recovered stock from abandoned Order: ${order.orderToken}`);
    }
    
    if (abandonedOrders.length > 0 && io) {
      io.emit('storeUpdated');
    }
  } catch (error) {
    console.error('❌ Abandoned cart recovery error:', error);
  }
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: true });
      console.log('✅ Main Database connected & synced (Dev Mode)');
    } else {
      console.log('✅ Main Database connected (Prod Mode - Sync Skipped)');
    }
    
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