"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { useConfirmation } from "@/components/ConfirmationModal";
import InfoTip from "@/components/InfoTip";
import Pagination from "@/components/Pagination";
import UiIcon from "@/components/UiIcon";
import type { InterviewBooking } from "@/lib/candidate-applications";
import type { RoleRequestSummary } from "@/lib/google-sheets";
import { scheduledInstant } from "@/lib/interview-time";
import { isBeforeTargetHiringDate, isCurrentCalendarMonth, isStandardFinalInterviewSlot, isStandardVoiceInterviewSlot, isTargetHiringDateOverdue, roleAvailabilityRules, slotKey, virtualSlotsForRole } from "@/lib/interview-availability-rules";
import { formatPortalDateKey, PORTAL_TIME_ZONE } from "@/lib/portal-time";

type BookingKind = "voice" | "final";
type InterviewType = "AI Voice Interview" | "Final Interview";
type CalendarInterviewBooking = InterviewBooking & { targetHiringDate?: string; targetHiringDateOverdue?: boolean };
type BookingRole = Pick<RoleRequestSummary, "roleId" | "jobTitle" | "targetHiringDate" | "hodEmail" | "voiceInterviewAvailabilityMode" | "voiceInterviewSlots" | "voiceInterviewAutoStartDate" | "voiceInterviewAutoEndDate" | "voiceInterviewTimezone" | "interviewAvailabilityRules"> & { finalBusyWindows?: string; finalCalendarConnected?: boolean; hasActiveVoiceBookingLink?: boolean; hasActiveFinalBookingLink?: boolean };
type RuleForm = { interviewType: InterviewType; roleId: string; mode: "recurring" | "specific"; startDate: string; endDate: string; weekdays: number[]; startTime: string; endTime: string; duration: string; timezone: string; specificDate: string; date: string };

const weekdayOptions = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const initialRuleForm: RuleForm = { interviewType: "Final Interview", roleId: "", mode: "specific", startDate: "", endDate: "", weekdays: [1, 2, 3, 4, 5], startTime: "10:00", endTime: "11:00", duration: "60", timezone: "Asia/Singapore", specificDate: "", date: "" };

function dateKey(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : formatPortalDateKey(value); }
function dateLabel(value: string) { const key = dateKey(value); const parsed = new Date(`${key}T00:00:00`); return Number.isNaN(parsed.getTime()) ? value || "Not provided" : new Intl.DateTimeFormat(undefined, { timeZone: PORTAL_TIME_ZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(parsed); }
function todayInputValue() { return formatPortalDateKey(new Date()); }
// Keep the workbook's legacy "Booked" value for integrations, but present it
// as "Scheduled" in the HR UI so appointment state is distinct from outcome.
function statusLabel(value: string) { return value.trim().toLowerCase() === "booked" ? "Scheduled" : value; }
function statusClass(value: string) { return `booking-status booking-status-${statusLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`; }
function monthLabel(value: Date) { return new Intl.DateTimeFormat(undefined, { timeZone: PORTAL_TIME_ZONE, month: "long", year: "numeric" }).format(value); }
function calendarDays(month: Date) { const first = new Date(month.getFullYear(), month.getMonth(), 1); const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); return [...Array.from({ length: first.getDay() }, () => null), ...Array.from({ length: count }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1))]; }
function hasStarted(booking: InterviewBooking) { try { return scheduledInstant(booking.date, booking.startTime || "00:00", booking.timezone || "Asia/Singapore").getTime() <= Date.now(); } catch { return false; } }
function titleFor(kind: BookingKind) { return kind === "voice" ? "AI Voice Interview" : "Face-to-Face Interview"; }
function displayInterviewType(value: string) { return value.toLowerCase().includes("final") ? "Face-to-Face Interview" : value; }
// Keep the calendar heading aligned with the HR-facing interview terminology;
// the workbook still uses legacy “Final Interview” values internally.
function calendarHeading(kind: BookingKind) { return kind === "voice" ? "AI Voice Interview Calendar" : "Face-to-Face Interview Calendar"; }

