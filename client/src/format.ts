export function uptimePct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export function ms(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(v)} ms`;
}

export function relTime(unix: number | null | undefined): string {
  if (!unix) return "never";
  const diff = Date.now() / 1000 - unix;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(unix * 1000).toLocaleDateString();
}

export function statusLabel(status: number | null | undefined): {
  text: string;
  cls: string;
} {
  if (status === 1) return { text: "Up", cls: "status-up" };
  if (status === 0) return { text: "Down", cls: "status-down" };
  return { text: "Pending", cls: "status-pending" };
}
