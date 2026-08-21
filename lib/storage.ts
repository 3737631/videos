import type { AppSettings, Project } from "@/types";

const PROJECTS_KEY = "clipcraft.projects.v1";
const SETTINGS_KEY = "clipcraft.settings.v1";

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // cuota llena
  }
}

export function getProject(id: string): Project | null {
  return loadProjects().find((p) => p.id === id) || null;
}

export function upsertProject(project: Project): Project[] {
  const projects = loadProjects();
  const idx = projects.findIndex((p) => p.id === project.id);
  project.updatedAt = new Date().toISOString();
  if (idx >= 0) projects[idx] = project;
  else projects.unshift(project);
  saveProjects(projects);
  return projects;
}

export function deleteProject(id: string): Project[] {
  const projects = loadProjects().filter((p) => p.id !== id);
  saveProjects(projects);
  return projects;
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
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignorar
  }
}

export function defaultSettings(): AppSettings {
  return {
    llmProvider: "groq",
    llmApiKey: "",
    llmModel: "llama-3.3-70b-versatile",
    ttsProvider: "elevenlabs",
    ttsApiKey: "",
    ttsVoiceId: "alloy",
    sttProvider: "groq",
    sttApiKey: "",
  };
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