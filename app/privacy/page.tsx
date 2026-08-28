import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Privacidad — Creador Viral",
  description: "Política de privacidad de Creador Viral: qué datos recopilamos y cómo los protegemos.",
};

const lastUpdate = "28 de agosto de 2026";

export default function PrivacyPage() {
  return (
    <main className="flex-1 bg-[#09090b] text-white flex flex-col items-center px-4 sm:px-6 py-8 sm:py-12">
      <div className="w-full max-w-3xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition mb-6"
        >
          ← Volver a Creador Viral
        </Link>

        <div className="bg-zinc-900 border border-zinc-800 rounded-[2rem] p-6 sm:p-8 md:p-10 shadow-2xl">
          <div className="inline-flex bg-purple-500/10 border border-purple-500/30 text-purple-400 px-3 py-1 rounded-full text-[10px] sm:text-xs font-bold tracking-widest mb-4">
            LEGAL
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight bg-gradient-to-br from-white to-zinc-400 bg-clip-text text-transparent">
            Política de Privacidad
          </h1>
          <p className="text-sm text-zinc-500 mt-2">Última actualización: {lastUpdate}</p>

          <div className="mt-8 space-y-7 text-sm sm:text-[15px] leading-relaxed text-zinc-300">
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">1. Qué es Creador Viral</h2>
              <p>
                Creador Viral es una herramienta web que te permite crear vídeos cortos en formato vertical
                (9:16) combinando tus clips, una voz generada por IA y subtítulos automáticos. Todo el
                procesamiento pesado ocurre en tu navegador y está optimizada para funcionar como aplicación
                estática alojada en GitHub Pages / Vercel.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">2. Qué datos recopilamos</h2>
              <p>Solo recopilamos los datos mínimos necesarios para que la app funcione:</p>
              <ul className="list-disc pl-5 space-y-1.5 marker:text-zinc-500">
                <li>
                  <span className="text-white font-medium">Correo electrónico:</span> solo si nos escribes a
                  soporte o si inicias sesión (cuando esté disponible).
                </li>
                <li>
                  <span className="text-white font-medium">Cuenta de TikTok:</span> identificador básico y
                  token de acceso únicamente cuando tú conectas tu cuenta para usar la función de publicación
                  directa. Puedes revocarlo en cualquier momento desde TikTok.
                </li>
                <li>
                  <span className="text-white font-medium">Vídeos que subes:</span> los clips que seleccionas
                  desde tu galería o los enlaces de TikTok sin marca que pegas. Se procesan en tu navegador y
                  no se almacenan de forma permanente en nuestros servidores.
                </li>
                <li>
                  <span className="text-white font-medium">Datos técnicos mínimos:</span> dirección IP
                  anonimizada, tipo de navegador, sistema operativo y errores técnicos, recogidos de forma
                  agregada por el alojamiento para seguridad y estadísticas básicas.
                </li>
              </ul>
              <p className="text-zinc-400">
                No recopilamos datos sensibles, no hacemos perfilado publicitario y no vendemos tus datos.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">3. Cómo usamos tus vídeos</h2>
              <p>
                Tus vídeos se usan exclusivamente para generar el contenido que tú solicitas: mezclar cortes,
                añadir la voz y los subtítulos y presentarte el resultado para descargar. Solo si pulsas
                explícitamente “Publicar en TikTok” y autorizas tu cuenta, enviaremos el vídeo final a TikTok
                en tu nombre. Nunca publicamos nada sin tu acción directa.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">4. Con quién compartimos datos</h2>
              <p>Nunca compartimos tus datos con terceros para fines comerciales. Solo usamos proveedores necesarios:</p>
              <ul className="list-disc pl-5 space-y-1.5 marker:text-zinc-500">
                <li>
                  <span className="text-white font-medium">TikTok:</span> solo si conectas tu cuenta y
                  autorizas la publicación.
                </li>
                <li>
                  <span className="text-white font-medium">Proveedores de IA (OpenAI u otros):</span> solo para
                  generar el guion/voz si usas esas funciones. Se envía únicamente el texto del guion.
                </li>
                <li>
                  <span className="text-white font-medium">Vercel / GitHub Pages:</span> infraestructura de
                  alojamiento estático y entrega de la web.
                </li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">5. Cookies y almacenamiento local</h2>
              <p>
                Creador Viral no usa cookies de publicidad. Podemos usar almacenamiento local
                (`localStorage`) y cookies técnicas para recordar tu idioma, tema o los clips temporales
                mientras creas un vídeo. Puedes borrarlos desde la configuración de tu navegador sin afectar
                el funcionamiento básico.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">6. Tus derechos</h2>
              <p>
                Tienes derecho a acceder, rectificar y eliminar tus datos. Si deseas que borremos el correo
                con el que nos contactaste o que revoquemos el acceso a tu cuenta de TikTok, escríbenos y lo
                procesaremos sin demora. También puedes gestionar o revocar los permisos desde la configuración
                de tu cuenta de TikTok.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">7. Conservación</h2>
              <p>
                Los vídeos procesados en el navegador no se conservan en nuestros servidores. Si en el futuro
                añadimos almacenamiento opcional en la nube, lo indicaremos aquí y será siempre con tu
                consentimiento explícito.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">8. Contacto</h2>
              <p>
                Para cualquier duda sobre privacidad, ejerce tus derechos escribiendo a{" "}
                <a
                  href="mailto:juliogomezpay107@gmail.com"
                  className="text-purple-400 hover:text-purple-300 underline underline-offset-4"
                >
                  juliogomezpay107@gmail.com
                </a>
                .
              </p>
            </section>

            <div className="pt-6 border-t border-zinc-800 flex flex-col sm:flex-row gap-3 text-sm">
              <Link href="/terms" className="text-zinc-400 hover:text-white underline underline-offset-4">
                Ver Términos de Servicio →
              </Link>
              <span className="hidden sm:inline text-zinc-600">·</span>
              <Link href="/" className="text-zinc-400 hover:text-white underline underline-offset-4">
                Volver al inicio
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
