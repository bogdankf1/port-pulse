import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Port Pulse",
    short_name: "Port Pulse",
    description:
      "Live tracker for your investment portfolio — upload a screenshot, watch the prices.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0e1a",
    theme_color: "#0a0e1a",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }],
  };
}
