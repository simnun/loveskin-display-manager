import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'pub-7f82d9c7ae014d95a9ef1d16918c3604.r2.dev' },
    ],
  },
}

export default nextConfig
