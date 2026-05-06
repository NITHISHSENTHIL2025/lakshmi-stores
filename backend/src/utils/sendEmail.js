const nodemailer = require('nodemailer');

const sendEmail = async ({ email, subject, message }) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || "sandbox.smtp.mailtrap.io",
      port: process.env.EMAIL_PORT || 2525,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const mailOptions = {
      from: '"Lakshmi Stores" <verify@lakshmistores.com>',
      to: email,
      subject: subject,
      html: message
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ OTP captured in Mailtrap for: ${email}`);
    
  } catch (error) {
    console.error(`❌ Mailtrap Error:`, error.message);
    throw new Error('Email delivery failed.'); 
  }
};

module.exports = sendEmail;