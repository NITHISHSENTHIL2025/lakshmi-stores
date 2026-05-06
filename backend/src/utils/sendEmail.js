const sendEmail = async ({ email, subject, message }) => {
  try {
    // 🚨 THE RENDER SURVIVAL BYPASS 🚨
    // If you don't have a Resend API key yet, this catches the email and prints the OTP 
    // directly into your Render Logs so you can actually log in and test your app!
    if (!process.env.RESEND_API_KEY) {
      // Extract the 6-digit OTP from the HTML message
      const otpMatch = message.match(/>(\d{6})</);
      const otp = otpMatch ? otpMatch[1] : 'Hidden in HTML';
      
      console.log(`\n======================================================`);
      console.log(`🚨 NO EMAIL API KEY SET. EMAIL INTERCEPTED.`);
      console.log(`TO: ${email}`);
      console.log(`SUBJECT: ${subject}`);
      console.log(`🔑 THE VERIFICATION OTP IS: ${otp}`);
      console.log(`======================================================\n`);
      return; 
    }

    // 🚨 TRUE ENTERPRISE ARCHITECTURE: HTTP Email API (Port 443)
    // Render CANNOT block this because it travels over standard HTTPS web traffic.
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Lakshmi Stores <onboarding@resend.dev>', // Standard testing address
        to: email,
        subject: subject,
        html: message
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.message || response.statusText}`);
    }

    console.log(`✅ Secure HTTP Email sent to ${email} — Subject: "${subject}"`);
    
  } catch (error) {
    console.error(`❌ Email Delivery failed to ${email}:`, error.message);
    throw new Error('Email delivery failed.'); 
  }
};

module.exports = sendEmail;