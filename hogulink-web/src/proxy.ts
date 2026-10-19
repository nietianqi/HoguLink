import { NextResponse, type NextRequest } from 'next/server';
export function proxy(request: NextRequest) {
  const h = new Headers(request.headers);
  h.set('x-hogu-locale', request.nextUrl.pathname.split('/')[1] || 'ja');
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  h.set('x-nonce', nonce);
  h.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: h } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}
export const config = {
  matcher: ['/((?!v1|_next|favicon.ico|portraits|calm-room.svg|sitemap|robots.txt).*)'],
};
