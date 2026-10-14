import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    const db = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const host = db ? new URL(db).origin : "https://*.supabase.co";
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" +
        (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.nimg.jp https://*.nicovideo.jp https://googleusercontent.com https://*.googleusercontent.com",
      `connect-src 'self' ${host}` +
        (process.env.NODE_ENV === "development"
          ? " ws: http://localhost:* http://127.0.0.1:*"
          : ""),
      "frame-src https://embed.nicovideo.jp",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      // Chromium checks the entire POST → Supabase → Google redirect chain.
      `form-action 'self' ${host} https://accounts.google.com`,
      "font-src 'self' data:",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
