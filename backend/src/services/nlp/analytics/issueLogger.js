const logIssueForDashboard = (intent, confidence) => {
  try {
    console.log(
      `📊 [ANALYTICS] ${intent} | Confidence: ${confidence}`
    );
  } catch (err) {
    console.error(err);
  }
};

module.exports = {
  logIssueForDashboard
};