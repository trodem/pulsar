import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  monitorNotifications,
  notificationGroups,
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

// Microsoft Teams via an Incoming Webhook. Sends a legacy MessageCard, which
// every Teams webhook (classic connector or Power Automate "post to a channel")
// renders. `themeColor` tints the card's left edge green (up) or red (down).
async function sendTeams(cfg: any, ctx: NotifyContext): Promise<void> {
  if (!cfg.url) return;
  const icon = ctx.up ? "✅" : "🔴";
  const state = ctx.up ? "UP" : "DOWN";
  const card = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: ctx.up ? "2eb872" : "d9534f",
    summary: `${ctx.monitor.name} is ${state}`,
    sections: [
      {
        activityTitle: `${icon} ${ctx.monitor.name} is ${state}`,
        activitySubtitle: ctx.monitor.target,
        text: ctx.message,
        facts: [
          { name: "Status", value: state },
          { name: "Time", value: new Date(ctx.time * 1000).toISOString() },
        ],
        markdown: false,
      },
    ],
  };
  await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
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
    else if (n.type === "teams") await sendTeams(cfg, ctx);
  } catch (err) {
    console.error(`[notify] ${n.type} "${n.name}" failed:`, err);
  }
}

/**
 * Fires every active notification targeting the monitor. Called on state change.
 * A notification targets a monitor if it is linked directly to it OR to the
 * monitor's group. The two sets are unioned and de-duplicated by id, so a
 * notification attached both ways still fires only once.
 */
export async function notifyForMonitor(ctx: NotifyContext): Promise<void> {
  // Direct monitor links.
  const direct = await db
    .select({ notification: notifications })
    .from(monitorNotifications)
    .innerJoin(
      notifications,
      eq(monitorNotifications.notificationId, notifications.id),
    )
    .where(eq(monitorNotifications.monitorId, ctx.monitor.id))
    .all();

  // Group links (only when the monitor belongs to a group).
  const viaGroup = ctx.monitor.groupId
    ? await db
        .select({ notification: notifications })
        .from(notificationGroups)
        .innerJoin(
          notifications,
          eq(notificationGroups.notificationId, notifications.id),
        )
        .where(eq(notificationGroups.groupId, ctx.monitor.groupId))
        .all()
    : [];

  const byId = new Map<number, Notification>();
  for (const row of [...direct, ...viaGroup]) {
    if (row.notification.active) byId.set(row.notification.id, row.notification);
  }

  await Promise.all([...byId.values()].map((n) => dispatch(n, ctx)));
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
  else if (type === "teams") await sendTeams(config, ctx);
}
