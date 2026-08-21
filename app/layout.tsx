import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipCraft - Editor de vídeo vertical con IA",
  description:
    "Sube tus vídeos, la IA los analiza, genera guion, voz, subtítulos y edición automática. Exporta vertical 9:16 para TikTok, Reels y Shorts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="bg-[#0b0d12] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}