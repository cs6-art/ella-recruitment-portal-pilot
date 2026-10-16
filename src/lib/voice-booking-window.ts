import { scheduledInstant } from "./interview-time.ts";

/** A voice booking link is bookable for exactly 48 hours after it was sent. */
export const VOICE_BOOKING_WINDOW_HOURS = 48;
const VOICE_BOOKING_WINDOW_MS = VOICE_BOOKING_WINDOW_HOURS * 60 * 60 * 1000;
export function voiceBookingExpiresAt(sentAt: Date = new Date()) { return new Date(sentAt.getTime() + VOICE_BOOKING_WINDOW_MS); }
/** Whether a slot starts within the 48 hours after the link was sent. */
export function isWithinVoiceBookingWindow(slot: { date: string; startTime: string; timezone: string }, sentAt: Date | string | null | undefined) {
  if (!sentAt) return true;
  const sent = sentAt instanceof Date ? sentAt.getTime() : Date.parse(sentAt);
  if (!Number.isFinite(sent)) return true;
  try { return scheduledInstant(slot.date, slot.startTime, slot.timezone || "Asia/Singapore").getTime() <= sent + VOICE_BOOKING_WINDOW_MS; } catch { return false; }
}
