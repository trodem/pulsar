import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

// A folder-like grouping. A monitor belongs to at most one group; the dashboard
// renders one section per group (plus an "Ungrouped" section).
export const groups = sqliteTable("groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Manual sort order for the dashboard sections (lower shows first).
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export const monitors = sqliteTable("monitors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // "http" | "tcp" | "ping" | "http-ping"
  type: text("type").notNull().default("http"),
  // Optional group this monitor belongs to (null = Ungrouped).
  groupId: integer("group_id").references(() => groups.id, {
    onDelete: "set null",
  }),
  // For http / http-ping: full URL. For tcp/ping: hostname or IP.
  target: text("target").notNull(),
  // For tcp: port number.
  port: integer("port"),
  // Seconds between checks.
  interval: integer("interval").notNull().default(60),
  // Request timeout in seconds.
  timeout: integer("timeout").notNull().default(10),
  // Number of retries before marking down.
  retries: integer("retries").notNull().default(0),
  // HTTP: comma-separated list of acceptable status ranges, e.g. "200-299".
  acceptedStatus: text("accepted_status").notNull().default("200-299"),
  // HTTP method.
  method: text("method").notNull().default("GET"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export const heartbeats = sqliteTable("heartbeats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  monitorId: integer("monitor_id")
    .notNull()
    .references(() => monitors.id, { onDelete: "cascade" }),
  // 1 = up, 0 = down
  status: integer("status").notNull(),
  message: text("message").notNull().default(""),
  // Round-trip time in milliseconds.
  ping: real("ping"),
  // Whether this beat is a state transition (up<->down).
  important: integer("important", { mode: "boolean" }).notNull().default(false),
  time: integer("time")
    .notNull()
    .default(sql`(unixepoch())`),
});

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // "webhook" | "telegram"
  type: text("type").notNull(),
  // JSON blob with type-specific config (url, botToken, chatId, ...).
  config: text("config").notNull().default("{}"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

// Join table: which notifications fire for which monitor.
export const monitorNotifications = sqliteTable("monitor_notifications", {
  monitorId: integer("monitor_id")
    .notNull()
    .references(() => monitors.id, { onDelete: "cascade" }),
  notificationId: integer("notification_id")
    .notNull()
    .references(() => notifications.id, { onDelete: "cascade" }),
});

// A colored label that can be attached to many monitors (many-to-many).
export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  // Hex color shown on the tag chip (e.g. "#4f9dff").
  color: text("color").notNull().default("#4f9dff"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

// Join table: which tags are attached to which monitor.
export const monitorTags = sqliteTable("monitor_tags", {
  monitorId: integer("monitor_id")
    .notNull()
    .references(() => monitors.id, { onDelete: "cascade" }),
  tagId: integer("tag_id")
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
});

export type Monitor = typeof monitors.$inferSelect;
export type NewMonitor = typeof monitors.$inferInsert;
export type Heartbeat = typeof heartbeats.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type User = typeof users.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Tag = typeof tags.$inferSelect;
