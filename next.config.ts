import type { NextConfig } from "next";

// Next's inline scripts would need a nonce on every page before script-src could be limited, which
// rules out caching and adds a proxy file. The rest of the policy needs no nonce, so it is set.
const CONTENT_SECURITY_POLICY = "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

const config: NextConfig = {
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      ],
    },
  ],
};

export default config;
