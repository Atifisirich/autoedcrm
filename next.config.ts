import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  outputFileTracingIncludes: { "/**": ["./db/schema.sql"] },
  // The mobile API authenticates with a bearer token, never cookies, so any origin may call it.
  async headers() {
    return [{
      source: "/api/m/:path*",
      headers: [
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
        { key: "Access-Control-Allow-Headers", value: "authorization, content-type, accept" },
        { key: "Access-Control-Max-Age", value: "86400" },
      ],
    }];
  },
};
export default config;
