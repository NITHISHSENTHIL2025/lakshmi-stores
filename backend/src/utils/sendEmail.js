const nodemailer = require('nodemailer');
const dns = require('dns');

// 🚨 THE ULTIMATE RENDER CLOUD FIX
// We MUST force Node.js to use IPv4. Render completely blocks outbound IPv6.
dns.setDefaultResultOrder('ipv4first');

const sendEmail = async ({ email, subject, message }) => {
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,            // Use secure cloud port
      secure: false,        // Must be false for 587
      requireTLS: true,     // Force encryption
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const mailOptions = {
      from: `"Lakshmi Stores" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: subject,
      html: message
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Secure Email sent to ${email} — Subject: "${subject}"`);
    
  } catch (error) {
    console.error(`❌ SMTP Delivery failed to ${email}:`, error);
    throw new Error('Email delivery failed.'); 
  }
};

module.exports = sendEmail;