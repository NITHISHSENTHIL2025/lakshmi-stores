const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const User = require('../models/User');
const Session = require('../models/Session');
const sendEmail = require('../utils/sendEmail');

const isStrongPassword = (password) =>
  /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,128}$/.test(password);

const attachCookies = async (res, user, req) => {
  const accessToken = jwt.sign({ id: user.id }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

  const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');

  const userSessions = await Session.findAll({ where: { userId: user.id }, order: [['createdAt', 'ASC']] });
  if (userSessions.length >= 5) await userSessions[0].destroy();

  await Session.create({
    userId: user.id,
    hashedToken,
    ipAddress: req.ip || req.connection?.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'Unknown Device',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax' };

  res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
};

const register = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !phone || !password) return res.status(400).json({ success: false, message: 'All fields are required.' });
    if (!/^[0-9]{10}$/.test(phone.toString())) return res.status(400).json({ success: false, message: 'A valid 10-digit phone number is required.' });
    if (!isStrongPassword(password)) return res.status(400).json({ success: false, message: 'Password must be at least 8 chars with uppercase, lowercase, number, and special character.' });

    const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
    if (existingUser) return res.status(400).json({ success: false, message: 'If this email is not already registered, an OTP will be sent.' });

    const generatedOtp = crypto.randomInt(100000, 999999).toString();
    const otpExpiryTime = new Date(Date.now() + 10 * 60 * 1000);
    const hashedOtp = await bcrypt.hash(generatedOtp, 10);

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase(),
      phone,
      password,
      role: 'customer',
      isVerified: false,
      otp: hashedOtp,
      otpExpiry: otpExpiryTime,
      lastOtpSentAt: new Date(),
      walletBalance: 0,
      khataBalance: 0,
      isKhataAllowed: false,
      otpResendsToday: 0, // Initialize spam tracker
      lastOtpResendDate: new Date().toDateString()
    });

    const message = `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2 style="color:#ea580c">Welcome to Lakshmi Stores!</h2>
        <p>Your verification code is:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:#fff7ed;border-radius:8px;margin:16px 0">${generatedOtp}</div>
        <p style="color:#6b7280;font-size:13px">This code expires in 10 minutes. Do not share it with anyone.</p>
      </div>
    `;

    try {
      await sendEmail({ email: user.email, subject: 'Verify Your Account — Lakshmi Stores', message });
      return res.status(201).json({ success: true, message: 'OTP sent to your email.' });
    } catch (emailError) {
      await user.destroy({ force: true });
      return res.status(500).json({ success: false, message: 'Could not send verification email. Please try again later.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP are required.' });

    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    if (user.isVerified) return res.status(400).json({ success: false, message: 'Account is already verified.' });

    if (user.lockUntil && user.lockUntil > new Date()) {
      const minsLeft = Math.ceil((user.lockUntil - new Date()) / 60000);
      return res.status(403).json({ success: false, message: `Too many attempts. Locked for ${minsLeft} more minute(s).` });
    }

    if (!user.otpExpiry || user.otpExpiry < new Date()) return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });

    const isMatch = await bcrypt.compare(otp, user.otp);

    if (!isMatch) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      if (user.otpAttempts >= 3) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        user.otp = null;
      }
      await user.save();
      const attemptsLeft = Math.max(0, 3 - user.otpAttempts);
      return res.status(400).json({ success: false, message: `Invalid OTP. ${attemptsLeft} attempt(s) remaining.` });
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
    delete userData.password; delete userData.otp; delete userData.otpExpiry; 
    delete userData.resetPasswordToken; delete userData.resetPasswordExpire;

    res.status(200).json({ success: true, user: userData });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error during verification.' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required.' });

    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    if (user.lockUntil && user.lockUntil > new Date()) {
      const minsLeft = Math.ceil((user.lockUntil - new Date()) / 60000);
      return res.status(403).json({ success: false, message: `Account locked. Try again in ${minsLeft} minute(s).` });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.isVerified) return res.status(401).json({ success: false, message: 'Please verify your email address first.' });

    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    await attachCookies(res, user, req);

    const userData = user.toJSON();
    delete userData.password; delete userData.otp; delete userData.otpExpiry; 
    delete userData.resetPasswordToken; delete userData.resetPasswordExpire;

    res.status(200).json({ success: true, user: userData });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.cookies;
    if (!refreshToken) return res.status(401).json({ success: false, message: 'No refresh token found.' });

    let decoded;
    try { decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET); } 
    catch (err) { return res.status(403).json({ success: false, message: 'Invalid or expired refresh token.' }); }

    const user = await User.findByPk(decoded.id);
    if (!user) return res.status(403).json({ success: false, message: 'User no longer exists.' });

    const hashedIncomingToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const session = await Session.findOne({ where: { userId: user.id, hashedToken: hashedIncomingToken } });

    if (!session || session.expiresAt < new Date()) {
      if (session) await session.destroy();
      return res.status(403).json({ success: false, message: 'Session expired or invalid. Please log in again.' });
    }

    await session.destroy();
    await attachCookies(res, user, req);
    res.status(200).json({ success: true, message: 'Tokens refreshed.' });
  } catch (error) {
    res.status(403).json({ success: false, message: 'Token refresh failed.' });
  }
};

