/**
 * ALMACENAMIENTO V3 — 100% local, CERO claves de API.
 * Ajustes: voz preferida + idiomas pre-descargados + preferencias de UI.
 */
import type { AppSettings, Project } from "@/types";

const PROJECTS_KEY = "clipcraft.projects.v1";
const SETTINGS_KEY = "clipcraft.settings.v3";

let projectsCache: Project[] | null = null;
let settingsCache: AppSettings | null = null;

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
  } catch {}
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

/** IDs antiguos (ElevenLabs u otros) → voz del catálogo V3 por idioma */
function normalizeVoiceId(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  // Los IDs V3 son tipo es_ES-carlfm-x_low / af_heart
  if (/^(es_|fr_|de_|it_|pt_)[A-Za-z0-9-]+$/.test(raw)) return raw;
  if (/^a[bm]_[a-z]+$/.test(raw)) return raw; // kokoro
  return "";
}

export function loadSettings(): AppSettings {
  if (settingsCache !== null) return settingsCache;
  let loaded: AppSettings;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    loaded = {
      ...defaultSettings(),
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      ttsVoiceId: normalizeVoiceId(parsed.ttsVoiceId) || defaultSettings().ttsVoiceId,
      preferredLanguages: Array.isArray(parsed.preferredLanguages)
        ? parsed.preferredLanguages.filter((x: unknown) => typeof x === "string")
        : [],
    };
    // PURGA: nunca resucitar claves de la v1
    const purge = loaded as unknown as Record<string, unknown>;
    delete purge.llmApiKey;
    delete purge.ttsApiKey;
    delete purge.sttApiKey;
  } catch {
    loaded = defaultSettings();
  }
  try {
    // limpieza defensiva de restos v1 con claves
    localStorage.removeItem("clipcraft.settings.v1");
  } catch {}
  settingsCache = loaded;
  return loaded;
}

export function saveSettings(settings: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
  settingsCache = settings;
}

export function defaultSettings(): AppSettings {
  return {
    ttsVoiceId: "es_ES-carlfm-x_low",
    preferredLanguages: ["es"],
  };
}
