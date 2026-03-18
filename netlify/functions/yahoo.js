exports.handler = async function(event) {
  const symbol = event.queryStringParameters?.symbol;
  if (!symbol) return { statusCode: 400, body: "Missing symbol" };

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1h&range=7d`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://finance.yahoo.com",
      }
    });

    if (!response.ok) throw new Error(`Yahoo returned ${response.status}`);
    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
