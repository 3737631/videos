import type { Project, RenderJob } from "@/types";

export type JobKind = "analyze" | "create" | "render" | "export";

export interface JobInstance {
  id: string;
  projectId: string;
  kind: JobKind;
  status: RenderJob["status"];
  stage: string;
  progress: number;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  cancel?: () => void;
}

export class JobRunner {
  private jobs = new Map<string, JobInstance>();
  private listeners = new Set<(jobs: JobInstance[]) => void>();

  subscribe(fn: (jobs: JobInstance[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => this.listeners.delete(fn);
  }

  list(): JobInstance[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  private emit() {
    const jobs = this.list();
    this.listeners.forEach((fn) => fn(jobs));
  }

  create(
    projectId: string,
    kind: JobKind,
    run: (update: (stage: string, progress: number) => void) => Promise<() => void>
  ): JobInstance {
    const id = crypto.randomUUID();
    let cancelled = false;
    const job: JobInstance = {
      id,
      projectId,
      kind,
      status: "running",
      stage: "Iniciando",
      progress: 0,
      startedAt: Date.now(),
      cancel: () => {
        cancelled = true;
        job.status = "failed";
        job.stage = "Cancelado";
        job.error = "Trabajo cancelado por el usuario";
        job.finishedAt = Date.now();
        this.emit();
      },
    };
    this.jobs.set(id, job);
    this.emit();

    const update = (stage: string, progress: number) => {
      job.stage = stage;
      job.progress = Math.max(0, Math.min(100, progress));
      this.emit();
    };

    run(update)
      .then(async (cleanup) => {
        if (cancelled) return;
        job.status = "done";
        job.progress = 100;
        job.stage = "Completado";
        job.finishedAt = Date.now();
        await cleanup?.();
      })
      .catch((err) => {
        if (cancelled) return;
        job.status = "failed";
        job.stage = "Error";
        job.error = err instanceof Error ? err.message : String(err);
        job.finishedAt = Date.now();
      })
      .finally(() => {
        this.emit();
        setTimeout(() => {
          this.jobs.delete(id);
          this.emit();
        }, 60_000);
      });

    return job;
  }

  get(projectId: string): JobInstance | undefined {
    return this.list().find((j) => j.projectId === projectId && j.status === "running");
  }
}

export const jobs = new JobRunner();

export function toRenderJob(job: JobInstance): RenderJob {
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
    outputUrl: job.status === "done" ? `job://${job.id}` : undefined,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export function updateProjectStatus(project: Project, job: JobInstance | undefined): Project {
  if (!project) return project;
  if (job?.status === "failed") return { ...project, status: "failed" };
  if (job?.status === "done") return { ...project, status: "ready" };
  if (job?.status === "running") return { ...project, status: "processing" };
  return project;
}