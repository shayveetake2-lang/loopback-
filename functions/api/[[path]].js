export async function onRequest(context) {
  const origin = context.env.API_ORIGIN;
  if (!origin) {
    return Response.json({ error: 'API_ORIGIN is not configured' }, { status: 503 });
  }

  const incoming = new URL(context.request.url);
  const upstream = new URL(`${incoming.pathname}${incoming.search}`, origin.replace(/\/$/, ''));
  return fetch(new Request(upstream, context.request));
}
