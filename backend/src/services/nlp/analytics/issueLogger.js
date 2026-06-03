const { sequelize } = require('../../models');

// Call this whenever an issue is detected
const logIssueForDashboard = async (intent, confidence) => {
  try {
    // Assuming you create an IssueLog model:
    // await IssueLog.create({ issueType: intent, confidence, date: new Date() });
    
    // Fallback: log to console for now
    console.log(`📊 [ANALYTICS] Issue Logged: ${intent} | Confidence: ${confidence}`);
  } catch (e) {
    console.error("Analytics logging failed", e);
  }
};

module.exports = { logIssueForDashboard };