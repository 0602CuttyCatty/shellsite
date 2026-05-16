// netlify/functions/verify.js
exports.handler = async (event) => {
  // CORS 헤더
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // preflight 요청 처리
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // POST 외 차단
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { password } = JSON.parse(event.body || '{}');
    const correct = process.env.GALLERY_PASSWORD;

    if (!correct) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: '환경변수 미설정' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: password === correct }),
    };
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: '잘못된 요청' }) };
  }
};