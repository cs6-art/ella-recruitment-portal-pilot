"use client";

import { useMemo, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { countryOptions, CountrySelect } from "@/components/CountryOptions";
import ValidationSummary from "@/components/ValidationSummary";
import { formatPortalDateTime } from "@/lib/portal-time";

type Slot = { slotId: string; date: string; startTime: string; endTime: string; timezone: string; status?: string };
type Context = {
  kind: "voice" | "final";
  candidateName: string;
  selectedRole: string;
  bookingStatus: string;
  scheduledDate: string;
  scheduledTime: string;
  timezone: string;
  preferredMobile: string;
  finalInterviewVenue?: string;
  currentSlot?: Slot;
  slots: Slot[];
};

function displayDate(date: string) {
  return formatPortalDateTime(date, false);
}

function cleanDigits(value: string) {
  return value.replace(/\D/g, "");
}

function splitMobile(value: string) {
  const digits = cleanDigits(value).replace(/^00/, "");
  const country = countryOptions.find((option) => digits.startsWith(option.code.slice(1))) || countryOptions[0];
  return { countryCode: country.code, localNumber: digits.startsWith(country.code.slice(1)) ? digits.slice(country.code.length - 1) : digits };
}

export default function BookingSelector({ token, initialContext }: { token: string; initialContext: Context }) {
  const [context, setContext] = useState(initialContext);
  const [selected, setSelected] = useState("");
  const [selectedDate, setSelectedDate] = useState(initialContext.slots[0]?.date || "");
  const initialMobile = splitMobile(initialContext.preferredMobile || "");
  const [countryCode, setCountryCode] = useState(initialMobile.countryCode);
  const [localMobile, setLocalMobile] = useState(initialMobile.localNumber);
  const [error, setError] = useState("");
  const [confirmationMessage, setConfirmationMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const title = context.kind === "voice" ? "AI Voice Interview Booking" : "Face-to-Face Interview Booking";
  const roleName = context.selectedRole.trim();
  const noShow = context.currentSlot?.status?.toLowerCase() === "no show" || context.bookingStatus.toLowerCase() === "no show";
  // A completed appointment must remain read-only even if its original link
  // has not yet been marked used by the upstream calling workflow.
  const completed = context.currentSlot?.status?.toLowerCase() === "completed" || context.bookingStatus.toLowerCase() === "completed";
  const booked = completed || context.currentSlot?.status?.toLowerCase() === "booked" || (!context.currentSlot && (context.bookingStatus.toLowerCase() === "used" || context.bookingStatus.toLowerCase().includes("scheduled") || context.bookingStatus.toLowerCase() === "booked" || Boolean(context.scheduledDate)));
  const selecting = !booked || noShow;
  const noAvailability = selecting && context.slots.length === 0;

  const slotsByDate = useMemo(() => context.slots.reduce<Map<string, Slot[]>>((map, slot) => {
    map.set(slot.date, [...(map.get(slot.date) || []), slot]);
    return map;
  }, new Map()), [context.slots]);
  const dates = [...slotsByDate.keys()];
  const selectedDateSlots = slotsByDate.get(selectedDate) || [];

  async function reserve() {
    if (!selected) {
      setError("Select an available time first.");
      return;
    }
    const preferredMobile = context.kind === "voice" ? `${countryCode}${cleanDigits(localMobile)}` : "";
    if (context.kind === "voice" && !localMobile.trim()) {
      setError("Confirm your preferred mobile number before booking.");
      return;
    }
    setSaving(true);
    setError("");
    setConfirmationMessage("");
    try {
      const response = await fetch(`/api/public/bookings/${context.kind}/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: selected, preferredMobile }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "This slot is no longer available.");
      setContext({ ...data.booking, preferredMobile });
      setSelected("");
      setConfirmationMessage("Your interview time was confirmed successfully.");
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : "Unable to complete booking.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="booking-page"><section className="booking-card">
    <div className="booking-brand"><span className="booking-brand-mark">M</span><span><strong>McLink</strong><small>Recruitment Portal</small></span></div>
    <div className="booking-eyebrow">{title}</div>
    <h1>{noAvailability ? (noShow ? "No replacement times available" : "No interview times available") : noShow ? "Choose a new interview time" : completed ? "Your interview is complete" : booked ? "Your interview is scheduled" : "Choose a time that works for you"}</h1>
    <p className="booking-intro">Hi {context.candidateName || "there"}. {noAvailability ? <>There are currently no available times for {roleName ? <><strong>{roleName}</strong> role</> : "this role"}.</> : selecting ? <>Select an available slot for {roleName ? <><strong>{roleName}</strong> role</> : "this role"}.</> : <>{roleName ? <>Your <strong>{roleName}</strong> interview is confirmed.</> : "Your interview is confirmed."}</>}</p>
    {context.kind === "voice" && <p className="booking-ai-disclosure">This interview will be conducted by Ella, McLink Group's AI interview assistant. Your responses will be reviewed by our recruitment team.</p>}
    {booked && !noShow ? <div className="booking-confirmed">
      {confirmationMessage && <ActionFeedback kind="success" className="booking-confirmed-feedback">{confirmationMessage}</ActionFeedback>}
      <div className="booking-confirmed-icon">✓</div>
      <h2>{completed ? "Interview completed" : "Your interview is scheduled"}</h2>
      <p>{context.scheduledDate ? displayDate(context.scheduledDate) : "Your selected date"} · {context.scheduledTime || "Time confirmed"} {context.timezone || ""}</p>
      {context.kind === "final" && context.finalInterviewVenue?.trim() && <div className="booking-venue"><strong>Venue</strong><p>{context.finalInterviewVenue.trim()}</p></div>}
      <small>{completed ? "The recruitment team has received the interview result." : "You may close this page. The recruitment team has received your booking."}</small>
    </div> : noAvailability ? <div className="booking-empty booking-no-availability" role="status"><strong>No times are currently available</strong><p>Please reply to your interview invitation email so the recruitment team can send you a new booking link.</p></div> : <>
      {noShow && <div className="booking-notice">This interview was marked <strong>No Show</strong>. You may choose a replacement time below.</div>}
      {context.kind === "voice" && <div className="field booking-mobile-field"><span>Preferred mobile number *</span><div className="contact-number-controls"><label><CountrySelect ariaLabel="Country code" value={countryCode} disabled={saving} onChange={setCountryCode} /></label><label><span className="sr-only">Local mobile number</span><input required aria-label="Local mobile number" inputMode="numeric" value={localMobile} disabled={saving} placeholder={(countryOptions.find((country) => country.code === countryCode) || countryOptions[0]).placeholder} onChange={(event) => setLocalMobile(cleanDigits(event.target.value))} /></label></div><small>Enter the local number only, without the country code.</small></div>}
      <div className="booking-section-heading"><h2>Choose a date</h2><span>{context.slots.length} available times</span></div>
      {context.slots.length === 0 ? <div className="booking-empty">There are no available times right now. Please contact the recruitment team for a new booking link.</div> : <>
      <div className="booking-date-cards" aria-label="Available interview dates">{dates.map((date) => <button type="button" key={date} className={`booking-date-card ${selectedDate === date ? "is-selected" : ""}`} onClick={() => { setSelectedDate(date); setSelected(""); setError(""); }}><strong>{displayDate(date)}</strong><span>{slotsByDate.get(date)?.length || 0} available time{slotsByDate.get(date)?.length === 1 ? "" : "s"}</span></button>)}</div>
        <div className="booking-section-heading booking-time-heading"><h2>Choose a time</h2><span>{selectedDate ? displayDate(selectedDate) : "Select a date first"}</span></div>
        <div className="booking-time-list">{selectedDateSlots.map((slot) => <button type="button" className={`booking-slot ${selected === slot.slotId ? "booking-slot-selected" : ""}`} key={slot.slotId} onClick={() => setSelected(slot.slotId)}><strong>{slot.startTime} - {slot.endTime}</strong><small>{slot.timezone}</small></button>)}</div>
      </>}
      {error && <ValidationSummary error={error} title="Booking failed" />}
      <button type="button" className="booking-submit" disabled={saving || !selected || (context.kind === "voice" && !localMobile.trim()) || context.slots.length === 0} onClick={() => void reserve()}>{saving ? "Confirming..." : noShow ? "Confirm new interview time" : "Confirm interview time"}</button>
    </>}
    <p className="booking-help">Need help? Reply to the interview invitation email.</p>
  </section></main>;
}
