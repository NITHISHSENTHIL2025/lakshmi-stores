const { Resend } = require('resend');

// 🚨 Requires RESEND_API_KEY in your .env file!
const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async ({ email, subject, message }) => {
  try {
    await resend.emails.send({
      // 🚨 NOTE: On the free tier, you MUST use this specific 'from' address
      // AND you can only send emails to the email address you signed up with!
      from: 'Lakshmi Stores <onboarding@resend.dev>', 
      to: email,
      subject: subject,
      html: message,
    });
    console.log(`✅ Email sent via Resend to ${email}`);
  } catch (error) {
    console.error(`❌ Email sending failed:`, error);
    throw new Error('Email sending failed');
  }
};

module.exports = sendEmail;