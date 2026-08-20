import type { VideoGoal, VideoStyle } from "@/types";

export interface Preset {
  id: string;
  name: string;
  description: string;
  style: VideoStyle;
  goal: VideoGoal;
  emoji: string;
}

export const PRESETS: Preset[] = [
  {
    id: "viral-ugc",
    name: "Viral UGC",
    description: "Para contenido generado por usuarios con potencial de volverse viral",
    style: "viral",
    goal: "engagement",
    emoji: "🔥",
  },
  {
    id: "producto",
    name: "Producto",
    description: "Destaca el producto y sus beneficios en vertical",
    style: "producto",
    goal: "ventas",
    emoji: "📦",
  },
  {
    id: "dropshipping",
    name: "Dropshipping",
    description: "Vídeo comercial agresivo para tiendas online",
    style: "anuncio",
    goal: "ventas",
    emoji: "🛒",
  },
  {
    id: "review",
    name: "Review",
    description: "Reseña honesta del producto con opinión real",
    style: "review",
    goal: "retencion",
    emoji: "⭐",
  },
  {
    id: "story",
    name: "Story",
    description: "Narra una historia con estructura narrativa",
    style: "storytelling",
    goal: "branding",
    emoji: "📖",
  },
  {
    id: "tutorial",
    name: "Tutorial",
    description: "Explica cómo usar o hacer algo paso a paso",
    style: "tutorial",
    goal: "engagement",
    emoji: "🎓",
  },
  {
    id: "testimonial",
    name: "Testimonial",
    description: "Cliente o creador hablando de su experiencia",
    style: "ugc",
    goal: "ventas",
    emoji: "💬",
  },
  {
    id: "advertisement",
    name: "Advertisement",
    description: "Anuncio pulido con foco en conversión",
    style: "anuncio",
    goal: "ventas",
    emoji: "📣",
  },
];

export const VIDEO_STYLES: { id: VideoStyle; label: string }[] = [
  { id: "viral", label: "Viral" },
  { id: "ugc", label: "UGC" },
  { id: "producto", label: "Producto" },
  { id: "storytelling", label: "Storytelling" },
  { id: "review", label: "Review" },
  { id: "tutorial", label: "Tutorial" },
  { id: "lifestyle", label: "Lifestyle" },
  { id: "anuncio", label: "Anuncio" },
];

export const VIDEO_GOALS: { id: VideoGoal; label: string }[] = [
  { id: "ventas", label: "Ventas" },
  { id: "seguidores", label: "Seguidores" },
  { id: "retencion", label: "Retención" },
  { id: "engagement", label: "Engagement" },
  { id: "branding", label: "Branding" },
];

export const TARGET_DURATIONS: { id: "auto" | 15 | 30 | 45 | 60 | 90; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: 15, label: "15s" },
  { id: 30, label: "30s" },
  { id: 45, label: "45s" },
  { id: 60, label: "60s" },
  { id: 90, label: "90s" },
];

export const EXPORT_TARGETS: { id: string; label: string; w: number; h: number; fps: number }[] = [
  { id: "tiktok", label: "TikTok", w: 1080, h: 1920, fps: 30 },
  { id: "reels", label: "Instagram Reels", w: 1080, h: 1920, fps: 30 },
  { id: "shorts", label: "YouTube Shorts", w: 1080, h: 1920, fps: 30 },
  { id: "custom", label: "Personalizado", w: 1080, h: 1920, fps: 30 },
];