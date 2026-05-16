// netlify/functions/verify.js
// 비밀번호 검증을 서버에서 처리 — 클라이언트 코드에 비밀번호가 없음

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { password } = JSON.parse(event.body);
    const correct = process.env.GALLERY_PASSWORD; // Netlify 환경변수

    if (!correct) {
      return { statusCode: 500, body: JSON.stringify({ error: '서버 설정 오류' }) };
    }

    if (password === correct) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      };
    } else {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false }),
      };
    }
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: '잘못된 요청' }) };
  }
};