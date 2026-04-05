const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); 
const { Op } = require('sequelize');
const User = require('../models/User'); 
const Session = require('../models/Session');
const sendEmail = require('../utils/sendEmail');

// 🚨 PASSWORD VALIDATOR (Min 8 chars, 1 Uppercase, 1 Number)
const isStrongPassword = (password) => /(?=.*[A-Z])(?=.*\d).{8,}/.test(password);

// ==========================================
// 🛡️ SECURE COOKIE & MULTI-DEVICE SESSION GENERATOR
// ==========================================
const attachCookies = async (res, user, req) => {
  const accessToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '15m' }); 
  const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' }); 
  const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');

  await Session.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } });

  const userSessions = await Session.findAll({ 
    where: { userId: user.id }, 
    order: [['createdAt', 'ASC']] 
  });
  
  if (userSessions.length >= 5) {
    await userSessions[0].destroy(); 
  }

  await Session.create({
    userId: user.id,
    hashedToken: hashedToken,
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'] || 'Unknown Device',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) 
  });

  // 🚨 THE FIX: CROSS-DOMAIN COOKIE STAMP
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = { 
    httpOnly: true, 
    secure: isProduction, // True on Render, False on Localhost
    sameSite: isProduction ? 'none' : 'lax' // 'none' allows Vercel to talk to Render
  };
  
  res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
};

// ==========================================
// 1. REGISTER
// ==========================================
const register = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password) return res.status(400).json({ success: false, message: 'All fields required.' });

    // 🚨 AUDIT FIX: Strict phone validation on Registration
    if (!/^[0-9]{10}$/.test(phone.toString())) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit phone number is required.' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters, with 1 uppercase letter and 1 number.' });
    }

    const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
    if (existingUser) {
      console.warn(`⚠️ Blocked duplicate registration attempt for: ${email}`);
      return res.status(400).json({ success: false, message: 'Email already exists.' });
    }

    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiryTime = new Date(Date.now() + 10 * 60 * 1000); 
    const hashedOtp = await bcrypt.hash(generatedOtp, 10);

    const user = await User.create({
      name, email: email.toLowerCase(), phone, password, 
      role: 'customer', isVerified: false,
      otp: hashedOtp, otpExpiry: otpExpiryTime, lastOtpSentAt: new Date(),
      walletBalance: 0, khataBalance: 0, isKhataAllowed: false
    });

    const message = `<h2>Welcome!</h2><p>Your verification code is: <b style="font-size: 24px;">${generatedOtp}</b></p>`;
    
    // 🚨 AUDIT FIX: Prevent Zombie Accounts
    try {
      await sendEmail({ email: user.email, subject: 'Verify Your Account - Lakshmi Stores', message });
      return res.status(201).json({ success: true, message: 'OTP sent to email.' });
    } catch (emailError) {
      await user.destroy({ force: true });
      console.error('❌ Email failed to send during registration:', emailError);
      return res.status(500).json({ success: false, message: 'Could not send verification email. Please try registering again later.' });
    }

  } catch (error) {
    console.error('❌ Registration Error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
};

// ==========================================
// 1.5 VERIFY OTP
// ==========================================
const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ where: { email: email.toLowerCase() } });

    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (user.isVerified) return res.status(400).json({ success: false, message: 'Account already verified.' });
    
    if (user.lockUntil && user.lockUntil > new Date()) {
      const minsLeft = Math.ceil((user.lockUntil - new Date()) / 60000);
      return res.status(403).json({ success: false, message: `Too many attempts. Locked for ${minsLeft} mins.` });
    }

    if (user.otpExpiry < new Date()) return res.status(400).json({ success: false, message: 'OTP expired.' });

    const isMatch = await bcrypt.compare(otp, user.otp);
    
    if (!isMatch) {
      user.otpAttempts += 1; 
      console.warn(`⚠️ Failed OTP attempt for: ${email} (${user.otpAttempts}/3)`);
      if (user.otpAttempts >= 3) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); 
        user.otp = null; 
      }
      await user.save();
      return res.status(400).json({ success: false, message: `Invalid OTP. ${3 - user.otpAttempts} attempts left.` });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpiry = null;
    user.loginAttempts = 0;
    user.otpAttempts = 0; 
    user.lockUntil = null;
    await user.save();
    
    await attachCookies(res, user, req);

    const userData = user.toJSON();
    delete userData.password;

    res.status(200).json({ success: true, user: userData });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error during verification.' });
  }
};

// ==========================================
// 2. LOGIN
// ==========================================
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required.' });

    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    if (user.lockUntil && user.lockUntil > new Date()) {
      const minsLeft = Math.ceil((user.lockUntil - new Date()) / 60000);
      return res.status(403).json({ success: false, message: `Account locked. Try again in ${minsLeft} minutes.` });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      user.loginAttempts += 1;
      console.warn(`⚠️ Failed login attempt for: ${email} (${user.loginAttempts}/5)`);
      if (user.loginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); 
      }
      await user.save();
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.isVerified) return res.status(401).json({ success: false, message: 'Please verify your email address.' });

    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    await attachCookies(res, user, req);

    const userData = user.toJSON();
    delete userData.password;

    res.status(200).json({ success: true, user: userData });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

