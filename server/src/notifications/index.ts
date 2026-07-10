import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  monitorNotifications,
  notifications,
  type Monitor,
  type Notification,
} from "../db/schema.js";

export interface NotifyContext {
  monitor: Monitor;
  up: boolean;
  message: string;
  time: number;
}

async function sendWebhook(cfg: any, ctx: NotifyContext): Promise<void> {
  if (!cfg.url) return;
  const payload = {
    monitor: ctx.monitor.name,
    target: ctx.monitor.target,
    status: ctx.up ? "up" : "down",
    message: ctx.message,
    time: new Date(ctx.time * 1000).toISOString(),
  };
  await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function sendTelegram(cfg: any, ctx: NotifyContext): Promise<void> {
  if (!cfg.botToken || !cfg.chatId) return;
  const icon = ctx.up ? "✅" : "🔴";
  const text =
    `${icon} *${ctx.monitor.name}* is ${ctx.up ? "UP" : "DOWN"}\n` +
    `${ctx.monitor.target}\n${ctx.message}`;
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: cfg.chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

async function dispatch(n: Notification, ctx: NotifyContext): Promise<void> {
  let cfg: any = {};
  try {
    cfg = JSON.parse(n.config || "{}");
  } catch {
    cfg = {};
  }
  try {
    if (n.type === "webhook") await sendWebhook(cfg, ctx);
    else if (n.type === "telegram") await sendTelegram(cfg, ctx);
  } catch (err) {
    console.error(`[notify] ${n.type} "${n.name}" failed:`, err);
  }
}

/**
 * Fires every active notification linked to the monitor. Called on state change.
 */
export async function notifyForMonitor(ctx: NotifyContext): Promise<void> {
  const linked = await db
    .select({ notification: notifications })
    .from(monitorNotifications)
    .innerJoin(
      notifications,
      eq(monitorNotifications.notificationId, notifications.id),
    )
    .where(eq(monitorNotifications.monitorId, ctx.monitor.id))
    .all();

  await Promise.all(
    linked
      .map((row) => row.notification)
      .filter((n) => n.active)
      .map((n) => dispatch(n, ctx)),
  );
}

/** Sends a one-off test message for a notification config. */
export async function testNotification(
  type: string,
  config: any,
): Promise<void> {
  const ctx: NotifyContext = {
    monitor: { name: "Test Monitor", target: "example.com" } as Monitor,
    up: false,
    message: "This is a test notification.",
    time: Math.floor(Date.now() / 1000),
  };
  if (type === "webhook") await sendWebhook(config, ctx);
  else if (type === "telegram") await sendTelegram(config, ctx);
}