function busyWindowsForRole(role: BookingRole) {
  try { return JSON.parse(role.finalBusyWindows || "[]") as Array<{ start: string; end: string }>; } catch { return []; }
}
function overlapsBusyWindow(slot: Pick<InterviewBooking, "date" | "startTime" | "endTime" | "timezone">, windows: Array<{ start: string; end: string }>) {
  try {
    const start = scheduledInstant(slot.date, slot.startTime, slot.timezone || "Asia/Singapore").getTime();
    const end = scheduledInstant(slot.date, slot.endTime, slot.timezone || "Asia/Singapore").getTime();
    return windows.some((window) => Date.parse(window.start) < end && Date.parse(window.end) > start);
  } catch { return false; }
}
function virtualBookings(role: BookingRole): CalendarInterviewBooking[] {
  const source = role;
  const busyWindows = busyWindowsForRole(role);
  // Display the HR calendar's recurring windows to authorized viewers even
  // when the busy lookup is unavailable; reservation still verifies the
  // connected calendar authoritatively before booking.
  return (["AI Voice Interview", "Final Interview"] as InterviewType[]).flatMap((interviewType) => {
    const targetHiringDateOverdue = isTargetHiringDateOverdue(role.targetHiringDate, role.voiceInterviewTimezone || "Asia/Singapore");
    // Keep expired roles lightweight: one expired marker carries the overdue
    // state to the calendar without materializing hundreds of unusable slots.
    const slots = [...virtualSlotsForRole(source, interviewType), ...(targetHiringDateOverdue ? virtualSlotsForRole(source, interviewType, false).slice(0, 1) : [])];
    return slots.map((slot) => {
    const blocked = interviewType === "Final Interview" && overlapsBusyWindow(slot, busyWindows);
    return { ...slot, status: blocked ? "Blocked" : "Available", applicationId: "", candidateName: "", candidateEmail: "", bookedAt: "", lastUpdated: "", calendarEventId: "", calendarEventLink: "", calendarEventStatus: blocked ? "Conflict" : "", calendarEventError: blocked ? "HR Google Calendar conflict" : "", targetHiringDate: role.targetHiringDate, targetHiringDateOverdue };
    });
  });
}
function hasActiveBookingLink(role: BookingRole, interviewType: string) {
  return interviewType.toLowerCase().includes("voice") ? role.hasActiveVoiceBookingLink === true : role.hasActiveFinalBookingLink === true;
}
function candidateVisibleAvailability(booking: InterviewBooking, role: BookingRole | undefined) {
  const status = booking.status.toLowerCase();
  if (!role) return status !== "available" && status !== "blocked";
  return status !== "available" && status !== "blocked" || hasActiveBookingLink(role, booking.interviewType);
}
function summarizeBookings(bookings: InterviewBooking[]) { const summary = { available: 0, booked: 0, blocked: 0, expired: 0, completed: 0, cancelled: 0, noShow: 0 }; bookings.forEach((booking) => { const normalized = booking.status.toLowerCase().replace(/\s+/g, ""); const status = (normalized === "noshow" ? "noShow" : normalized) as keyof typeof summary; if (status in summary) summary[status] += 1; }); return summary; }
function activeWindowCount(roles: BookingRole[]) {
  const windows = new Set<string>();
  roles.forEach((role) => {
    const rules = roleAvailabilityRules(role);
    rules.filter((rule) => rule.status === "Active").forEach((rule) => {
      if (rule.mode === "recurring") windows.add(`${role.roleId}|${rule.interviewType}|${rule.ruleId}`);
      else rule.specificSlots.forEach((slot) => windows.add(`${role.roleId}|${rule.interviewType}|${slot.date}|${slot.startTime}|${slot.endTime}|${slot.timezone}`));
    });
  });
  return windows.size;
}
function calendarDisplayBookings(bookings: InterviewBooking[]) {
  return bookings.filter((booking) => {
    const status = booking.status.toLowerCase().replace(/\s+/g, " ");
    if (hasStarted(booking)) return ["booked", "completed", "no show", "cancelled"].includes(status);
    return ["available", "booked", "blocked", "completed", "no show", "cancelled"].includes(status);
  });
}

