import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["executive", "sales_head"]);
export const leadSourceEnum = pgEnum("lead_source", [
  "property_portal",
  "social_ad",
  "website",
  "hoarding_call",
]);
export const leadStatusEnum = pgEnum("lead_status", ["new", "contacted", "closed"]);
export const languageEnum = pgEnum("language", ["en", "hi", "gu"]);
export const visitStatusEnum = pgEnum("visit_status", [
  "booked",
  "visited",
  "no_show",
  "cancelled",
]);
export const messageKindEnum = pgEnum("message_kind", [
  "confirmation",
  "reminder_1d",
  "reminder_2h",
]);

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  email: text().notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum().notNull(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const projects = pgTable("projects", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  reraNumber: text("rera_number").notNull(),
  locationLabel: text("location_label").notNull(),
  mapUrl: text("map_url").notNull(),
});

// The lead's public ID is `LD-${id}`, so ids can match the brief's LD-58210 style.
export const leads = pgTable(
  "leads",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({ startWith: 60000 }),
    name: text(),
    phone: text(),
    source: leadSourceEnum().notNull(),
    projectId: integer("project_id").references(() => projects.id),
    wants: text(),
    budget: text(),
    language: languageEnum().notNull().default("en"),
    status: leadStatusEnum().notNull().default("new"),
    assignedToId: integer("assigned_to_id").references(() => users.id),
    duplicateOfId: integer("duplicate_of_id").references((): AnyPgColumn => leads.id),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leads_phone_idx").on(t.phone), index("leads_assigned_idx").on(t.assignedToId)],
);

export const slots = pgTable(
  "slots",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    isOpen: boolean("is_open").notNull().default(true),
  },
  (t) => [uniqueIndex("slots_project_time_uq").on(t.projectId, t.startsAt)],
);

export const visits = pgTable(
  "visits",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    slotId: integer("slot_id")
      .notNull()
      .references(() => slots.id),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    status: visitStatusEnum().notNull().default("booked"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // These two indexes are what make double booking impossible, even under concurrent requests.
    uniqueIndex("one_active_visit_per_slot").on(t.slotId).where(sql`status = 'booked'`),
    uniqueIndex("one_active_visit_per_lead").on(t.leadId).where(sql`status = 'booked'`),
  ],
);

// Simulated outbox: messages are recorded here and shown to staff, never really sent.
export const messages = pgTable("messages", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id),
  visitId: integer("visit_id").references(() => visits.id),
  kind: messageKindEnum().notNull(),
  sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});
