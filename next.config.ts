import type { NextConfig } from "next";

/**
 * Content-Security-Policy.
 *
 * On script-src: a nonce-based policy (`'nonce-…' 'strict-dynamic'`) was tried
 * and does NOT work with this Next.js version — it emits script tags with no
 * `nonce` attribute, and `'strict-dynamic'` makes browsers ignore `'self'`, so
 * every script is blocked and the app renders as a blank, dead shell.
 * `'unsafe-inline'` is therefore used so the app actually runs. Every other
 * directive is kept strict, which is where most of the value is anyway.
 * Upgrade path: move to nonces once Next stamps them on the emitted tags.
 */
function contentSecurityPolicy(): string {
  const aiOrigin = process.env.OPENAI_BASE_URL
    ? ` ${new URL(process.env.OPENAI_BASE_URL).origin}`
    : "";
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    // React sets inline styles for things like progress-bar widths.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${aiOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // Only meaningful over TLS; harmless over plain HTTP in local dev.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
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