/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-hosted on Hetzner behind Caddy: the standalone build bundles only the
  // modules the server actually reaches, so the runtime image carries no
  // node_modules tree. Vercel ignored this setting; `docker build` needs it.
  output: "standalone",
  // Without this, Next walks up past `platform/` looking for a lockfile and
  // emits `.next/standalone/<subdirs>/server.js` instead of
  // `.next/standalone/server.js` — the Dockerfile's COPY then lands a tree
  // with no entrypoint and the container exits immediately.
  outputFileTracingRoot: import.meta.dirname,
  images: {
    // Scene images live on fal's CDN and Airtable attachments; final videos on
    // Flow/Drive. We render plain <img> for now, so no remotePatterns needed —
    // add them here if we switch to next/image.
  },
  experimental: {
    serverActions: {
      // The creation form can carry a reference photo (up to 6 MB, base64'd
      // server-side before the n8n webhook). The default 1 MB action body
      // limit silently rejects it long before createProject runs.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
