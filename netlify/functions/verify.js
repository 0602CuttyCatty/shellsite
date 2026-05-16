// netlify/functions/verify.js
// 1) 비밀번호 검증
// 2) Cloudinary 업로드 서명 생성

const crypto = require('crypto');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');

    /* ── 비밀번호 검증 ── */
    if (body.action === 'verify' || body.password !== undefined) {
      const correct = process.env.GALLERY_PASSWORD;
      if (!correct) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: '환경변수 미설정' }) };
      return { statusCode: 200, headers, body: JSON.stringify({ ok: body.password === correct }) };
    }

    /* ── Cloudinary 서명 생성 ── */
    if (body.action === 'sign') {
      const apiSecret   = process.env.CLOUDINARY_API_SECRET;
      const apiKey      = process.env.CLOUDINARY_API_KEY;
      const cloudName   = process.env.CLOUDINARY_CLOUD_NAME;
      if (!apiSecret || !apiKey || !cloudName)
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Cloudinary 환경변수 미설정' }) };

      const timestamp = Math.floor(Date.now() / 1000);
      const folder    = body.folder || 'gallery';
      const toSign    = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
      const signature = crypto.createHash('sha256').update(toSign).digest('hex');

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ signature, timestamp, apiKey, cloudName, folder }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: '알 수 없는 action' }) };

  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: '잘못된 요청' }) };
  }
};