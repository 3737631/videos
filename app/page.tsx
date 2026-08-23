"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/crear");
  }, [router]);
  return (
    <AppShell>
      <div className="flex h-[70dvh] items-center justify-center text-sm text-gray-500">
        Cargando ClipCraft…
      </div>
    </AppShell>
  );
}
