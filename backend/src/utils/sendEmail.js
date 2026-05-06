const sendEmail = async ({ email, subject, message }) => {
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { 
          name: "Lakshmi Stores", 
          email: "nithishsenthil2025@gmail.com" 
        },
        to: [{ email: email }],
        subject: subject,
        htmlContent: message
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Brevo Error Details:', data);
      throw new Error(data.message || 'Brevo API error');
    }

    console.log(`✅ Real email delivered via Brevo API to: ${email}`);
    
  } catch (error) {
    console.error(`❌ Delivery failed:`, error.message);
    throw new Error('Email delivery failed.'); 
  }
};

module.exports = sendEmail;