const logout = async (req, res) => {
  const token = req.cookies.refreshToken;
  const isProduction = process.env.NODE_ENV === 'production';
  const clearCookieOptions = { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax' };

  res.clearCookie('accessToken', clearCookieOptions);
  res.clearCookie('refreshToken', clearCookieOptions);

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
      const hashedIncomingToken = crypto.createHash('sha256').update(token).digest('hex');
      await Session.destroy({ where: { userId: decoded.id, hashedToken: hashedIncomingToken } });
    } catch (e) {}
  }
  res.status(200).json({ success: true, message: 'Logged out successfully.' });
};

const logoutAllDevices = async (req, res) => {
  try {
    await Session.destroy({ where: { userId: req.user.id } });
    const isProduction = process.env.NODE_ENV === 'production';
    const clearCookieOptions = { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'none' : 'lax' };
    res.clearCookie('accessToken', clearCookieOptions);
    res.clearCookie('refreshToken', clearCookieOptions);
    res.status(200).json({ success: true, message: 'Logged out of all devices.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to logout from all devices.' });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password', 'otp', 'otpExpiry', 'resetPasswordToken', 'resetPasswordExpire', 'lastOtpSentAt', 'loginAttempts', 'otpAttempts', 'lockUntil'] }
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching profile.' });
  }
};

// ============================================================
// 8. RESEND OTP — 🚨 PRODUCTION FIX: Daily Rate Limiting
// ============================================================
const resendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user || user.isVerified) {
      return res.status(200).json({ success: true, message: 'If the account exists and is unverified, a new OTP has been sent.' });
    }

    if (user.lastOtpSentAt && Date.now() - user.lastOtpSentAt.getTime() < 60000) {
      return res.status(429).json({ success: false, message: 'Please wait 60 seconds before requesting another OTP.' });
    }

    // 🚨 PRODUCTION FIX: Enforce max 5 OTPs per day
    const todayDateStr = new Date().toDateString();
    if (user.lastOtpResendDate !== todayDateStr) {
      user.otpResendsToday = 0;
      user.lastOtpResendDate = todayDateStr;
    }

    if (user.otpResendsToday >= 5) {
      return res.status(429).json({ success: false, message: 'Maximum OTP resends reached for today. Please try again tomorrow.' });
    }

    const generatedOtp = crypto.randomInt(100000, 999999).toString();
    const hashedOtp = await bcrypt.hash(generatedOtp, 10);

    user.otp = hashedOtp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    user.lastOtpSentAt = new Date();
    user.otpAttempts = 0;
    user.lockUntil = null;
    user.otpResendsToday += 1;
    await user.save();

    const message = `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2 style="color:#ea580c">New Verification Code</h2>
        <p>Your new code is:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:#fff7ed;border-radius:8px;margin:16px 0">${generatedOtp}</div>
        <p style="color:#6b7280;font-size:13px">This code expires in 10 minutes.</p>
      </div>
    `;
    await sendEmail({ email: user.email, subject: 'New Verification Code — Lakshmi Stores', message });

    res.status(200).json({ success: true, message: 'New OTP sent to your email.' });
  } catch (error) {
    console.error('❌ Resend OTP error:', error);
    res.status(500).json({ success: false, message: 'Server error resending OTP.' });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

    const genericResponse = { success: true, message: 'If an account exists with that email, a reset link has been sent.' };
    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(200).json(genericResponse);

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpire = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password/${resetToken}`;
    const message = `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2 style="color:#1f2937">Password Reset Request</h2>
        <p>You requested a password reset. Click below to set a new password:</p>
        <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#ea580c;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin:16px 0">Reset Password</a>
        <p style="color:#6b7280;font-size:13px">This link expires in 15 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `;

    try {
      await sendEmail({ email: user.email, subject: 'Password Reset — Lakshmi Stores', message });
      return res.status(200).json(genericResponse);
    } catch (err) {
      user.resetPasswordToken = null; user.resetPasswordExpire = null; await user.save();
      return res.status(500).json({ success: false, message: 'Email could not be sent. Please try again later.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const resetPasswordToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await User.findOne({
      where: { resetPasswordToken, resetPasswordExpire: { [Op.gt]: new Date() } }
    });

    if (!user) return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' });
    if (!isStrongPassword(req.body.password)) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character.' });

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