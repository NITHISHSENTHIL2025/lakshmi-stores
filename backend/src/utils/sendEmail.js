const sendEmail = async ({ email, subject, message }) => {
  try {
    // 🚨 TRUE ENTERPRISE ARCHITECTURE: HTTP Email API (Port 443)
    // Render CANNOT block this because it travels over standard HTTPS web traffic.
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // 🚨 IMPORTANT: On the free tier without a custom domain, you MUST use this exact 'from' address
        from: 'Lakshmi Stores <onboarding@resend.dev>', 
        to: email,
        subject: subject,
        html: message
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Resend API Error Details:', errorData);
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }

    console.log(`✅ Secure HTTP Email sent to ${email} via Resend API`);
    
  } catch (error) {
    console.error(`❌ Email Delivery failed to ${email}:`, error.message);
    throw new Error('Email delivery failed.'); 
  }
};

module.exports = sendEmail;