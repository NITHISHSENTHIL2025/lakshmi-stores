const nodemailer = require('nodemailer');

const sendEmail = async ({ email, subject, message }) => {
  try {
    const transporter = nodemailer.createTransport({
      // 🚨 CRITICAL: Hardcoded Google IPv4. 
      // Do NOT change this back to 'smtp.gmail.com'. Render blocks IPv6.
      host: '142.250.115.108', 
      port: 587,
      secure: false, 
      requireTLS: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false,
        servername: 'smtp.gmail.com' // Prevents TLS certificate mismatch errors
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