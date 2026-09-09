import { parseVoiceInterviewSlots, type VoiceInterviewSlot } from "@/lib/voice-interview-availability";
import { scheduledInstant } from "@/lib/interview-time";

// Slot status is the appointment lifecycle. Applicant outcomes such as
// "Passed" remain on the applicant record, while the slot records whether the
// appointment is available, scheduled, completed, or unable to proceed.
export const availabilityStatuses = ["Available", "Booked", "Blocked", "Expired", "Completed", "No Show", "Cancelled"] as const;
export type AvailabilityStatus = typeof availabilityStatuses[number];
export type InterviewAvailabilityRule = {
  ruleId: string;
  roleId: string;
  interviewType: "AI Voice Interview" | "Final Interview";
  mode: "recurring" | "specific";
  startDate: string;
  endDate: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  timezone: string;
  specificSlots: VoiceInterviewSlot[];
  status: "Active" | "Archived";
  createdAt?: string;
  updatedAt?: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function text(value: unknown) { return String(value ?? "").trim(); }
function hash(value: string) { let result = 2166136261; for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619); return (result >>> 0).toString(16).padStart(8, "0"); }
function dateParts(value: string) { const [year, month, day] = value.split("-").map(Number); return { year, month, day }; }
function addDays(value: string, days: number) { const p = dateParts(value); const date = new Date(Date.UTC(p.year, p.month - 1, p.day + days)); return date.toISOString().slice(0, 10); }
function weekday(value: string) { const p = dateParts(value); return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); }
function minutes(value: string) { const [hours, mins] = value.split(":").map(Number); return hours * 60 + mins; }
function time(value: number) { return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`; }
function validTimezone(value: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return value; } catch { return "Asia/Singapore"; }
}
function todayInTimezone(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function monthStart(value: string) { return `${value.slice(0, 7)}-01`; }
function monthEnd(value: string) { const nextMonth = addDays(monthStart(value), 32); return addDays(`${nextMonth.slice(0, 7)}-01`, -1); }
export function isCurrentCalendarMonth(value: string, timezone = "Asia/Singapore", now = new Date()) {
  if (!DATE.test(value)) return false;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: validTimezone(timezone), year: "numeric", month: "2-digit" }).formatToParts(now);
  const current = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return value.slice(0, 7) === `${current.year}-${current.month}`;
}
function stableRuleId(rule: Pick<InterviewAvailabilityRule, "roleId" | "interviewType" | "mode" | "startDate" | "endDate" | "startTime" | "endTime" | "timezone">) {
  return `RULE-${hash(JSON.stringify(rule)).toUpperCase()}`;
}

export function parseAvailabilityRules(value: unknown): InterviewAvailabilityRule[] {
  let candidate = value;
  if (typeof value === "string") {
    if (!value.trim()) return [];
    try { candidate = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const source = raw as Partial<InterviewAvailabilityRule>;
    const specificSlots = Array.isArray(source.specificSlots)
      ? parseVoiceInterviewSlots(source.specificSlots)
      : [];
    const rule = {
      ruleId: text(source.ruleId),
      roleId: text(source.roleId),
      interviewType: source.interviewType,
      mode: source.mode,
      startDate: text(source.startDate),
      endDate: text(source.endDate),
      weekdays: Array.isArray(source.weekdays) ? source.weekdays.map(Number).filter((day) => day >= 0 && day <= 6) : [],
      startTime: text(source.startTime),
      endTime: text(source.endTime),
      slotDurationMinutes: source.interviewType === "AI Voice Interview" ? 10 : source.interviewType === "Final Interview" ? 60 : Number(source.slotDurationMinutes || 30),
      timezone: text(source.timezone) || "Asia/Singapore",
      specificSlots,
      status: source.status === "Archived" ? "Archived" : "Active",
      createdAt: text(source.createdAt) || undefined,
      updatedAt: text(source.updatedAt) || undefined,
    } as InterviewAvailabilityRule;
    if (!rule.roleId || (rule.interviewType !== "AI Voice Interview" && rule.interviewType !== "Final Interview")) return [];
    if (rule.mode !== "recurring" && rule.mode !== "specific") return [];
    if (rule.mode === "recurring" && (!DATE.test(rule.startDate) || !DATE.test(rule.endDate) || rule.startDate > rule.endDate || !TIME.test(rule.startTime) || !TIME.test(rule.endTime) || rule.startTime >= rule.endTime || rule.weekdays.length === 0)) return [];
    if (rule.mode === "specific" && specificSlots.length === 0) return [];
    if (!rule.ruleId) rule.ruleId = stableRuleId(rule);
    return [rule];
  });
}

export function serializeAvailabilityRules(value: unknown) { return JSON.stringify(parseAvailabilityRules(value)); }

function timesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function datesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return leftStart <= rightEnd && leftEnd >= rightStart;
}

function specificSlotsOverlap(left: VoiceInterviewSlot, right: VoiceInterviewSlot) {
  if (left.timezone === right.timezone) {
    return left.date === right.date && timesOverlap(left.startTime, left.endTime, right.startTime, right.endTime);
  }
  try {
    const leftStart = scheduledInstant(left.date, left.startTime, left.timezone).getTime();
    const leftEnd = scheduledInstant(left.date, left.endTime, left.timezone).getTime();
    const rightStart = scheduledInstant(right.date, right.startTime, right.timezone).getTime();
    const rightEnd = scheduledInstant(right.date, right.endTime, right.timezone).getTime();
    return leftStart < rightEnd && leftEnd > rightStart;
  } catch {
    return false;
  }
}

/** Rules for the same role and interview type must not create overlapping candidate times. */
export function availabilityRulesOverlap(left: InterviewAvailabilityRule, right: InterviewAvailabilityRule) {
  if (left.roleId !== right.roleId || left.interviewType !== right.interviewType) return false;
  if (left.status !== "Active" || right.status !== "Active") return false;

  if (left.mode === "recurring" && right.mode === "recurring") {
    return datesOverlap(left.startDate, left.endDate, right.startDate, right.endDate)
      && left.weekdays.some((day) => right.weekdays.includes(day))
      && timesOverlap(left.startTime, left.endTime, right.startTime, right.endTime);
  }

  const recurring = left.mode === "recurring" ? left : right.mode === "recurring" ? right : null;
  const specific = left.mode === "specific" ? left : right.mode === "specific" ? right : null;
  if (recurring && specific) {
    return specific.specificSlots.some((slot) =>
      slot.date >= recurring.startDate
      && slot.date <= recurring.endDate
      && recurring.weekdays.includes(weekday(slot.date))
      && timesOverlap(recurring.startTime, recurring.endTime, slot.startTime, slot.endTime),
    );
  }

  return left.specificSlots.some((slot) => right.specificSlots.some((other) => specificSlotsOverlap(slot, other)));
}

export function withoutOverlappingAvailabilityRules(rules: InterviewAvailabilityRule[]) {
  return rules.reduce<InterviewAvailabilityRule[]>((accepted, rule) => {
    if (rule.status === "Active" && accepted.some((existing) => availabilityRulesOverlap(existing, rule))) return accepted;
    accepted.push(rule);
    return accepted;
  }, []);
}

/**
 * Availability is only useful on or before the role's target hiring date. Keep
 * this rule in the shared slot generator so the admin calendar and candidate
 * link always expose the same dates, including the target date itself.
 */
export function isBeforeTargetHiringDate(date: string, targetHiringDate?: string) {
  return !DATE.test(text(targetHiringDate)) || date <= text(targetHiringDate);
}

/** A role is overdue only after its target date has fully passed in its schedule timezone. */
export function isTargetHiringDateOverdue(targetHiringDate?: string, timezone = "Asia/Singapore", now = new Date()) {
  const target = text(targetHiringDate);
  return DATE.test(target) && todayInTimezone(validTimezone(timezone), now) > target;
}

export function ruleToSlots(rule: InterviewAvailabilityRule, maxDays = 180): VoiceInterviewSlot[] {
  if (rule.status !== "Active") return [];
  if (rule.mode === "specific") {
    return rule.specificSlots.filter((slot) => isCurrentCalendarMonth(slot.date, slot.timezone));
  }
  // AI voice interviews use one consistent weekday window so every role has
  // predictable ten-minute times and the candidate calendar stays simple.
  const isVoiceInterview = rule.interviewType === "AI Voice Interview";
  const isFinalInterview = rule.interviewType === "Final Interview";
  const duration = isVoiceInterview ? 10 : isFinalInterview ? 60 : Number.isInteger(rule.slotDurationMinutes) && rule.slotDurationMinutes >= 5 ? rule.slotDurationMinutes : 30;
  // Voice screening is available 09:00–17:00 in ten-minute slots. HR
  // interviews use 10:00–16:00 one-hour slots, with 12:00–13:00 reserved for
  // lunch. Keep these windows centralized so every role follows the same
  // booking policy, including legacy rules.
  const startTime = isVoiceInterview ? 9 * 60 : isFinalInterview ? 10 * 60 : minutes(rule.startTime);
  const endTime = isVoiceInterview ? 17 * 60 : isFinalInterview ? 16 * 60 : minutes(rule.endTime);
  // HR interviews are weekday-only even when an older saved rule contains
  // weekend values; the shared calendar must never offer Saturday/Sunday slots.
  const weekdays = isVoiceInterview || isFinalInterview ? [1, 2, 3, 4, 5] : rule.weekdays;
  const result: VoiceInterviewSlot[] = [];
  const end = addDays(rule.startDate, Math.min(maxDays, 180));
  const monthLimited = isVoiceInterview || isFinalInterview;
  const today = monthLimited ? todayInTimezone(rule.timezone) : "";
  const firstDate = monthLimited && today > rule.startDate ? monthStart(today) : rule.startDate;
  const monthLimit = monthLimited ? monthEnd(today) : "9999-12-31";
  const lastDate = [rule.endDate, end, monthLimit].sort()[0];
  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
    if (!weekdays.includes(weekday(date))) continue;
    for (let start = startTime; start + duration <= endTime; start += duration) {
      if (isFinalInterview && start === 12 * 60) continue;
      result.push({ date, startTime: time(start), endTime: time(start + duration), timezone: rule.timezone });
    }
  }
  return result;
}

export function roleAvailabilityRules(
  role: { roleId: string; targetHiringDate?: string; voiceInterviewAvailabilityMode?: string; voiceInterviewSlots?: string; voiceInterviewAutoStartDate?: string; voiceInterviewAutoEndDate?: string; voiceInterviewTimezone?: string; interviewAvailabilityRules?: string },
  // The AI voice interview is a phone call to the candidate, so its slot times
  // are shown in the candidate's own timezone when one is supplied. The
  // face-to-face interview always stays in the office timezone below.
  voiceTimezoneOverride?: string,
): InterviewAvailabilityRule[] {
  const voiceTimezone = voiceTimezoneOverride && validTimezone(voiceTimezoneOverride) === voiceTimezoneOverride
    ? voiceTimezoneOverride
    : "";
  // Final-interview availability is derived from the connected HR Google
  // Calendar. Ignore legacy manually saved final rules.
  const stored = parseAvailabilityRules(role.interviewAvailabilityRules).filter((rule) => rule.interviewType !== "Final Interview");
  // New writes are rejected by the API. This defensive pass also prevents
  // existing workbook data from multiplying generated candidate slots.
  const rules = withoutOverlappingAvailabilityRules(stored);
  const hasVoiceRule = rules.some((rule) => rule.interviewType === "AI Voice Interview");
  if (!hasVoiceRule) {
    // Legacy roles without a stored rule inherit the standard voice schedule.
    const timezone = voiceTimezone || validTimezone(text(role.voiceInterviewTimezone) || "Asia/Singapore");
    const today = todayInTimezone(timezone);
    const configuredStart = DATE.test(role.voiceInterviewAutoStartDate || "") ? role.voiceInterviewAutoStartDate || today : today;
    const startDate = configuredStart > today ? configuredStart : today;
    const configuredEnd = DATE.test(role.voiceInterviewAutoEndDate || "") ? role.voiceInterviewAutoEndDate || "" : "";
    const endDate = configuredEnd >= startDate ? configuredEnd : monthEnd(today);
    rules.push({ ruleId: `DEFAULT-VOICE-${role.roleId}`, roleId: role.roleId, interviewType: "AI Voice Interview", mode: "recurring", startDate, endDate, weekdays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", slotDurationMinutes: 10, timezone, specificSlots: [], status: "Active" });
  }
  const finalTimezone = "Asia/Singapore";
  const today = todayInTimezone(finalTimezone);
  // Existing roles receive a full current-month HR interview schedule while
  // targetHiringDate still limits candidate-visible slots to the hiring plan.
  rules.push({ ruleId: `CALENDAR-FINAL-${role.roleId}`, roleId: role.roleId, interviewType: "Final Interview", mode: "recurring", startDate: monthStart(today), endDate: monthEnd(today), weekdays: [1, 2, 3, 4, 5], startTime: "10:00", endTime: "16:00", slotDurationMinutes: 60, timezone: finalTimezone, specificSlots: [], status: "Active" });
  // Only the AI voice interview follows the candidate's timezone.
  if (voiceTimezone) {
    for (const rule of rules) {
      if (rule.interviewType === "AI Voice Interview") rule.timezone = voiceTimezone;
    }
  }
  return rules;
}

export function virtualSlotsForRole(role: Parameters<typeof roleAvailabilityRules>[0], interviewType: "AI Voice Interview" | "Final Interview", respectTargetHiringDate = true, voiceTimezoneOverride?: string) {
  const slots = roleAvailabilityRules(role, voiceTimezoneOverride).filter((rule) => rule.interviewType === interviewType).flatMap((rule) => ruleToSlots(rule).filter((slot) => !respectTargetHiringDate || isBeforeTargetHiringDate(slot.date, role.targetHiringDate)).map((slot) => ({
    slotId: `VIRTUAL-${hash(`${rule.ruleId}|${slot.date}|${slot.startTime}|${slot.endTime}|${slot.timezone}`).toUpperCase()}`,
    interviewType,
    roleId: role.roleId,
    ...slot,
    status: "Available" as const,
  })));
  return [...new Map(slots.map((slot) => [slotKey(slot), slot])).values()];
}

export function isVirtualSlotId(slotId: string) { return slotId.startsWith("VIRTUAL-"); }
export function slotKey(slot: { interviewType: string; roleId: string; date: string; startTime: string; endTime?: string; timezone?: string }) { return `${slot.interviewType}|${slot.roleId}|${slot.date}|${slot.startTime}|${slot.endTime || ""}|${slot.timezone || ""}`.toLowerCase(); }
export function isStandardVoiceInterviewSlot(slot: { interviewType: string; date?: string; startTime: string; endTime: string }) {
  if (!slot.interviewType.toLowerCase().includes("voice")) return true;
  const start = minutes(slot.startTime);
  const end = minutes(slot.endTime);
  // The August 20 client-demo schedule was explicitly extended through
  // midnight. Keep this exception date-scoped so every later day continues
  // to use the standard 09:00-17:00 voice-interview window.
  const latestEnd = slot.date === "2026-08-20" ? 24 * 60 : 17 * 60;
  return start >= 9 * 60 && end <= latestEnd && end - start === 10;
}
export function isStandardFinalInterviewSlot(slot: { interviewType: string; startTime: string; endTime: string }) {
  if (!slot.interviewType.toLowerCase().includes("final")) return true;
  const start = minutes(slot.startTime);
  const end = minutes(slot.endTime);
  return start >= 10 * 60 && end <= 16 * 60 && end - start === 60 && !(start < 13 * 60 && end > 12 * 60);
}
export function hasValidFutureTime(slot: { date: string; startTime: string; timezone: string }) { try { return scheduledInstant(slot.date, slot.startTime, slot.timezone || "Asia/Singapore").getTime() > Date.now(); } catch { return false; } }
