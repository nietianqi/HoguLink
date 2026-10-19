import type { NextConfig } from 'next';
const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000';
const config: NextConfig = {
  distDir:
    process.env.HOGULINK_QA_BUILD === '1'
      ? '.next-h5-qa'
      : process.env.NODE_ENV === 'production'
        ? '.next-production'
        : '.next',
  devIndicators: false,
  transpilePackages: ['@hogulink/contracts'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          ...(process.env.PUBLIC_HTTPS === '1'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]
            : []),
        ],
      },
    ];
  },
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${api}/v1/:path*` }];
  },
};
export default config;
