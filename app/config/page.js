import Link from "next/link";
import { dbInfo, isRemote } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  const info = await dbInfo();

  const envItems = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL || "(no definida)"],
    [
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY ? "definida" : "(no definida)",
    ],
    ["SCRAPERAPI_KEY", process.env.SCRAPERAPI_KEY ? "definida" : "(no definida)"],
    ["CHROME_PATH", process.env.CHROME_PATH || "(auto)"],
    ["PORT", process.env.PORT || "3000"],
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Config</h1>
        <Link href="/" className="text-sm text-blue-400 hover:underline">
          Volver
        </Link>
      </header>

      <div className="mb-4 rounded-lg border border-gray-800 bg-gray-900/60 p-4">
        <p className="text-sm text-gray-400">
          Modo de datos:{" "}
          <span className="font-semibold text-white">
            {isRemote ? "Supabase (remoto)" : "SQLite (local)"}
          </span>
        </p>
        {info.mode === "sqlite-local" && (
          <>
            <p className="mt-1 text-sm text-gray-400">Base de datos: {info.path}</p>
            <p className="mt-1 text-sm text-gray-400">Productos guardados: {info.count}</p>
          </>
        )}
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Variables de entorno
      </h2>
      <div className="overflow-hidden rounded-lg border border-gray-800">
        {envItems.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-gray-800 bg-gray-900/40 px-4 py-2 text-sm last:border-0">
            <span className="text-gray-400">{k}</span>
            <span className="max-w-[55%] truncate text-white">{v}</span>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-gray-500">
        Sin NEXT_PUBLIC_SUPABASE_URL la app usa SQLite local en data/app.db. Define Supabase
        para usar la tabla &quot;products&quot; en remoto.
      </p>
    </main>
  );
}