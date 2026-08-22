import type { AppSettings, Project } from "@/types";

const PROJECTS_KEY = "clipcraft.projects.v1";
const SETTINGS_KEY = "clipcraft.settings.v1";

// Snapshots cacheados: getSnapshot debe devolver SIEMPRE la misma
// referencia mientras no cambien los datos, o React entra en bucle
// infinito ("Maximum update depth exceeded" -> Application error).
let projectsCache: Project[] | null = null;
let settingsCache: AppSettings | null = null;

const BUILTIN_GROQ_KEY = "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";
const BUILTIN_ELEVENLABS_KEY = "sk_c1a85027b5556512faa5e13bab6670694dbf99e716d79b34";

const DEFAULT_SETTINGS: AppSettings = {
  llmProvider: "groq",
  llmApiKey: BUILTIN_GROQ_KEY,
  llmModel: "llama-3.3-70b-versatile",
  ttsProvider: "elevenlabs",
  ttsApiKey: BUILTIN_ELEVENLABS_KEY,
  ttsVoiceId: "alloy",
  sttProvider: "groq",
  sttApiKey: BUILTIN_GROQ_KEY,
};

function pickKey(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function loadProjects(): Project[] {
  if (projectsCache !== null) return projectsCache;
  let loaded: Project[];
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    loaded = Array.isArray(parsed) ? parsed : [];
  } catch {
    loaded = [];
  }
  projectsCache = loaded;
  return loaded;
}

export function saveProjects(projects: Project[]) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // cuota llena
  }
  projectsCache = projects;
}

export function getProject(id: string): Project | null {
  return loadProjects().find((p) => p.id === id) || null;
}

export function upsertProject(project: Project): Project[] {
  const current = [...loadProjects()];
  const idx = current.findIndex((p) => p.id === project.id);
  project.updatedAt = new Date().toISOString();
  if (idx >= 0) current[idx] = project;
  else current.unshift(project);
  saveProjects(current);
  return current;
}

export function deleteProject(id: string): Project[] {
  const next = loadProjects().filter((p) => p.id !== id);
  saveProjects(next);
  return next;
}

export function duplicateProject(id: string): Project | null {
  const src = getProject(id);
  if (!src) return null;
  const copy: Project = {
    ...src,
    id: crypto.randomUUID(),
    name: `${src.name} (copia)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "draft",
    renders: [],
  };
  upsertProject(copy);
  return copy;
}

export function loadSettings(): AppSettings {
  if (settingsCache !== null) return settingsCache;
  let loaded: AppSettings;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    loaded = {
      ...DEFAULT_SETTINGS,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      llmApiKey: pickKey(parsed.llmApiKey, DEFAULT_SETTINGS.llmApiKey),
      sttApiKey: pickKey(parsed.sttApiKey, DEFAULT_SETTINGS.sttApiKey),
      ttsApiKey: pickKey(parsed.ttsApiKey, DEFAULT_SETTINGS.ttsApiKey),
    };
  } catch {
    loaded = { ...DEFAULT_SETTINGS };
  }
  settingsCache = loaded;
  return loaded;
}

export function saveSettings(settings: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignorar
  }
  settingsCache = settings;
}

export function defaultSettings(): AppSettings {
  // Referencia estable: nunca crear objetos nuevos por llamada
  return DEFAULT_SETTINGS;
}

export function serviceStatus(settings: AppSettings, service: "llm" | "tts" | "stt") {
  const defs = {
    llm: {
      configured: Boolean(settings.llmApiKey),
      missing: settings.llmApiKey ? [] : ["llmApiKey"],
    },
    tts: {
      configured: Boolean(settings.ttsApiKey),
      missing: settings.ttsApiKey ? [] : ["ttsApiKey"],
    },
    stt: {
      configured: Boolean(settings.sttApiKey),
      missing: settings.sttApiKey ? [] : ["sttApiKey"],
    },
  };
  return defs[service];
}