function CalendarPanel({ kind, month, bookings, selectedDate, selectedKind, targetHiringDate, targetHiringDateOverdue, onSelectDate }: { kind: BookingKind; month: Date; bookings: InterviewBooking[]; selectedDate: string; selectedKind: BookingKind | ""; targetHiringDate?: string; targetHiringDateOverdue?: boolean; onSelectDate: (date: string, kind: BookingKind) => void }) {
  const days = calendarDays(month);
  const byDate = bookings.reduce<Map<string, InterviewBooking[]>>((map, booking) => {
    const key = dateKey(booking.date);
    map.set(key, [...(map.get(key) || []), booking]);
    return map;
  }, new Map());
  const title = titleFor(kind);
  const stats = summarizeBookings(bookings);
  const overdueBooking = bookings.find((booking) => "targetHiringDateOverdue" in booking) as CalendarInterviewBooking | undefined;
  const effectiveTargetHiringDate = targetHiringDate || overdueBooking?.targetHiringDate;
  const effectiveTargetHiringDateOverdue = targetHiringDateOverdue ?? overdueBooking?.targetHiringDateOverdue ?? false;
  const note = kind === "voice"
    ? "Future dates show available times. Past dates show only booked and no-show outcomes."
    : "Future dates show availability and calendar conflicts. Past dates show only booked and no-show outcomes.";

  return <section className={`card booking-calendar-card booking-calendar-${kind} ${effectiveTargetHiringDateOverdue ? "is-target-overdue" : ""}`}>
    <div className="calendar-panel-heading">
      <div>
        <span className="calendar-panel-kicker">{kind === "voice" ? "VOICE SCREENING" : "HR INTERVIEW"}</span>
        <div className="calendar-panel-title">
          <h2>{calendarHeading(kind)}</h2>
          <InfoTip label={`About the ${title} calendar`}>{kind === "final" ? "Availability comes from the connected HR Google Calendar." : "HR manages voice-interview availability rules."} Select a date to see available times and booking status.</InfoTip>
        </div>
        <p>Dates are summarized so the calendar stays easy to scan.</p>
        {effectiveTargetHiringDateOverdue && <span className="calendar-target-status is-overdue" role="status">Target hiring date overdue</span>}
        <span className="calendar-availability-note"><span aria-hidden="true" /> {note}</span>
        <div className="calendar-legend" aria-label={`${title} calendar legend`}>
          <span><i className="calendar-legend-dot is-available" aria-hidden="true" />Available</span>
          <span><i className="calendar-legend-dot is-booked" aria-hidden="true" />Scheduled</span>
          <span><i className="calendar-legend-dot is-completed" aria-hidden="true" />Completed</span>
          <span><i className="calendar-legend-dot is-no-show" aria-hidden="true" />No Show</span>
          <span><i className="calendar-legend-dot is-cancelled" aria-hidden="true" />Cancelled</span>
          {kind === "final" && <span><i className="calendar-legend-dot is-blocked" aria-hidden="true" />Blocked by Google Calendar</span>}
        </div>
      </div>
      <div className="calendar-panel-counts">
        <span><UiIcon name="clock" size={13} /><b>{stats.available}</b> Available slots</span>
          <span><UiIcon name="check" size={13} /><b>{stats.booked}</b> Scheduled</span>
          {stats.completed > 0 && <span><UiIcon name="check" size={13} /><b>{stats.completed}</b> Completed</span>}
          {stats.blocked > 0 && <span><UiIcon name="close" size={13} /><b>{stats.blocked}</b> Blocked</span>}
          {stats.noShow > 0 && <span><UiIcon name="close" size={13} /><b>{stats.noShow}</b> No Show</span>}
          {stats.cancelled > 0 && <span><UiIcon name="close" size={13} /><b>{stats.cancelled}</b> Cancelled</span>}
      </div>
    </div>
    <div className="booking-calendar-weekdays">{weekdayOptions.map((day) => <span key={day}>{day}</span>)}</div>
    <div className="booking-calendar-grid">
      {days.map((day, index) => {
          const key = day ? formatPortalDateKey(day) : `empty-${index}`;
        const events = day ? byDate.get(key) || [] : [];
        const displayEvents = calendarDisplayBookings(events);
        const dayStats = summarizeBookings(displayEvents);
        const isToday = key === todayInputValue();
        const isSelected = selectedKind === kind && selectedDate === key;
        return <div className={`booking-calendar-day booking-calendar-summary-day ${!day ? "is-empty" : ""} ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""}`} key={key}>
          {day && <button type="button" className="calendar-day-button" aria-label={`View ${title} details for ${dateLabel(key)}`} aria-pressed={isSelected} onClick={() => onSelectDate(key, kind)}>
            <strong className="calendar-day-number">{day.getDate()}</strong>
            {displayEvents.length > 0 ? <div className="calendar-day-summary">
              {dayStats.available > 0 && <span className="summary-available">{dayStats.available} available</span>}
              {dayStats.booked > 0 && <span className="summary-booked">{dayStats.booked} scheduled</span>}
              {dayStats.completed > 0 && <span className="summary-completed">{dayStats.completed} completed</span>}
              {dayStats.blocked > 0 && <span className="summary-blocked">{dayStats.blocked} blocked</span>}
              {dayStats.noShow > 0 && <span className="summary-no-show">{dayStats.noShow} no show</span>}
              {dayStats.cancelled > 0 && <span className="summary-cancelled">{dayStats.cancelled} cancelled</span>}
            </div> : <small className="calendar-day-empty-label">No schedule</small>}
          </button>}
        </div>;
      })}
    </div>
    {effectiveTargetHiringDateOverdue && <div className="calendar-overdue-overlay" role="status" aria-live="polite"><strong>Target hiring date overdue</strong><span>Update the target hiring date to reopen interview availability.</span>{effectiveTargetHiringDate && <small>Target date: {dateLabel(effectiveTargetHiringDate)}</small>}</div>}
  </section>;
}

