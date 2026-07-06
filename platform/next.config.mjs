/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Scene images live on fal's CDN and Airtable attachments; final videos on
    // Flow/Drive. We render plain <img> for now, so no remotePatterns needed —
    // add them here if we switch to next/image.
  },
};

export default nextConfig;