// ==========================================
// 3. REFRESH TOKEN
// ==========================================
const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.cookies;
    if (!refreshToken) return res.status(401).json({ success: false, message: 'No refresh token.' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id);
    if (!user) return res.status(403).json({ success: false, message: 'Invalid token.' });

    const hashedIncomingToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const session = await Session.findOne({ where: { userId: user.id, hashedToken: hashedIncomingToken } });

    if (!session || session.expiresAt < new Date()) {
      if (session) await session.destroy();
      return res.status(403).json({ success: false, message: 'Session expired or invalid.' });
    }

    await session.destroy();
    await attachCookies(res, user, req);

    res.status(200).json({ success: true, message: 'Tokens rotated and refreshed securely.' });
  } catch (error) {
    res.status(403).json({ success: false, message: 'Refresh failed.' });
  }
};

// ==========================================
// 4. LOGOUT
// ==========================================
const logout = async (req, res) => {
  const token = req.cookies.refreshToken;
  
  // 🚨 THE FIX: Clear cookies securely across domains
  const isProduction = process.env.NODE_ENV === 'production';
  const clearCookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax'
  };

  res.clearCookie('accessToken', clearCookieOptions);
  res.clearCookie('refreshToken', clearCookieOptions);
  
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const hashedIncomingToken = crypto.createHash('sha256').update(token).digest('hex');
      await Session.destroy({ where: { userId: decoded.id, hashedToken: hashedIncomingToken } });
    } catch (e) { /* ignore errors */ }
  }

  res.status(200).json({ success: true, message: 'Logged out successfully.' });
};

// ==========================================
// 5. LOGOUT OF ALL DEVICES
// ==========================================
const logoutAllDevices = async (req, res) => {
  try {
    await Session.destroy({ where: { userId: req.user.id } });
    
    // 🚨 THE FIX: Clear cookies securely across domains
    const isProduction = process.env.NODE_ENV === 'production';
    const clearCookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax'
    };

    res.clearCookie('accessToken', clearCookieOptions);
    res.clearCookie('refreshToken', clearCookieOptions);
    res.status(200).json({ success: true, message: 'Logged out of all devices successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to logout from all devices.' });
  }
};

// ==========================================
// 6. GET CURRENT USER
// ==========================================
const getMe = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, { 
      attributes: { exclude: ['password', 'otp', 'otpExpiry', 'resetPasswordToken', 'resetPasswordExpire', 'lastOtpSentAt'] } 
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching profile.' });
  }
};

// ==========================================
// 7. RESEND OTP
// ==========================================
const resendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ where: { email: email.toLowerCase() } });

    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (user.isVerified) return res.status(400).json({ success: false, message: 'Account is already verified.' });

    if (user.lastOtpSentAt && Date.now() - user.lastOtpSentAt.getTime() < 60000) {
       return res.status(429).json({ success: false, message: 'Please wait 60 seconds before requesting another OTP.' });
    }

    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(generatedOtp, 10);
    
    user.otp = hashedOtp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); 
    user.lastOtpSentAt = new Date(); 
    await user.save();

    const message = `<h2>OTP Resent</h2><p>Your new verification code is: <b style="font-size: 24px;">${generatedOtp}</b></p>`;
    await sendEmail({ email: user.email, subject: 'New Verification Code - Lakshmi Stores', message });

    res.status(200).json({ success: true, message: 'New OTP sent to email.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error resending OTP.' });
  }
};

// ==========================================
// 8. FORGOT PASSWORD
// ==========================================
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ where: { email: email.toLowerCase() } });

    if (!user) {
      return res.status(200).json({ 
        success: true, 
        message: 'If an account exists with that email, a reset link has been sent.' 
      });
    }

    const resetToken = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpire = new Date(Date.now() + 15 * 60 * 1000); 
    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password/${resetToken}`;

    const message = `
      <h2>Password Reset Request</h2>
      <p>You requested a password reset. Click the link below to choose a new password:</p>
      <a href="${resetUrl}" style="display:inline-block; padding:10px 20px; background:#ea580c; color:#fff; text-decoration:none; border-radius:5px;">Reset Password</a>
      <p>If you did not request this, please ignore this email. This link expires in 15 minutes.</p>
    `;

    try {
      await sendEmail({ email: user.email, subject: 'Password Reset - Lakshmi Stores', message });
      
      res.status(200).json({ 
        success: true, 
        message: 'If an account exists with that email, a reset link has been sent.' 
      });
    } catch (err) {
      user.resetPasswordToken = null;
      user.resetPasswordExpire = null;
      await user.save();
      return res.status(500).json({ success: false, message: 'Email could not be sent.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error during forgot password.' });
  }
};

// ==========================================
// 9. RESET PASSWORD
// ==========================================
const resetPassword = async (req, res) => {
  try {
    const resetPasswordToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({ 
      where: { 
        resetPasswordToken, 
        resetPasswordExpire: { [Op.gt]: new Date() } 
      } 
    });

    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });

    if (!isStrongPassword(req.body.password)) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters, with 1 uppercase letter and 1 number.' });
    }

    user.password = req.body.password;
    user.resetPasswordToken = null;
    user.resetPasswordExpire = null;
    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    await Session.destroy({ where: { userId: user.id } });

    res.status(200).json({ success: true, message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error during password reset.' });
  }
};

module.exports = { register, login, getMe, verifyOtp, refresh, logout, logoutAllDevices, resendOtp, forgotPassword, resetPassword };