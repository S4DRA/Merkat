import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Merkat",
    short_name: "Merkat",
    description: "Talk. Plan. Meet.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F6F5F1",
    theme_color: "#F55105",
    icons: [
      {
        src: "/icons/merkat-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/merkat-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    prefer_related_applications: false,
  };
}
