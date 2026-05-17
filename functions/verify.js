// functions/verify.js
// Cloudflare Pages Functions 형식
// Netlify Functions의 netlify/functions/verify.js 대체

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const body = await request.json();

    /* ── 비밀번호 검증 ── */
    if (body.password !== undefined) {
      const correct = env.GALLERY_PASSWORD;
      if (!correct) return new Response(JSON.stringify({ ok: false, error: '환경변수 미설정' }), { status: 500, headers });
      return new Response(JSON.stringify({ ok: body.password === correct }), { status: 200, headers });
    }

    /* ── Cloudinary 서명 생성 ── */
    if (body.action === 'sign') {
      const apiSecret = env.CLOUDINARY_API_SECRET;
      const apiKey    = env.CLOUDINARY_API_KEY;
      const cloudName = env.CLOUDINARY_CLOUD_NAME;

      if (!apiSecret || !apiKey || !cloudName)
        return new Response(JSON.stringify({ error: 'Cloudinary 환경변수 미설정' }), { status: 500, headers });

      const timestamp = Math.floor(Date.now() / 1000);
      const folder    = body.folder || 'gallery';
      const toSign    = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;

      // Cloudflare Workers에서 SHA-256 서명
      const msgBuffer  = new TextEncoder().encode(toSign);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray  = Array.from(new Uint8Array(hashBuffer));
      const signature  = hashArray.map(b => b.toString(16).padStart(2,'0')).join('');

      return new Response(
        JSON.stringify({ signature, timestamp, apiKey, cloudName, folder }),
        { status: 200, headers }
      );
    }

    return new Response(JSON.stringify({ error: '알 수 없는 요청' }), { status: 400, headers });

  } catch(e) {
    return new Response(JSON.stringify({ error: '잘못된 요청' }), { status: 400, headers });
  }
}

// OPTIONS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}