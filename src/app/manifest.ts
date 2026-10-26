import type { MetadataRoute } from "next";

// Permite instalar o sistema como app na tela inicial do celular (Safari > Compartilhar > Adicionar à Tela de Início).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Financeiro Proclamai",
    short_name: "Financeiro",
    description: "Tesouraria, conciliação e prestação de contas da igreja.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f4f2",
    theme_color: "#6e0d1d",
    lang: "pt-BR",
    icons: [
      { src: "/brand/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/app-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