function NoShowAction({ booking, onUpdated }: { booking: InterviewBooking; onUpdated: (slotId: string) => void }) { const { confirm } = useConfirmation(); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); async function submit() { if (!(await confirm({ title: "Mark interview as No Show?", message: "This scheduled interview will be recorded as No Show.", confirmLabel: "Mark No Show", tone: "danger" }))) return; setSaving(true); setError(""); try { const response = await fetch(`/api/bookings/${encodeURIComponent(booking.slotId)}/status`, { method: "POST" }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || "Unable to mark interview as No Show."); onUpdated(booking.slotId); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update status."); } finally { setSaving(false); } } return <div className="booking-no-show-action"><button type="button" className="booking-inline-action" disabled={saving} onClick={() => void submit()}>{saving ? "Saving..." : "Mark No Show"}</button>{error && <ActionFeedback kind="error">{error}</ActionFeedback>}</div>; }

function DateDetails({ date, kind, bookings, onClose, onUpdated }: { date: string; kind: BookingKind; bookings: InterviewBooking[]; onClose: () => void; onUpdated: (slotId: string) => void }) { const stats = summarizeBookings(bookings); return <div className="booking-modal-backdrop" role="presentation" onClick={onClose}><section className="booking-modal booking-date-detail-modal" role="dialog" aria-modal="true" aria-labelledby="selected-booking-title" onClick={(event) => event.stopPropagation()}><div className="selected-booking-header"><div><span className="calendar-panel-kicker">{titleFor(kind).toUpperCase()} · DATE DETAILS</span><h2 id="selected-booking-title">{dateLabel(date)}</h2><p>{stats.available} available · {stats.booked} scheduled{stats.completed > 0 ? ` · ${stats.completed} completed` : ""} · {stats.blocked} blocked{stats.noShow > 0 ? ` · ${stats.noShow} no show` : ""}{stats.cancelled > 0 ? ` · ${stats.cancelled} cancelled` : ""}{stats.expired > 0 ? ` · ${stats.expired} expired` : ""}</p></div><button type="button" className="booking-modal-close" aria-label="Close date details" onClick={onClose}><UiIcon name="close" size={19} /></button></div>{bookings.length === 0 ? <div className="selected-booking-empty"><UiIcon name="calendar" size={22} /><span>No availability is configured for this date.</span></div> : <div className="selected-booking-list">{bookings.slice().sort((a, b) => a.startTime.localeCompare(b.startTime)).map((booking) => { const bookingStatus = booking.status.toLowerCase(); const itemState = bookingStatus === "booked" ? "is-booked" : bookingStatus === "completed" ? "is-completed" : bookingStatus === "no show" ? "is-no-show" : bookingStatus === "cancelled" ? "is-cancelled" : "is-available"; return <article className={`selected-booking-item ${itemState}`} key={booking.slotId}><div className="selected-booking-main"><div className="selected-booking-title"><strong>{booking.startTime}–{booking.endTime}</strong><span className={statusClass(booking.status)}>{statusLabel(booking.status)}</span></div><p>{booking.roleId || "Role"} · {booking.timezone || "Timezone not provided"}</p>{booking.candidateName ? <div className="selected-booking-meta"><span><UiIcon name="profile" size={14} />{booking.candidateName}</span>{booking.candidateEmail && <span>{booking.candidateEmail}</span>}</div> : <span className="booking-unassigned">Open for candidate booking</span>}{booking.applicationId && <Link className="selected-booking-link" href={`/applicants/${encodeURIComponent(booking.applicationId)}`} onClick={onClose}>View Applicant Details</Link>}{bookingStatus === "booked" && booking.applicationId && hasStarted(booking) && <NoShowAction booking={booking} onUpdated={onUpdated} />}</div></article>; })}</div>}</section></div>; }

function AvailabilityDrawer({ roles, form, setForm, saving, error, onClose, onSave }: { roles: BookingRole[]; form: RuleForm; setForm: React.Dispatch<React.SetStateAction<RuleForm>>; saving: boolean; error: string; onClose: () => void; onSave: () => void }) {
  const selectedRole = roles.find((role) => role.roleId === form.roleId);
  return <div className="booking-drawer-backdrop" role="presentation" onClick={onClose}><aside className="booking-drawer" role="dialog" aria-modal="true" aria-labelledby="availability-drawer-title" onClick={(event) => event.stopPropagation()}><div className="booking-drawer-header"><div><span className="eyebrow-dark">INTERVIEW SCHEDULING</span><h2 id="availability-drawer-title">Set HR / face-to-face interview</h2><p>Choose one future time. The shared HR Google Calendar is checked before the slot is saved.</p></div><button type="button" className="booking-modal-close" aria-label="Close HR interview scheduling" onClick={onClose}><UiIcon name="close" size={19} /></button></div><div className="booking-drawer-body"><label>Approved role<select required value={form.roleId} onChange={(event) => setForm((current) => ({ ...current, roleId: event.target.value }))}><option value="">Select an approved role</option>{roles.map((role) => <option key={role.roleId} value={role.roleId}>{role.jobTitle ? `${role.jobTitle} (${role.roleId})` : role.roleId}</option>)}</select></label><div className="schedule-time-row"><label className="schedule-time-field">Date<input required type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></label><label className="schedule-time-field">Start<input required type="time" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} /></label><label className="schedule-time-field">End<input required type="time" value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} /></label></div><label>Timezone<select value={form.timezone} onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))}><option value="Asia/Singapore">Asia/Singapore</option><option value="Asia/Manila">Asia/Manila</option><option value="Asia/Kuala_Lumpur">Asia/Kuala Lumpur</option></select></label>{selectedRole && <div className="availability-preview"><strong>Google Calendar source</strong><span>{selectedRole.finalCalendarConnected === true ? "Connected. The selected time will be checked for conflicts." : "Connection not verified. Connect HR's calendar before saving."}</span></div>}{error && <ActionFeedback kind="error">{error}</ActionFeedback>}</div><div className="booking-drawer-footer"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Close</button><button type="button" className="btn btn-primary" disabled={saving || !selectedRole || !form.date || !form.startTime || !form.endTime} onClick={onSave}>{saving ? "Saving..." : "Save HR interview slot"}</button></div></aside></div>;
}

