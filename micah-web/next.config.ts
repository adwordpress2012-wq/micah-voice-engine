import path from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /** Enables `Dockerfile` multi-stage deploy (`.next/standalone`). */
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
