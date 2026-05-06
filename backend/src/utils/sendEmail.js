const nodemailer = require('nodemailer');
const dns = require('dns');

// 🚨 THE ULTIMATE RENDER CLOUD FIX
// Forces Node.js to use IPv4. This bypasses the Render Free Tier IPv6 block
// and prevents the ETIMEDOUT and ENETUNREACH Gmail crashes.
dns.setDefaultResultOrder('ipv4first');

const sendEmail = async ({ email, subject, message }) => {
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // Port 465 requires secure: true
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
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
    // This officially triggers the catch block in your auth controller if it fails!
    throw new Error('Email delivery failed.'); 
  }
};

module.exports = sendEmail;