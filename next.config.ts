import type { NextConfig } from "next";

// Export statique : l'interface est empaquetée dans l'application Windows (dossier out/).
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
