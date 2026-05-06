const nodemailer = require('nodemailer');

const sendEmail = async ({ email, subject, message }) => {
  try {
    // 🚨 THE RENDER PORT 587 FIX: Bypasses the ENETUNREACH Port 465 error
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // MUST be false when using port 587
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false // Helps prevent dropped connections on cloud hosts
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