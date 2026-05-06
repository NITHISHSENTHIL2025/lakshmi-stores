const nodemailer = require('nodemailer');

const sendEmail = async ({ email, subject, message }) => {
  try {
    // 🚨 THE DEFINITIVE RENDER CLOUD FIX
    // We MUST use Port 587 (STARTTLS). Port 465 (SSL) is strictly blocked for IPv6 on Render.
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,            // 🚨 MUST BE 587
      secure: false,        // 🚨 MUST BE FALSE FOR 587
      requireTLS: true,     // Forces secure connection
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