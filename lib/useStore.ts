"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AppSettings, Project } from "@/types";
import { loadSettings, saveSettings, loadProjects, saveProjects } from "@/lib/storage";

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSettingsSnapshot(): AppSettings {
  return loadSettings();
}

function getProjectsSnapshot(): Project[] {
  return loadProjects();
}

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const settings = useSyncExternalStore(subscribe, getSettingsSnapshot, getSettingsSnapshot);
  const update = useCallback((patch: Partial<AppSettings>) => {
    saveSettings({ ...loadSettings(), ...patch });
    emit();
  }, []);
  return [settings, update];
}

export function useProjects(): [Project[], (projects: Project[]) => void] {
  const projects = useSyncExternalStore(subscribe, getProjectsSnapshot, getProjectsSnapshot);
  const update = useCallback((next: Project[]) => {
    saveProjects(next);
    emit();
  }, []);
  return [projects, update];
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => Date.now(), () => Date.now());
}

export function useCurrentProject(id: string | null) {
  const [projects] = useProjects();
  return projects.find((p) => p.id === id) || null;
}

export function useProjectActions() {
  const [projects, setProjects] = useProjects();

  const saveProject = useCallback(
    (project: Project) => {
      const idx = projects.findIndex((p) => p.id === project.id);
      const next = [...projects];
      const updated = { ...project, updatedAt: new Date().toISOString() };
      if (idx >= 0) next[idx] = updated;
      else next.push(updated);
      setProjects(next);
    },
    [projects, setProjects]
  );

  const deleteProject = useCallback(
    (id: string) => {
      setProjects(projects.filter((p) => p.id !== id));
    },
    [projects, setProjects]
  );

  const duplicateProject = useCallback(
    (id: string) => {
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      const copy: Project = {
        ...p,
        id: crypto.randomUUID(),
        name: `${p.name} (copia)`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "draft",
        renders: [],
      };
      setProjects([...projects, copy]);
    },
    [projects, setProjects]
  );

  const getProject = useCallback(
    (id: string) => projects.find((p) => p.id === id) || null,
    [projects]
  );

  return { projects, saveProject, deleteProject, duplicateProject, getProject };
}

export function useHydrated(): boolean {
  const [projects] = useProjects();
  void projects;
  return true;
}

export function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}