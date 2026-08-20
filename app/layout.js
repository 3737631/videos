import "./globals.css";

export const metadata = {
  title: "AliProbe - Encuentra el fabricante de cualquier producto de AliExpress",
  description:
    "Pega un enlace de AliExpress y AliProbe encuentra el producto, el fabricante y te prepara el contacto con un mensaje personalizado.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}