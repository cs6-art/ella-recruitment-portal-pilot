import { z } from "zod";

export const voiceInterviewSlotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Select a valid voice interview date."),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Select a valid voice interview start time."),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Select a valid voice interview end time."),
  timezone: z.string().trim().min(1, "Select a voice interview timezone.").max(100),
}).refine((slot) => slot.startTime < slot.endTime, "Voice interview start time must be before the end time.");

export type VoiceInterviewSlot = z.infer<typeof voiceInterviewSlotSchema>;
export type VoiceInterviewAvailabilityMode = "none" | "manual" | "automatic";

export function parseVoiceInterviewSlots(value: unknown): VoiceInterviewSlot[] {
  let candidate = value;
  if (typeof value === "string") {
    if (!value.trim()) return [];
    try { candidate = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(candidate)) return [];
  return candidate
    .map((slot) => voiceInterviewSlotSchema.safeParse(slot))
    .filter((result): result is { success: true; data: VoiceInterviewSlot } => result.success)
    .map((result) => result.data)
    .slice(0, 100);
}

export function serializeVoiceInterviewSlots(value: unknown): string {
  return JSON.stringify(parseVoiceInterviewSlots(value));
}

function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function dateValue(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function addDays(value: string, days: number) {
  const parts = dateParts(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return dateValue(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function weekday(value: string) {
  const parts = dateParts(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_END_MINUTES = 24 * 60;

function minutesToTime(value: number) {
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

export function generateAutomaticVoiceInterviewSlots({ startDate, endDate, timezone, durationMinutes = 10 }: { startDate: string; endDate: string; timezone: string; durationMinutes?: number }): VoiceInterviewSlot[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    throw new Error("Choose a valid automatic voice interview date range.");
  }
  if (addDays(startDate, 90) < endDate) throw new Error("Automatic voice availability can cover up to 90 days.");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 240) throw new Error("Voice interview duration must be between 5 and 240 minutes.");
  const slots: VoiceInterviewSlot[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    if (!ALL_DAYS.includes(weekday(date))) continue;
    // Keep every generated end time within the same calendar date. A slot
    // ending at 24:00 becomes the next date when persisted as a timestamp,
    // which makes the slot ambiguous when it is read back from storage.
    for (let start = 0; start + durationMinutes < DAY_END_MINUTES; start += durationMinutes) {
      slots.push({ date, startTime: minutesToTime(start), endTime: minutesToTime(start + durationMinutes), timezone });
    }
  }
  return slots;
}
