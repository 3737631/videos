import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#0b0d12]">
      <div className="text-center">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="mt-2 text-gray-400">Página no encontrada</p>
        <Link href="/" className="mt-4 inline-block text-blue-400 hover:text-blue-300">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}