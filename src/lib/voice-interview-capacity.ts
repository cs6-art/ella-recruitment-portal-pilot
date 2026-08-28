/** Vapi can conduct at most ten voice interviews at the same time. */
export const MAX_CONCURRENT_VOICE_INTERVIEWS = 10;

export type VoiceInterviewCapacitySlot = {
  date: string;
  startTime: string;
  endTime: string;
  timezone?: string;
};

export type VoiceInterviewCapacityRow = VoiceInterviewCapacitySlot & {
  interviewType?: string;
  status?: string;
};

function text(value: unknown) { return String(value ?? "").trim(); }

function scheduledInstant(date: string, time: string, timezone: string) {
  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  const normalizedTime = timeMatch
    ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}:${timeMatch[3] || "00"}`
    : time;
  const parsed = new Date(`${date}T${normalizedTime}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid interview date or time.");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(parsed);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const shown = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
  const desired = Date.parse(`${date}T${normalizedTime}Z`);
  return new Date(desired - (shown - desired));
}

/**
 * Use the UTC interval so the same instant is counted together even when two
 * roles store their local time in different timezones.
 */
export function voiceInterviewConcurrencyKey(slot: VoiceInterviewCapacitySlot) {
  const timezone = text(slot.timezone) || "Asia/Singapore";
  try {
    const start = scheduledInstant(text(slot.date), text(slot.startTime), timezone).toISOString();
    const end = scheduledInstant(text(slot.date), text(slot.endTime), timezone).toISOString();
    return `${start}|${end}`;
  } catch {
    return `${text(slot.date)}|${text(slot.startTime)}|${text(slot.endTime)}|${timezone}`.toLowerCase();
  }
}

export function isActiveVoiceInterviewStatus(value: unknown) {
  // "retry scheduled" is a still-live booking awaiting a further AI call
  // attempt, so it keeps holding one of the concurrent-call slots.
  return ["booked", "scheduled", "queued", "calling", "initiated", "in progress", "retry scheduled"].includes(text(value).toLowerCase());
}

export function countActiveVoiceInterviews(rows: VoiceInterviewCapacityRow[], slot: VoiceInterviewCapacitySlot) {
  const key = voiceInterviewConcurrencyKey(slot);
  return rows.filter((row) =>
    text(row.interviewType).toLowerCase().includes("voice")
    && isActiveVoiceInterviewStatus(row.status)
    && voiceInterviewConcurrencyKey(row) === key,
  ).length;
}

export function canAcceptVoiceInterview(rows: VoiceInterviewCapacityRow[], slot: VoiceInterviewCapacitySlot) {
  return countActiveVoiceInterviews(rows, slot) < MAX_CONCURRENT_VOICE_INTERVIEWS;
}

function stableHash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16).padStart(8, "0");
}

/** A stable placeholder id lets a candidate select a full-but-not-yet-full time. */
export function voiceCapacitySlotId(slot: VoiceInterviewCapacitySlot) {
  return `VOICE-CAPACITY-${stableHash(voiceInterviewConcurrencyKey(slot)).toUpperCase()}`;
}
