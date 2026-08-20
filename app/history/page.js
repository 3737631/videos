import Link from "next/link";
import { listProducts } from "@/lib/db";

export const dynamic = "force-dynamic";

const ESTADO_LABEL = {
  no_contactado: "NO CONTACTADO",
  contacto_preparado: "CONTACTO PREPARADO",
  contactado: "CONTACTADO",
  respuesta_recibida: "RESPUESTA RECIBIDA",
};

export default async function HistoryPage() {
  let products = [];
  let error = "";
  try {
    products = await listProducts(100);
  } catch (err) {
    error = err.message;
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Historial</h1>
        <Link href="/" className="text-sm text-blue-400 hover:underline">
          Volver
        </Link>
      </header>

      {error && (
        <p className="mb-4 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {products.length === 0 && !error && (
        <p className="text-gray-400">Todavía no hay productos analizados.</p>
      )}

      <div className="space-y-2">
        {products.map((p) => (
          <details key={p.id} className="rounded-xl border border-gray-800 bg-gray-900/60">
            <summary className="flex cursor-pointer items-center gap-3 p-3">
              {p.image && (
                <img src={p.image} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {p.title || "(sin título)"}
                </p>
                <p className="truncate text-xs text-gray-400">
                  {p.fabricante || "Fabricante no verificado"}
                </p>
              </div>
              {p.fabricante_email && (
                <span className="hidden text-xs text-blue-400 sm:inline">{p.fabricante_email}</span>
              )}
            </summary>
            <div className="border-t border-gray-800 p-3 text-sm">
              <div className="flex items-center justify-between">
                <EstadoBadge estado={p.estado_contacto} />
                <span className="text-green-300">
                  {p.currency ? `${p.currency} ` : ""}
                  {p.price || "-"}
                </span>
              </div>
              {p.fabricante && (
                <p className="mt-2 text-gray-300">Fabricante: {p.fabricante}</p>
              )}
              {p.fabricante_email && (
                <p className="mt-1 text-gray-300">Email: {p.fabricante_email}</p>
              )}
              {p.fabricante_direccion && (
                <p className="mt-1 text-gray-300">Dirección: {p.fabricante_direccion}</p>
              )}
              <Link
                href={`/?id=${p.id}`}
                className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
              >
                VER
              </Link>
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}

function EstadoBadge({ estado }) {
  const label = ESTADO_LABEL[estado] || estado;
  return (
    <span className="rounded-md border border-gray-700 bg-gray-800/60 px-2 py-0.5 text-xs font-semibold text-gray-300">
      {label}
    </span>
  );
}