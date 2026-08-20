"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

const ESTADO_LABEL = {
  no_contactado: "NO CONTACTADO",
  contacto_preparado: "CONTACTO PREPARADO",
  contactado: "CONTACTADO",
  respuesta_recibida: "RESPUESTA RECIBIDA",
};

const CONFIANZA_STYLE = {
  alta: "bg-green-900/40 text-green-300 border-green-800",
  media: "bg-amber-900/40 text-amber-300 border-amber-800",
  baja: "bg-orange-900/40 text-orange-300 border-orange-800",
  "no-verificado": "bg-red-900/40 text-red-300 border-red-800",
};

const MAX_VIDEO = 25 * 1024 * 1024;
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState(null);
  const [error, setError] = useState("");

  const [contactOpen, setContactOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const [video, setVideo] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [videoError, setVideoError] = useState("");
  const [videoInfo, setVideoInfo] = useState(null);
  const [uploading, setUploading] = useState(false);
  const videoInput = useRef(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    fetch(`/api/history/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setProduct(data))
      .catch(() => {});
  }, []);

  async function handleAnalyze(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setProduct(null);
    setContactOpen(false);
    setSendResult(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al analizar");
      setProduct(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function resetVideo() {
    setVideo(null);
    setVideoPreview(null);
    setVideoInfo(null);
    setVideoError("");
    if (videoInput.current) videoInput.current.value = "";
  }

  function onVideoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return resetVideo();
    setVideoError("");
    if (!VIDEO_TYPES.includes(file.type)) {
      setVideoError("Formato de vídeo no compatible.");
      return resetVideo();
    }
    if (file.size > MAX_VIDEO) {
      setVideoError("El vídeo es demasiado grande.");
      return resetVideo();
    }
    setVideo(file);
    setVideoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  async function uploadVideo(productId) {
    if (!video) return null;
    setUploading(true);
    setVideoError("");
    try {
      const form = new FormData();
      form.append("video", video);
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "x-product-id": productId },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al subir el vídeo");
      setVideoInfo(data);
      return data;
    } catch (err) {
      setVideoError(err.message);
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function handleContact() {
    setContactOpen(true);
    setSendResult(null);
    if (!emailTo) setEmailTo(product.fabricante_email || "");
    try {
      const res = await fetch("/api/messages/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSubject(data.subject);
      setMessage(data.variants[0]);
    } catch {
      // se dejan los campos vacios si falla la generacion
    }
  }

  async function regenerate() {
    try {
      const res = await fetch("/api/messages/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSubject(data.subject);
      const current = data.variants.indexOf(message);
      setMessage(data.variants[(current + 1) % data.variants.length]);
    } catch (err) {
      setSendResult({ ok: false, error: err.message });
    }
  }

  async function handlePrepare() {
    if (!emailTo.trim() || !message.trim()) return;
    setPreparing(true);
    setSendResult(null);
    try {
      let vid = null;
      if (video) vid = await uploadVideo(product.id);
      const res = await fetch("/api/contact/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          email_to: emailTo.trim(),
          subject,
          message,
          video_id: vid?.id || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPrepared(data.message);
      setProduct((p) => ({ ...p, estado_contacto: "contacto_preparado" }));
    } catch (err) {
      setSendResult({ ok: false, error: err.message });
    } finally {
      setPreparing(false);
    }
  }

  async function handleSend() {
    if (!prepared) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/contact/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, message_id: prepared.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSendResult(data);
      if (data.ok) {
        setProduct((p) => ({ ...p, estado_contacto: "contactado" }));
      }
    } catch (err) {
      setSendResult({ ok: false, error: err.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">AliProbe</h1>
          <p className="text-sm text-gray-400">
            Encuentra el fabricante de cualquier producto de AliExpress.
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

      {!product && (
        <section className="py-10 text-center">
          <form onSubmit={handleAnalyze} className="flex flex-col gap-3">
            <input
              type="text"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Pega aquí el enlace del producto de AliExpress"
              className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "Analizando..." : "ANALIZAR"}
            </button>
          </form>
          {error && (
            <p className="mt-4 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
              {error}
            </p>
          )}
        </section>
      )}

      {product && (
        <>
          <ProductCard product={product} />
          <ManufacturerCard product={product} onContact={handleContact} />
          {contactOpen && (
            <ContactCard
              product={product}
              emailTo={emailTo}
              setEmailTo={setEmailTo}
              subject={subject}
              setSubject={setSubject}
              message={message}
              setMessage={setMessage}
              onRegenerate={regenerate}
              video={video}
              videoPreview={videoPreview}
              videoError={videoError}
              uploading={uploading}
              onVideoChange={onVideoChange}
              resetVideo={resetVideo}
              preparing={preparing}
              onPrepare={handlePrepare}
              prepared={prepared}
              sending={sending}
              sendResult={sendResult}
              onSend={handleSend}
            />
          )}
          <button
            onClick={() => {
              setProduct(null);
              setUrl("");
              setContactOpen(false);
            }}
            className="mt-6 w-full rounded-xl border border-gray-700 py-3 text-sm text-gray-400 hover:bg-gray-900"
          >
            Analizar otro producto
          </button>
        </>
      )}
    </main>
  );
}

function ProductCard({ product }) {
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="flex gap-4">
        {product.image && (
          <img
            src={product.image}
            alt={product.title}
            className="h-24 w-24 shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-snug text-white">{product.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {product.price && (
              <span className="rounded-md bg-green-900/50 px-2 py-0.5 font-semibold text-green-300">
                {product.currency ? `${product.currency} ` : ""}
                {product.price}
              </span>
            )}
            {product.seller && <span className="text-gray-400">{product.seller}</span>}
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
        {product.marca && (
          <div className="flex gap-2">
            <dt className="text-gray-500">Marca</dt>
            <dd className="text-gray-200">{product.marca}</dd>
          </div>
        )}
        {product.modelo && (
          <div className="flex gap-2">
            <dt className="text-gray-500">Modelo</dt>
            <dd className="text-gray-200">{product.modelo}</dd>
          </div>
        )}
        {product.product_id && (
          <div className="flex gap-2">
            <dt className="text-gray-500">SKU / ID</dt>
            <dd className="text-gray-200">{product.product_id}</dd>
          </div>
        )}
        {product.conformity?.length > 0 && (
          <div className="flex gap-2">
            <dt className="text-gray-500">Conformidad</dt>
            <dd className="text-gray-200">
              {product.conformity
                .slice(0, 3)
                .map((c) => `${c.name}: ${c.value}`)
                .join(" · ")}
            </dd>
          </div>
        )}
      </dl>

      {product.attributes?.length > 0 && (
        <details className="mt-3 text-sm text-gray-400">
          <summary className="cursor-pointer">Ver atributos y variantes</summary>
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {product.attributes.map((a, i) => (
              <div key={i} className="flex gap-2">
                <span className="w-1/3 shrink-0 text-gray-500">{a.name}</span>
                <span className="text-gray-300">{a.value}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="mt-4">
        <EstadoBadge estado={product.estado_contacto} />
      </div>
    </section>
  );
}

function ManufacturerCard({ product, onContact }) {
  const noVerificado =
    !product.fabricante || product.confianza === "no-verificado";
  const style = CONFIANZA_STYLE[product.confianza] || CONFIANZA_STYLE["no-verificado"];

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Fabricante</h3>
        <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${style}`}>
          {product.confianza === "no-verificado" || noVerificado
            ? "NO VERIFICADO"
            : product.confianza.toUpperCase()}
        </span>
      </div>

      {noVerificado ? (
        <p className="mt-3 text-sm text-gray-400">
          Fabricante no verificado. Esta tienda vende este producto pero no hay datos confirmados
          del fabricante en la página.
        </p>
      ) : (
        <dl className="mt-3 space-y-1.5 text-sm">
          {product.fabricante && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-gray-500">Nombre</dt>
              <dd className="text-gray-200">{product.fabricante}</dd>
            </div>
          )}
          {product.fabricante_email && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-gray-500">Email</dt>
              <dd className="text-blue-400">{product.fabricante_email}</dd>
            </div>
          )}
          {product.fabricante_direccion && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-gray-500">Dirección</dt>
              <dd className="text-gray-200">{product.fabricante_direccion}</dd>
            </div>
          )}
          {product.fabricante_pais && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-gray-500">País</dt>
              <dd className="text-gray-200">{product.fabricante_pais}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>Fuente: {product.source}</span>
        <span>Confianza: {product.confianza.toUpperCase()}</span>
      </div>

      <button
        onClick={onContact}
        className="mt-3 w-full rounded-xl bg-green-600 py-3 font-semibold text-white hover:bg-green-500"
      >
        CONTACTAR
      </button>
    </section>
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

function ContactCard({
  product,
  emailTo,
  setEmailTo,
  subject,
  setSubject,
  message,
  setMessage,
  onRegenerate,
  video,
  videoPreview,
  videoError,
  uploading,
  onVideoChange,
  resetVideo,
  preparing,
  onPrepare,
  prepared,
  sending,
  sendResult,
  onSend,
}) {
  return (
    <section className="mt-4 rounded-2xl border border-green-900 bg-gray-900/60 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-green-400">
        Contactar con el fabricante
      </h3>

      <label className="mt-4 block text-sm text-gray-400">Para</label>
      <input
        type="email"
        value={emailTo}
        onChange={(e) => setEmailTo(e.target.value)}
        placeholder="email@fabricante.com"
        className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-white placeholder-gray-500 focus:border-green-500 focus:outline-none"
      />

      <label className="mt-3 block text-sm text-gray-400">Asunto</label>
      <input
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-white focus:border-green-500 focus:outline-none"
      />

      <div className="mt-3 flex items-center justify-between">
        <label className="text-sm text-gray-400">Mensaje</label>
        <button
          onClick={onRegenerate}
          className="text-xs text-blue-400 hover:underline"
        >
          Regenerar mensaje
        </button>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={8}
        className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white focus:border-green-500 focus:outline-none"
      />

      <div className="mt-4">
        <label className="block text-sm text-gray-400">Vídeo del producto</label>
        {videoPreview ? (
          <div className="mt-2">
            <video
              src={videoPreview}
              controls
              className="max-h-56 w-full rounded-lg bg-black"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
              <span>
                {video.name} · {Math.round(video.size / 1024 / 1024)} MB
              </span>
              <button onClick={resetVideo} className="text-red-400 hover:underline">
                Quitar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => document.getElementById("video-upload")?.click()}
            className="mt-2 w-full rounded-lg border border-dashed border-gray-600 py-4 text-sm text-gray-400 hover:border-gray-400"
          >
            Subir vídeo (MP4, MOV, WEBM · máx. 25 MB)
          </button>
        )}
        <input
          id="video-upload"
          ref={videoInput}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={onVideoChange}
        />
        {videoError && <p className="mt-1 text-sm text-red-400">{videoError}</p>}
        {uploading && <p className="mt-1 text-sm text-gray-400">Subiendo vídeo...</p>}
      </div>

      {sendResult && !sendResult.ok && (
        <p className="mt-3 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
          {sendResult.error}
        </p>
      )}

      {sendResult?.code === "EMAIL_NOT_CONFIGURED" && (
        <div className="mt-3 rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200">
          <p>Email no configurado. Puedes copiar el mensaje o abrirlo en tu cliente de correo.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => navigator.clipboard?.writeText(`Para: ${emailTo}\n\nAsunto: ${subject}\n\n${message}`)}
              className="rounded-lg border border-amber-700 px-3 py-1.5 text-xs hover:bg-amber-900/40"
            >
              Copiar mensaje
            </button>
            <a
              href={sendResult.mailto}
              className="rounded-lg border border-amber-700 px-3 py-1.5 text-xs hover:bg-amber-900/40"
            >
              Abrir en mi correo
            </a>
          </div>
        </div>
      )}

      {sendResult?.ok && (
        <p className="mt-3 rounded-lg border border-green-800 bg-green-950/40 p-3 text-sm text-green-300">
          Email enviado al fabricante.
        </p>
      )}

      <div className="mt-4 flex gap-3">
        <button
          onClick={onPrepare}
          disabled={preparing || !emailTo.trim() || !message.trim()}
          className="flex-1 rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {preparing ? "Preparando..." : "PREPARAR EMAIL"}
        </button>
        {prepared && (
          <button
            onClick={onSend}
            disabled={sending}
            className="flex-1 rounded-xl bg-green-600 py-3 font-semibold text-white hover:bg-green-500 disabled:opacity-40"
          >
            {sending ? "Enviando..." : "ENVIAR EMAIL"}
          </button>
        )}
      </div>
    </section>
  );
}