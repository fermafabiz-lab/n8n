/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone prototype: no parent lockfile lookups, no image optimizer
  // (the frames are plain static files: from /public locally, from Caddy on
  // the box — see Dockerfile).
  // `standalone` is what the Dockerfile's runner stage copies; without it
  // the image would need the whole node_modules tree.
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
  async headers() {
    return [
      {
        // Frames and poster never change once generated; let the browser and
        // any CDN keep them for a year. Only affects `next start` — on the box
        // these paths never reach Next, Caddy answers them — but that is what
        // the Playwright and Lighthouse runs use.
        source: "/frames/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
