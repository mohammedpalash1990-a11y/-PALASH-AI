interface Env {
  NEON_API_URL: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const upstream = context.env.NEON_API_URL?.replace(/\/+$/, '');
  if (!upstream) {
    return Response.json({ error: 'Backend is not configured.' }, { status: 503 });
  }

  const incoming = new URL(context.request.url);
  const target = new URL(upstream);
  target.pathname = incoming.pathname;
  target.search = incoming.search;

  const headers = new Headers(context.request.headers);
  headers.delete('host');

  const response = await fetch(new Request(target.toString(), {
    method: context.request.method,
    headers,
    body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : context.request.body,
    redirect: 'manual',
  }));

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};
