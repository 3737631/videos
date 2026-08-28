import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Términos de Servicio — Creador Viral",
  description: "Términos de uso de Creador Viral: derechos, responsabilidades y uso de la plataforma.",
};

const lastUpdate = "28 de agosto de 2026";

export default function TermsPage() {
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
            Términos de Servicio
          </h1>
          <p className="text-sm text-zinc-500 mt-2">Última actualización: {lastUpdate}</p>

          <div className="mt-8 space-y-7 text-sm sm:text-[15px] leading-relaxed text-zinc-300">
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">1. Uso permitido</h2>
              <p>
                Creador Viral es una herramienta para crear vídeos verticales con fines creativos, educativos y
                promocionales. Te comprometes a usarla de forma legal, respetuosa y conforme a estas condiciones
                y a las leyes aplicables en tu territorio.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">2. Tu contenido y tu responsabilidad</h2>
              <p>
                Tú eres el único responsable del contenido que subes, enlazas o publicas. Al usar Creador Viral
                declaras que tienes los derechos necesarios sobre los vídeos, imágenes, música y textos, y que tu
                contenido no infringe derechos de autor, marcas, privacidad o cualquier otro derecho de terceros.
              </p>
              <p className="text-zinc-400">
                Si usas la función de “vídeos sin marca” a partir de enlaces de TikTok, asegúrate de tener
                permiso para reutilizar ese material y de respetar las normas de TikTok.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">3. Contenido no permitido</h2>
              <ul className="list-disc pl-5 space-y-1.5 marker:text-zinc-500">
                <li>Contenido que infrinja derechos de autor o las Normas comunitarias de TikTok.</li>
                <li>Contenido engañoso, spam, suplantación o que incite al odio, acoso o violencia.</li>
                <li>Uso automatizado abusivo que sobrecargue la plataforma o eluda límites técnicos.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">4. Publicación en TikTok</h2>
              <p>
                La función de publicación requiere que conectes y autorices tu propia cuenta de TikTok mediante
                OAuth. Solo publicaremos en tu cuenta cuando tú lo confirmes explícitamente. Puedes revocar el
                acceso en cualquier momento desde la configuración de tu cuenta de TikTok o escribiéndonos.
              </p>
              <p className="text-zinc-400">
                La publicación está sujeta a la disponibilidad y límites de la API oficial de TikTok.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">5. Suspensión de acceso</h2>
              <p>
                Podemos limitar o suspender el acceso si detectamos uso abusivo, fraudulento, que infrinja estos
                Términos o que ponga en riesgo la estabilidad del servicio o los derechos de terceros. En caso
                de suspensión, puedes contactar con soporte para revisión.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">6. Servicios externos</h2>
              <p>
                Creador Viral se integra con servicios externos como TikTok y proveedores de IA (por ejemplo,
                OpenAI). Estos servicios tienen sus propios términos y políticas, y pueden cambiar o
                interrumpirse sin previo aviso. No somos responsables de su disponibilidad, exactitud o
                resultados. Usar Creador Viral implica aceptar también dichos términos externos cuando uses
                esas funciones.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">7. Sin garantías</h2>
              <p>
                El servicio se ofrece “tal cual” y “según disponibilidad”. No garantizamos que esté libre de
                errores o que cumpla todas tus expectativas comerciales. En la medida permitida por la ley,
                limitamos nuestra responsabilidad al máximo permitido.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">8. Cambios en los términos</h2>
              <p>
                Podemos actualizar estos Términos para reflejar mejoras del servicio o cambios legales. Si los
                cambios son relevantes, lo indicaremos actualizando la fecha al inicio de esta página. El uso
                continuado tras la actualización implica la aceptación de los nuevos términos.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-white">9. Contacto</h2>
              <p>
                Para dudas, reclamaciones o ejercicio de derechos, escríbenos a{" "}
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
              <Link href="/privacy" className="text-zinc-400 hover:text-white underline underline-offset-4">
                Ver Política de Privacidad →
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
