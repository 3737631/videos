"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const NAV = [
  { href: "/crear", label: "Crear", icon: "✨" },
  { href: "/videos", label: "Mis vídeos", icon: "🗂️" },
];

export { NAV };

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-white/8 bg-white/[0.02]">
      <div className="border-b border-white/8 px-5 py-4">
        <Link href="/crear" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-sm font-black text-white">
            C
          </span>
          <span className="text-lg font-extrabold tracking-tight">
            Clip<span className="cc-gradient-text">Craft</span>
          </span>
        </Link>
        <p className="mt-0.5 text-[11px] text-gray-500">Anuncios virales · gratis</p>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname === "/";
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-violet-500/15 font-semibold text-violet-200"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/8 px-3 py-3">
        <div className="rounded-xl bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-300">
          ✓ Local · sin claves · sin esperas
        </div>
      </div>
    </aside>
  );
}
