/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  distDir: "dist",
  // Disable server components since we're exporting static
  experimental: {
    appDir: true,
  },
};

module.exports = nextConfig;
