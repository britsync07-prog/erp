import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * Next.js emits inline bootstrap scripts for hydration and streaming, so the
 * policy uses nonces plus `'strict-dynamic'` for scripts rather than
 * `unsafe-inline`. Style attributes are still permitted because React sets
 * inline styles for progress/width values.
 */
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is required by React in development only.
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self' 'nonce-{nonce}' 'strict-dynamic'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Connect only to self plus the configured AI gateway.
  `connect-src 'self'${process.env.OPENAI_BASE_URL ? ` ${new URL(process.env.OPENAI_BASE_URL).origin}` : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // Only meaningful over TLS; harmless over plain HTTP in local dev.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // The app serves its own fonts/assets; never let a browser sniff a response.
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  // Required by the Dockerfile: emits a self-contained server with only the
  // node_modules actually traced at build time.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;