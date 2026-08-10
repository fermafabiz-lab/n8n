/** @type {import('next').NextConfig} */
const nextConfig = {
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
