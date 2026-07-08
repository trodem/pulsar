export interface Heartbeat {
  id: number;
  monitorId: number;
  status: number; // 1 up, 0 down
  message: string;
  ping: number | null;
  important: boolean;
  time: number; // unix seconds
}

export interface MonitorStats {
  status: number | null;
  lastMessage: string;
  lastCheck: number | null;
  uptime24h: number | null;
  avgPing: number | null;
}

export interface Monitor {
  id: number;
  name: string;
  type: "http" | "tcp" | "ping";
  target: string;
  port: number | null;
  interval: number;
  timeout: number;
  retries: number;
  acceptedStatus: string;
  method: string;
  active: boolean;
  createdAt: number;
  stats?: MonitorStats;
  heartbeats?: Heartbeat[];
  notificationIds?: number[];
}

export interface Notification {
  id: number;
  name: string;
  type: "webhook" | "telegram";
  config: Record<string, any>;
  active: boolean;
}
