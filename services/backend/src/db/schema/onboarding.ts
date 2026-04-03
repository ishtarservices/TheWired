import { text, integer, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { appSchema, spaces } from "./spaces.js";
import { spaceRoles } from "./permissions.js";
import { spaceChannels } from "./channels.js";

// ── Onboarding Config (1:1 with spaces) ────────────────────────────

export const onboardingConfig = appSchema.table("onboarding_config", {
  spaceId: text("space_id").primaryKey().references(() => spaces.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  welcomeMessage: text("welcome_message"),
  welcomeImage: text("welcome_image"),
  requireCompletion: boolean("require_completion").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Onboarding Questions ────────────────────────────────────────────

export const onboardingQuestions = appSchema.table("onboarding_questions", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  position: integer("position").notNull().default(0),
  required: boolean("required").notNull().default(false),
  multiple: boolean("multiple").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Onboarding Answers ──────────────────────────────────────────────

export const onboardingAnswers = appSchema.table("onboarding_answers", {
  id: text("id").primaryKey(),
  questionId: text("question_id").notNull().references(() => onboardingQuestions.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  emoji: text("emoji"),
  position: integer("position").notNull().default(0),
});

// ── Answer → Role/Channel Mappings ──────────────────────────────────

export const onboardingAnswerMappings = appSchema.table("onboarding_answer_mappings", {
  id: text("id").primaryKey(),
  answerId: text("answer_id").notNull().references(() => onboardingAnswers.id, { onDelete: "cascade" }),
  roleId: text("role_id").references(() => spaceRoles.id, { onDelete: "cascade" }),
  channelId: text("channel_id").references(() => spaceChannels.id, { onDelete: "cascade" }),
});

// ── Welcome Checklist / Todo Items ──────────────────────────────────

export const onboardingTodoItems = appSchema.table("onboarding_todo_items", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  linkChannelId: text("link_channel_id"),
  position: integer("position").notNull().default(0),
});

// ── Per-Member Onboarding State ─────────────────────────────────────

export const memberOnboardingState = appSchema.table("member_onboarding_state", {
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  pubkey: text("pubkey").notNull(),
  completedAt: timestamp("completed_at"),
  answers: text("answers"),       // JSON: [{questionId, answerIds}]
  todoCompleted: text("todo_completed"), // JSON: ["todoId1", ...]
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.pubkey] }),
]);
