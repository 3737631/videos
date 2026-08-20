"use client";

import { useState } from "react";
import Link from "next/link";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState(null);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setProduct(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al extraer");
      setProduct(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">AliProbe</h1>
          <p className="text-sm text-gray-400">
            Ficha, precio y conformidad del fabricante de cualquier producto AliExpress
          </p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href="/history" className="text-blue-400 hover:underline">
            Historial
          </Link>
          <Link href="/config" className="text-blue-400 hover:underline">
            Config
          </Link>
        </nav>
      </header>

      <form onSubmit={handleSubmit} className="mb-8 flex flex-col gap-3 sm:flex-row">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://es.aliexpress.com/item/..."
          className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Extrayendo..." : "Extraer producto"}
        </button>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {product && <ProductCard product={product} />}
    </main>
  );
}

function ProductCard({ product }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
      <div className="flex flex-col gap-5 md:flex-row">
        {product.image && (
          <img
            src={product.image}
            alt={product.title}
            className="h-48 w-48 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-snug text-white">{product.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            {product.price && (
              <span className="rounded-md bg-green-900/50 px-3 py-1 font-semibold text-green-300">
                {product.currency ? `${product.currency} ` : ""}
                {product.price}
              </span>
            )}
            {product.seller && (
              <span className="text-gray-400">Vendedor: {product.seller}</span>
            )}
            <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
              fuente: {product.source}
            </span>
          </div>
          {product.url && (
            <a
              href={product.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-blue-400 hover:underline"
            >
              Ver en AliExpress
            </a>
          )}
        </div>
      </div>

      {product.conformity?.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-400">
            Conformidad del fabricante
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {product.conformity.map((a, i) => (
              <div
                key={i}
                className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm"
              >
                <span className="font-medium text-amber-200">{a.name}:</span>{" "}
                <span className="text-gray-300">{a.value}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {product.attributes?.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Atributos del producto
          </h3>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {product.attributes.map((a, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className="w-1/3 shrink-0 text-gray-500">{a.name}</span>
                <span className="text-gray-300">{a.value}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {product.images?.length > 1 && (
        <section className="mt-6 flex flex-wrap gap-2">
          {product.images.slice(1).map((img, i) => (
            <img
              key={i}
              src={img}
              alt=""
              className="h-20 w-20 rounded-md object-cover"
            />
          ))}
        </section>
      )}
    </div>
  );
}