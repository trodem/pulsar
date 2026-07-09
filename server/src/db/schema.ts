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
  // 1 = up, 2 = degraded, 0 = down, 3 = maintenance
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

// A maintenance window: suppresses checks (and thus notifications) for the
// covered monitors while it is active. `strategy` selects how `startDate`/
// `endDate`/`startTime`/`endTime`/`daysOfWeek`/`daysOfMonth` are interpreted:
//   single  — one-off window: [startDate, endDate] are full unix datetimes.
//   daily   — every day between startTime..endTime (minutes from local midnight),
//             bounded by the optional [startDate, endDate] validity range.
//   weekly  — like daily, but only on weekdays listed in daysOfWeek (0=Sun..6=Sat).
//   monthly — like daily, but only on days listed in daysOfMonth (1..31).
// All time-of-day math uses the server's local timezone.
export const maintenances = sqliteTable("maintenances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  // "single" | "daily" | "weekly" | "monthly"
  strategy: text("strategy").notNull().default("single"),
  // Master switch: an inactive maintenance never suppresses anything.
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  // Validity range (unix seconds). For "single" this IS the window; for the
  // recurring strategies these are optional bounds (null = unbounded).
  startDate: integer("start_date"),
  endDate: integer("end_date"),
  // Recurring daily time window, minutes from local midnight (null for single).
  // endTime <= startTime means the window wraps past midnight.
  startTime: integer("start_time"),
  endTime: integer("end_time"),
  // JSON arrays; daysOfWeek for "weekly" ([0..6]), daysOfMonth for "monthly".
  daysOfWeek: text("days_of_week").notNull().default("[]"),
  daysOfMonth: text("days_of_month").notNull().default("[]"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

// Join table: monitors directly covered by a maintenance window.
export const maintenanceMonitors = sqliteTable("maintenance_monitors", {
  maintenanceId: integer("maintenance_id")
    .notNull()
    .references(() => maintenances.id, { onDelete: "cascade" }),
  monitorId: integer("monitor_id")
    .notNull()
    .references(() => monitors.id, { onDelete: "cascade" }),
});

// Join table: groups covered by a maintenance window (covers all their monitors).
export const maintenanceGroups = sqliteTable("maintenance_groups", {
  maintenanceId: integer("maintenance_id")
    .notNull()
    .references(() => maintenances.id, { onDelete: "cascade" }),
  groupId: integer("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
});

export type Monitor = typeof monitors.$inferSelect;
export type NewMonitor = typeof monitors.$inferInsert;
export type Heartbeat = typeof heartbeats.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type User = typeof users.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Maintenance = typeof maintenances.$inferSelect;
