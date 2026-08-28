import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Creador Viral — Vídeos virales con IA",
  description: "Crea vídeos virales en segundos: sube tus clips, añade voz con IA y subtítulos y publica en TikTok.",
};

function Footer() {
  return (
    <footer className="shrink-0 border-t border-zinc-800 bg-[#09090b]">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
        <p className="text-zinc-500 text-center sm:text-left">
          © {new Date().getFullYear()} Creador Viral. Todos los derechos reservados.
        </p>
        <nav className="flex items-center gap-4 sm:gap-6">
          <Link
            href="/privacy"
            className="text-zinc-400 hover:text-white transition underline underline-offset-4 decoration-zinc-700 hover:decoration-white"
          >
            Política de Privacidad
          </Link>
          <span className="text-zinc-700" aria-hidden>
            ·
          </span>
          <Link
            href="/terms"
            className="text-zinc-400 hover:text-white transition underline underline-offset-4 decoration-zinc-700 hover:decoration-white"
          >
            Términos de Servicio
          </Link>
        </nav>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-screen flex flex-col bg-[#09090b]">
        <div className="flex-1 flex flex-col min-h-0">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
