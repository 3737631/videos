"use client";

import { useEffect, useState } from "react";

export function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0b0d12]">
        <div className="text-gray-400 text-sm">Cargando ClipCraft...</div>
      </div>
    );
  }
  return <>{children}</>;
}