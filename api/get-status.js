export const config = {
    runtime: 'edge', // ⚡ ultra hızlı, neredeyse anında yanıt
  };
  
  export default async function handler(req) {
    if (req.method !== 'POST') {
      // sadece POST'a izin ver, diğerlerini reddet
      return new Response('Method Not Allowed', { status: 405 });
    }
  
    // hiçbir şey yapmadan anında "ok" döndür
    return new Response('ok', { status: 200 });
  }
  