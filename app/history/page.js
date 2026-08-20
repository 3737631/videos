import Link from "next/link";
import { listProducts } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  let products = [];
  let error = "";
  try {
    products = await listProducts(100);
  } catch (err) {
    error = err.message;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Historial</h1>
        <Link href="/" className="text-sm text-blue-400 hover:underline">
          Volver
        </Link>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {products.length === 0 && !error && (
        <p className="text-gray-400">Todavia no hay productos extraidos.</p>
      )}

      <div className="space-y-3">
        {products.map((p) => (
          <details
            key={p.id}
            className="rounded-lg border border-gray-800 bg-gray-900/60 p-4"
          >
            <summary className="cursor-pointer">
              <div className="flex flex-wrap items-center gap-3">
                {p.image && (
                  <img src={p.image} alt="" className="h-12 w-12 rounded object-cover" />
                )}
                <span className="min-w-0 flex-1 font-medium text-white">{p.title || "(sin titulo)"}</span>
                <span className="text-sm text-green-300">
                  {p.currency ? `${p.currency} ` : ""}
                  {p.price || "-"}
                </span>
              </div>
            </summary>
            <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
              {p.attributes.map((a, i) => (
                <div key={i} className="flex gap-2 text-sm">
                  <span className="w-1/3 shrink-0 text-gray-500">{a.name}</span>
                  <span className="text-gray-300">{a.value}</span>
                </div>
              ))}
            </div>
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm text-blue-400 hover:underline"
            >
              {p.url}
            </a>
          </details>
        ))}
      </div>
    </main>
  );
}