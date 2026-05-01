import type { RunProgressEvent } from "@test-evals/shared";

type Listener = (event: RunProgressEvent) => void;

export class RunEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(runId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  publish(event: RunProgressEvent): void {
    const listeners = this.listeners.get(event.runId);
    if (listeners === undefined) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }
}

export const runEventBus = new RunEventBus();
