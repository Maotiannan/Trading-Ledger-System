import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['@resvg/resvg-js'],
};

export default withNextIntl(nextConfig);
