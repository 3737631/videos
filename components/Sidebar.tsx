"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSettings } from "@/lib/useStore";
import { serviceStatus } from "@/lib/storage";

const NAV = [
  { href: "/", label: "Inicio", icon: "🏠" },
  { href: "/crear", label: "Crear vídeo", icon: "✨" },
  { href: "/proyectos", label: "Mis proyectos", icon: "🗂️" },
  { href: "/plantillas", label: "Plantillas", icon: "📐" },
  { href: "/voces", label: "Voces", icon: "🎙️" },
  { href: "/musica", label: "Música", icon: "🎵" },
  { href: "/exportaciones", label: "Exportaciones", icon: "📤" },
  { href: "/configuracion", label: "Configuración", icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [settings] = useSettings();
  const llm = serviceStatus(settings, "llm");
  const tts = serviceStatus(settings, "tts");
  const stt = serviceStatus(settings, "stt");
  const missing = [...llm.missing, ...tts.missing, ...stt.missing];

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-white/10 bg-[#0e1117]">
      <div className="px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎬</span>
          <span className="font-bold text-lg tracking-tight">ClipCraft</span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">Edición vertical con IA</p>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-blue-600/20 text-blue-300 font-medium"
                  : "text-gray-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-white/10">
        {missing.length > 0 ? (
          <Link
            href="/configuracion"
            className="block rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300"
          >
            ⚠️ Faltan claves de API
            <div className="mt-1 text-[11px] text-amber-200/70">{missing.join(", ")}</div>
          </Link>
        ) : (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-300">
            ✅ IA lista
          </div>
        )}
        <div className="flex items-center gap-2 mt-3 px-1">
          <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold">
            U
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">Usuario local</div>
            <div className="text-xs text-gray-400">Sesión en este navegador</div>
          </div>
        </div>
      </div>
    </aside>
  );
}