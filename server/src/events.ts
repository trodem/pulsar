import { EventEmitter } from "node:events";
import type { Heartbeat } from "./db/schema.js";

// Central in-process bus so the scheduler can broadcast without importing the
// Socket.IO layer directly (avoids a circular dependency).
export interface AppEvents {
  heartbeat: (payload: { monitorId: number; heartbeat: Heartbeat }) => void;
  "monitor:changed": (payload: { monitorId: number }) => void;
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
