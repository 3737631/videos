import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipCraft — Crea anuncios virales en segundos",
  description:
    "Escribe tu guion y obtén voz, música, subtítulos y vídeo vertical listos para TikTok. 100% gratis, sin claves y funcionando en tu propio dispositivo.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body
        className="bg-[#0B0D14] text-gray-100 antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
