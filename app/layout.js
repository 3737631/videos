import "./globals.css";

export const metadata = {
  title: "AliProbe - Analizador de productos AliExpress",
  description:
    "Extrae la ficha del producto, el precio y la informacion de conformidad del fabricante de cualquier enlace de AliExpress.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}