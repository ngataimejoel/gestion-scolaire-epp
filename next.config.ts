import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Import du classeur Excel (.xlsm/.xlsx) : jusqu'à 8 Mo par envoi (1 Mo par défaut).
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
