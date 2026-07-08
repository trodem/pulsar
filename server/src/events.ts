import { EventEmitter } from "node:events";
import type { Heartbeat } from "./db/schema.js";

// Central in-process bus so the scheduler can broadcast without importing the
// Socket.IO layer directly (avoids a circular dependency).
export interface AppEvents {
  heartbeat: (payload: { monitorId: number; heartbeat: Heartbeat }) => void;
  "monitor:changed": (payload: { monitorId: number }) => void;
  // Users currently seen in the STAP log for the given monitor, plus any error
  // encountered while reading that log (null when the read succeeded).
  "monitor:users": (payload: {
    monitorId: number;
    users: string[];
    error: string | null;
  }) => void;
}

class TypedEmitter extends EventEmitter {
  emitEvent<K extends keyof AppEvents>(
    event: K,
    ...args: Parameters<AppEvents[K]>
  ): void {
    this.emit(event, ...args);
  }
  onEvent<K extends keyof AppEvents>(event: K, listener: AppEvents[K]): void {
    this.on(event, listener as (...args: any[]) => void);
  }
}

export const bus = new TypedEmitter();
