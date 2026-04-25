const { Resend } = require('resend');

if (!process.env.RESEND_API_KEY) {
  console.warn('⚠️ RESEND_API_KEY is not set. Emails will fail.');
}

const resend = new Resend(process.env.RESEND_API_KEY);

// IMPORTANT BEFORE GO-LIVE:
// 1. Go to https://resend.com/domains and add + verify your domain.
// 2. Change FROM_EMAIL in your .env to e.g. noreply@yourdomain.com
// 3. The free tier ONLY delivers to your own Resend account email.
//    With a verified domain, you can send to any address.

const sendEmail = async ({ email, subject, message }) => {
  try {
    const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';

    await resend.emails.send({
      from: `Lakshmi Stores <${fromEmail}>`,
      to: email,
      subject: subject,
      html: message,
    });

    console.log(`✅ Email sent to ${email} — Subject: "${subject}"`);
  } catch (error) {
    console.error(`❌ Email sending failed to ${email}:`, error);
    throw new Error('Email sending failed. Please try again later.');
  }
};

module.exports = sendEmail;