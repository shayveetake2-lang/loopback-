export async function onRequest(context) {
  const request = context.request;
  const incoming = new URL(request.url);
  const origin = context.env.API_ORIGIN || context.env.API_BASE_URL;

  if (!origin) {
    return Response.json(
      {
        error: 'API_ORIGIN is not configured',
        help: 'Set the Pages secret API_ORIGIN to your FastAPI URL, for example https://your-app.onrender.com',
      },
      { status: 503 }
    );
  }

  const upstreamOrigin = origin.replace(/\/$/, '');
  const upstreamPath = incoming.pathname.replace(/^\/api/, '') || '/';
  const upstream = new URL(`${upstreamPath}${incoming.search}`, upstreamOrigin);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const headers = new Headers(request.headers);
  headers.set('host', upstream.host);

  const init = {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
  };

  const response = await fetch(new Request(upstream, init));
  const finalHeaders = new Headers(response.headers);
  finalHeaders.set('Access-Control-Allow-Origin', '*');
  finalHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  finalHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: finalHeaders,
  });
}
