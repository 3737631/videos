"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-8">
      <div className="max-w-xl rounded-xl border border-red-500/50 bg-white p-8">
        <h1 className="text-xl font-bold text-red-600">Error de aplicación</h1>
        <pre className="mt-4 whitespace-pre-wrap break-words text-sm text-red-800 max-h-96 overflow-auto">
          {error?.message || "Error desconocido"}
        </pre>
        {error?.stack && (
          <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-gray-600 max-h-64 overflow-auto">
            {error.stack}
          </pre>
        )}
        <button
          onClick={reset}
          className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}