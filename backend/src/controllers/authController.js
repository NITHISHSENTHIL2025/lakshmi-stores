const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const User = require('../models/User');
const Session = require('../models/Session');
const sendEmail = require('../utils/sendEmail');

const isStrongPassword = (password) =>
  /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,128}$/.test(password);

const generateTokens = async (user, req) => {
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

  return { accessToken, refreshToken };
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
      otpResendsToday: 0, 
      lastOtpResendDate: new Date().toDateString()
    });

    // 🚨 MILLION-DOLLAR ENTERPRISE OTP EMAIL TEMPLATE
    const message = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.1);">
          <div style="background-color: #ea580c; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 2px; font-weight: 900; text-transform: uppercase;">Lakshmi Stores</h1>
          </div>
          <div style="padding: 40px 32px;">
            <h2 style="color: #111827; font-size: 24px; margin-top: 0; margin-bottom: 16px; font-weight: 800;">Verify your email address</h2>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 32px;">
              Hi <strong>${name.trim()}</strong>,<br><br>
              Thank you for choosing Lakshmi Stores! Please use the following One-Time Password (OTP) to complete your registration. This code is valid for <strong>10 minutes</strong>.
            </p>
            <div style="background-color: #fff7ed; border: 2px dashed #fed7aa; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
              <span style="display: block; font-size: 42px; font-weight: 900; letter-spacing: 12px; color: #ea580c; margin-left: 12px;">${generatedOtp}</span>
            </div>
            <div style="background-color: #f3f4f6; border-left: 4px solid #ea580c; padding: 16px; border-radius: 4px;">
              <p style="color: #4b5563; font-size: 14px; line-height: 1.5; margin: 0;">
                <strong style="color: #111827;">Security Tip:</strong> Never share this OTP with anyone. Lakshmi Stores personnel will never call or message you to ask for this code.
              </p>
            </div>
          </div>
          <div style="background-color: #f9fafb; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0 0 8px 0; line-height: 1.5;">
              If you didn't request this email, please ignore it or secure your account.
            </p>
            <p style="color: #9ca3af; font-size: 12px; margin: 0; font-weight: 600;">
              &copy; ${new Date().getFullYear()} Lakshmi Stores. All rights reserved.
            </p>
          </div>
        </div>
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

    const { accessToken, refreshToken } = await generateTokens(user, req);

    const userData = user.toJSON();
    delete userData.password; delete userData.otp; delete userData.otpExpiry; 
    delete userData.resetPasswordToken; delete userData.resetPasswordExpire;

    res.status(200).json({ success: true, user: userData, accessToken, refreshToken });
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

    const { accessToken, refreshToken } = await generateTokens(user, req);

    const userData = user.toJSON();
    delete userData.password; delete userData.otp; delete userData.otpExpiry; 
    delete userData.resetPasswordToken; delete userData.resetPasswordExpire;

    res.status(200).json({ success: true, user: userData, accessToken, refreshToken });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
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
    
    const { accessToken, refreshToken: newRefreshToken } = await generateTokens(user, req);
    res.status(200).json({ success: true, message: 'Tokens refreshed.', accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    res.status(403).json({ success: false, message: 'Token refresh failed.' });
  }
};

const logout = async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      const hashedIncomingToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await Session.destroy({ where: { userId: decoded.id, hashedToken: hashedIncomingToken } });
    } catch (e) {}
  }
  res.status(200).json({ success: true, message: 'Logged out successfully.' });
};

const logoutAllDevices = async (req, res) => {
  try {
    await Session.destroy({ where: { userId: req.user.id } });
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

    // 🚨 RESEND OTP ENTERPRISE TEMPLATE
    const message = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.1);">
          <div style="background-color: #ea580c; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 2px; font-weight: 900; text-transform: uppercase;">Lakshmi Stores</h1>
          </div>
          <div style="padding: 40px 32px;">
            <h2 style="color: #111827; font-size: 24px; margin-top: 0; margin-bottom: 16px; font-weight: 800;">Your New Verification Code</h2>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 32px;">
              As requested, here is your new One-Time Password (OTP). This code will expire securely in <strong>10 minutes</strong>.
            </p>
            <div style="background-color: #fff7ed; border: 2px dashed #fed7aa; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
              <span style="display: block; font-size: 42px; font-weight: 900; letter-spacing: 12px; color: #ea580c; margin-left: 12px;">${generatedOtp}</span>
            </div>
            <div style="background-color: #f3f4f6; border-left: 4px solid #ea580c; padding: 16px; border-radius: 4px;">
              <p style="color: #4b5563; font-size: 14px; line-height: 1.5; margin: 0;">
                <strong style="color: #111827;">Security Tip:</strong> We will never call you to ask for this code. Do not share it with anyone.
              </p>
            </div>
          </div>
          <div style="background-color: #f9fafb; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0 0 8px 0; line-height: 1.5;">
              If you didn't request this email, please ignore it or secure your account.
            </p>
            <p style="color: #9ca3af; font-size: 12px; margin: 0; font-weight: 600;">
              &copy; ${new Date().getFullYear()} Lakshmi Stores. All rights reserved.
            </p>
          </div>
        </div>
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
    
    // 🚨 PASSWORD RESET ENTERPRISE TEMPLATE (Includes Sleek Button)
    const message = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.1);">
          <div style="background-color: #111827; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 2px; font-weight: 900; text-transform: uppercase;">Lakshmi Stores</h1>
          </div>
          <div style="padding: 40px 32px;">
            <h2 style="color: #111827; font-size: 24px; margin-top: 0; margin-bottom: 16px; font-weight: 800;">Reset Your Password</h2>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 32px;">
              We received a request to reset the password for your Lakshmi Stores account. Click the button below to choose a new password. This secure link will expire in <strong>15 minutes</strong>.
            </p>
            <div style="text-align: center; margin-bottom: 32px;">
              <a href="${resetUrl}" style="display: inline-block; background-color: #ea580c; color: #ffffff; font-weight: 800; font-size: 16px; text-decoration: none; padding: 16px 36px; border-radius: 8px; text-transform: uppercase; letter-spacing: 1px;">Reset Password</a>
            </div>
            <div style="background-color: #f3f4f6; border-left: 4px solid #111827; padding: 16px; border-radius: 4px;">
              <p style="color: #4b5563; font-size: 14px; line-height: 1.5; margin: 0;">
                <strong style="color: #111827;">Having trouble clicking the button?</strong><br>
                Copy and paste this URL into your browser: <br/>
                <a href="${resetUrl}" style="color: #ea580c; word-break: break-all; margin-top: 6px; display: inline-block;">${resetUrl}</a>
              </p>
            </div>
          </div>
          <div style="background-color: #f9fafb; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0 0 8px 0; line-height: 1.5;">
              If you didn't request a password reset, you can safely ignore this email. Your password will not change until you access the link above and create a new one.
            </p>
            <p style="color: #9ca3af; font-size: 12px; margin: 0; font-weight: 600;">
              &copy; ${new Date().getFullYear()} Lakshmi Stores. All rights reserved.
            </p>
          </div>
        </div>
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