export default function BookingsList({ bookings: initialBookings, roles }: { bookings: InterviewBooking[]; roles: BookingRole[] }) {
  const router = useRouter();
  const [bookings, setBookings] = useState(initialBookings); const [calendarBusyWindows, setCalendarBusyWindows] = useState<Record<string, Array<{ start: string; end: string }>>>({}); const [calendarConnected, setCalendarConnected] = useState<Record<string, boolean>>({}); const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1)); const [selectedDate, setSelectedDate] = useState(""); const [selectedKind, setSelectedKind] = useState<BookingKind | "">(""); const [calendarRole, setCalendarRole] = useState("All Roles"); const [calendarType, setCalendarType] = useState<"All Types" | BookingKind>("All Types"); const [showAvailability, setShowAvailability] = useState(false); const [form, setForm] = useState<RuleForm>(initialRuleForm); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [search, setSearch] = useState(""); const [status, setStatus] = useState("All Statuses"); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/bookings/calendar-busy", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { success?: boolean; busyWindows?: Record<string, Array<{ start: string; end: string }>>; calendarConnected?: Record<string, boolean> };
        if (!response.ok || data.success !== true) throw new Error("Unable to load calendar conflicts.");
        setCalendarBusyWindows(data.busyWindows || {});
        setCalendarConnected(data.calendarConnected || {});
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        console.warn("[Bookings] Calendar conflict lookup failed:", caught);
      });
    return () => controller.abort();
  }, []);
  const roleOptions = useMemo(() => roles
    .filter((role) => role.roleId.trim())
    .map((role) => ({ ...role, finalBusyWindows: JSON.stringify(calendarBusyWindows[role.roleId] || []), finalCalendarConnected: calendarConnected[role.roleId] === true }))
    .sort((a, b) => a.roleId.localeCompare(b.roleId)), [roles, calendarBusyWindows, calendarConnected]);
  const allBookings = useMemo(() => {
    const legacy = bookings
      .filter((booking) => booking.status.toLowerCase() !== "available" || (!booking.interviewType.toLowerCase().includes("voice") && !booking.interviewType.toLowerCase().includes("final")) || ((booking.interviewType.toLowerCase().includes("voice") ? isStandardVoiceInterviewSlot(booking) : isStandardFinalInterviewSlot(booking)) && isCurrentCalendarMonth(booking.date, booking.timezone || "Asia/Singapore")))
      .map((booking) => {
        const role = roleOptions.find((candidate) => candidate.roleId.toLowerCase() === booking.roleId.toLowerCase());
        const calendarUnavailable = booking.interviewType.toLowerCase().includes("final") && booking.status.toLowerCase() === "available" && role?.finalCalendarConnected !== true;
        if (calendarUnavailable) return { ...booking, status: "Blocked", calendarEventStatus: "Not Connected", calendarEventError: "HR Google Calendar is not connected" };
        const blocked = booking.interviewType.toLowerCase().includes("final") && booking.status.toLowerCase() === "available" && role && overlapsBusyWindow(booking, busyWindowsForRole(role));
        if (blocked) return { ...booking, status: "Blocked", calendarEventStatus: "Conflict", calendarEventError: "HR Google Calendar conflict" };
        if (booking.status.toLowerCase() === "available" && role && !isBeforeTargetHiringDate(booking.date, role.targetHiringDate)) return { ...booking, status: "Expired" };
        return booking.status.toLowerCase() === "available" && !hasFutureTime(booking) ? { ...booking, status: "Expired" } : booking;
      })
      .filter((booking) => candidateVisibleAvailability(booking, roleOptions.find((role) => role.roleId.toLowerCase() === booking.roleId.toLowerCase())));
    const existing = new Set(legacy.map((booking) => slotKey(booking)));
    // The HR calendar is the source of truth for role availability, so show
    // generated slots for every approved role even before its first candidate
    // booking link is issued.
    const generated = roleOptions
      .flatMap((role) => virtualBookings(role))
      .map((booking) => booking.status.toLowerCase() === "available" && (!hasFutureTime(booking) || !isBeforeTargetHiringDate(booking.date, (booking as CalendarInterviewBooking).targetHiringDate)) ? { ...booking, status: "Expired" } : booking);
    // The internal calendar must show generated HR windows even when a public
    // booking link has not been issued yet; the public workflow applies its
    // own booking-link visibility rules separately.
    return [...legacy, ...generated.filter((booking) => !existing.has(slotKey(booking)))].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  }, [bookings, roleOptions]);
  const calendarBookings = useMemo(() => allBookings.filter((booking) => (calendarRole === "All Roles" || booking.roleId.toLowerCase() === calendarRole.toLowerCase()) && (calendarType === "All Types" || (calendarType === "voice" ? booking.interviewType.toLowerCase().includes("voice") : booking.interviewType.toLowerCase().includes("final")))), [allBookings, calendarRole, calendarType]);
  const voiceBookings = calendarBookings.filter((booking) => booking.interviewType.toLowerCase().includes("voice")); const finalBookings = calendarBookings.filter((booking) => booking.interviewType.toLowerCase().includes("final")); const selectedBookings = selectedDate && selectedKind ? calendarDisplayBookings(calendarBookings).filter((booking) => dateKey(booking.date) === selectedDate && (selectedKind === "voice" ? booking.interviewType.toLowerCase().includes("voice") : booking.interviewType.toLowerCase().includes("final"))) : []; const selectedRole = roleOptions.find((role) => role.roleId === form.roleId); const stats = summarizeBookings(allBookings); const activeWindows = useMemo(() => activeWindowCount(roleOptions), [roleOptions]); const statuses = [...new Set(allBookings.map((booking) => statusLabel(booking.status)).filter(Boolean))].sort(); const filtered = allBookings.filter((booking) => { const query = search.trim().toLowerCase(); return (!query || `${booking.slotId} ${booking.applicationId} ${booking.candidateName} ${booking.candidateEmail} ${booking.roleId}`.toLowerCase().includes(query)) && (status === "All Statuses" || statusLabel(booking.status) === status); }); const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)); const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  async function saveAvailability() { if (!selectedRole) return; setSaving(true); setError(""); setMessage(""); try { const response = await fetch("/api/bookings/slots", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interviewType: "Final Interview", roleId: selectedRole.roleId, date: form.date, startTime: form.startTime, endTime: form.endTime, timezone: form.timezone }) }); const data = await response.json().catch(() => ({})); if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to create the HR interview slot."); setShowAvailability(false); setForm(initialRuleForm); setMessage("HR interview slot saved and checked against the shared Google Calendar."); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create the HR interview slot."); } finally { setSaving(false); } }
  function changeMonth(value: Date) { setMonth(value); setSelectedDate(""); setSelectedKind(""); }
  return <main className="container page bookings-page"><header className="hero-row bookings-header"><div><span className="eyebrow-dark">INTERVIEW OPERATIONS</span><h1>Interview Calendars</h1><p>Manage schedules as simple availability rules. Candidates see individual times only when they book.</p></div><div className="bookings-header-actions"><div className="bookings-header-meta"><strong>{stats.booked}</strong><span>Scheduled appointments</span></div><button type="button" className="btn btn-primary" onClick={() => { setShowAvailability(true); setError(""); }}>+ HR Availability</button></div></header>{message && <ActionFeedback kind="success" className="booking-page-message">{message}</ActionFeedback>}<div className="booking-monitor-stats"><article><span><UiIcon name="calendar" size={15} />Active time windows</span><strong>{activeWindows}</strong><small>Configured recurring and specific windows</small></article><article><span><UiIcon name="clock" size={15} />Available times</span><strong>{stats.available}</strong><small>Open for candidates</small></article><article><span><UiIcon name="check" size={15} />Scheduled appointments</span><strong>{stats.booked}</strong><small>Reserved voice and HR interviews</small></article><article><span><UiIcon name="check" size={15} />Completed interviews</span><strong>{stats.completed}</strong><small>Attendance/result received</small></article></div><section className="calendar-navigation"><div><span>MONTHLY SUMMARY</span><strong>{monthLabel(month)}</strong></div><div className="calendar-navigation-actions"><label className="calendar-role-filter"><span>Role</span><select aria-label="Filter calendar by role" value={calendarRole} onChange={(event) => { setCalendarRole(event.target.value); setSelectedDate(""); setSelectedKind(""); }}><option>All Roles</option>{roleOptions.map((role) => <option value={role.roleId} key={role.roleId}>{role.jobTitle ? `${role.jobTitle} (${role.roleId})` : role.roleId}</option>)}</select></label><label className="calendar-role-filter"><span>Interview type</span><select aria-label="Filter calendar by interview type" value={calendarType} onChange={(event) => { setCalendarType(event.target.value as "All Types" | BookingKind); setSelectedDate(""); setSelectedKind(""); }}><option>All Types</option><option value="voice">AI Voice Interview</option><option value="final">HR Interview</option></select></label><button type="button" className="btn btn-secondary" onClick={() => changeMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button><button type="button" className="calendar-arrow" aria-label="Previous month" onClick={() => changeMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><button type="button" className="calendar-arrow" aria-label="Next month" onClick={() => changeMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div></section><div className="booking-calendar-columns"><CalendarPanel kind="voice" month={month} bookings={voiceBookings} selectedDate={selectedDate} selectedKind={selectedKind} onSelectDate={(date, kind) => { setSelectedDate(date); setSelectedKind(kind); }} /><CalendarPanel kind="final" month={month} bookings={finalBookings} selectedDate={selectedDate} selectedKind={selectedKind} onSelectDate={(date, kind) => { setSelectedDate(date); setSelectedKind(kind); }} /></div>{!selectedDate && <div className="calendar-selection-hint"><UiIcon name="calendar" size={18} /><span>Select a date to view available times, bookings, and blocked conflicts.</span></div>}{selectedDate && selectedKind && <DateDetails date={selectedDate} kind={selectedKind} bookings={selectedBookings} onClose={() => { setSelectedDate(""); setSelectedKind(""); }} onUpdated={(slotId) => { setBookings((current) => current.map((booking) => booking.slotId === slotId ? { ...booking, status: "No Show" } : booking)); setSelectedDate(""); setSelectedKind(""); setMessage("Interview marked No Show."); }} />}<section className="card bookings-card"><div className="bookings-toolbar"><div><h2>Appointment records</h2><span>{filtered.length} matching record{filtered.length === 1 ? "" : "s"}</span></div><div className="bookings-filters"><input aria-label="Search bookings" placeholder="Search candidate, role, or slot" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /><select aria-label="Filter by booking status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option>All Statuses</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select><label className="pagination-size-control">Rows<select aria-label="Bookings per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="10">10</option><option value="25">25</option><option value="50">50</option></select></label></div></div>{visible.length === 0 ? <div className="empty">No records match the current filters.</div> : <div className="table-wrap"><table className="bookings-table"><thead><tr><th>Interview</th><th>Candidate</th><th>Role</th><th>Date &amp; Time</th><th>Status</th><th>Application</th></tr></thead><tbody>{visible.map((booking) => <tr key={booking.slotId}><td><strong>{displayInterviewType(booking.interviewType || "Interview")}</strong><span className="applicant-subtext">{booking.slotId}</span></td><td>{booking.applicationId ? <Link className="applicant-name-link" href={`/applicants/${encodeURIComponent(booking.applicationId)}`}><strong>{booking.candidateName || "Candidate"}</strong><span>{booking.candidateEmail || "Email Not Provided"}</span></Link> : <span className="booking-unassigned">Open availability</span>}</td><td><strong>{booking.roleId || "Role Not Provided"}</strong></td><td><strong>{dateLabel(booking.date)}</strong><span className="applicant-subtext">{booking.startTime}–{booking.endTime} {booking.timezone}</span></td><td><span className={statusClass(booking.status)}>{statusLabel(booking.status)}</span></td><td>{booking.applicationId ? <Link href={`/applicants/${encodeURIComponent(booking.applicationId)}`}>View Applicant</Link> : "—"}</td></tr>)}</tbody></table></div>}{filtered.length > 0 && <Pagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} />}</section>{showAvailability && <AvailabilityDrawer roles={roleOptions} form={form} setForm={setForm} saving={saving} error={error} onClose={() => { if (!saving) setShowAvailability(false); }} onSave={() => void saveAvailability()} />}</main>;
}

function hasFutureTime(booking: Pick<InterviewBooking, "date" | "startTime" | "timezone">) { try { return scheduledInstant(booking.date, booking.startTime || "00:00", booking.timezone || "Asia/Singapore").getTime() > Date.now(); } catch { return false; } }
