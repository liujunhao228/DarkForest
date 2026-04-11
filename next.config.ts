import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,

  // 安全响应头配置
  async headers() {
    return [
      {
        // 应用到所有路由
        source: "/:path*",
        headers: [
          // 防止点击劫持
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          // 防止 MIME 类型嗅探
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          // 强制 HTTPS
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // 控制 Referrer 信息
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // 内容安全策略（根据项目需求调整）
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' ws: wss: https:",
              "media-src 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          // XSS 保护
          {
            key: "X-XSS-Protection",
            value: "0", // 现代浏览器禁用，使用 CSP
          },
          // 权限策略
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
