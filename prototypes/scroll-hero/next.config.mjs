/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone prototype: no parent lockfile lookups, no image optimizer
  // (the frames are served as plain static files from /public).
  outputFileTracingRoot: import.meta.dirname,
  async headers() {
    return [
      {
        // Frames and poster never change once generated; let the browser and
        // any CDN keep them for a year. Only affects `next start`, but that is
        // what the Playwright and Lighthouse runs use.
        source: "/:path(frames/.*|poster\\.webp)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
