"use client";

import { useState, useEffect } from "react";

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="p-8 text-white">Loading...</div>;

  return <div className="p-8 text-white">Hello World - ClipCraft</div>;
}