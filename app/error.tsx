"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0d12] p-8">
      <div className="max-w-xl rounded-xl border border-red-500/30 bg-red-500/5 p-8">
        <h1 className="text-xl font-bold text-red-400">Error de renderizado</h1>
        <pre className="mt-4 whitespace-pre-wrap break-words text-sm text-red-300/90 max-h-96 overflow-auto">
          {error?.message || "Error desconocido"}
        </pre>
        <button
          onClick={reset}
          className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}