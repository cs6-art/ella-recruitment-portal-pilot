"use client";

import { useMemo, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { countryOptions, CountrySelect } from "@/components/CountryOptions";
import ValidationSummary from "@/components/ValidationSummary";
import { countryForPhone, localNumberForCountry } from "@/lib/country-codes";
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
  applicantCountry?: string;
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
  const country = countryForPhone(value);
  return { country: country.country, localNumber: localNumberForCountry(value, country) };
}

export default function BookingSelector({ token, initialContext }: { token: string; initialContext: Context }) {
  const [context, setContext] = useState(initialContext);
  const [selected, setSelected] = useState("");
  const [selectedDate, setSelectedDate] = useState(initialContext.slots[0]?.date || "");
  const initialMobile = splitMobile(initialContext.preferredMobile || "");
  const initialCountry = countryOptions.find((country) => country.country === initialContext.applicantCountry?.trim().toUpperCase()) || countryOptions.find((country) => country.country === initialMobile.country) || countryOptions[0];
  const [country, setCountry] = useState(initialCountry.country);
  const [localMobile, setLocalMobile] = useState(initialMobile.localNumber);
  const [error, setError] = useState("");
  const [confirmationMessage, setConfirmationMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const title = context.kind === "voice" ? "AI Voice Interview Booking" : "Face-to-Face Interview Booking";
  const roleName = context.selectedRole.trim();
  const noShow = context.currentSlot?.status?.toLowerCase() === "no show" || context.bookingStatus.toLowerCase() === "no show";
  // A completed appointment must remain read-only even if its original link
  // has not yet been marked used by the upstream calling workflow.
  const completed = context.currentSlot?.status?.toLowerCase() === "completed" || context.bookingStatus.toLowerCase() === "completed";
  const booked = completed || context.currentSlot?.status?.toLowerCase() === "booked" || (!context.currentSlot && (context.bookingStatus.toLowerCase() === "used" || context.bookingStatus.toLowerCase().includes("scheduled") || context.bookingStatus.toLowerCase() === "booked" || Boolean(context.scheduledDate)));
  const selecting = !booked || noShow;
  const noAvailability = selecting && context.slots.length === 0;
  const selectedCountry = countryOptions.find((option) => option.country === country) || countryOptions[0];

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
    const selectedSlot = context.slots.find((slot) => slot.slotId === selected);
    if (!selectedSlot) {
      setSelected("");
      setError("That time is no longer in the current availability list. Refresh the available times and choose again.");
      return;
    }
    const preferredMobile = context.kind === "voice" ? `${selectedCountry.code}${cleanDigits(localMobile)}` : "";
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
        body: JSON.stringify({ slotId: selected, preferredMobile, slot: { date: selectedSlot.date, startTime: selectedSlot.startTime, endTime: selectedSlot.endTime, timezone: selectedSlot.timezone } }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "That time is no longer available. Please select another time.");
      setContext({ ...data.booking, preferredMobile });
      setSelected("");
      setConfirmationMessage("Your interview time has been confirmed.");
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : "Unable to complete booking.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshAvailability() {
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch(`/api/public/bookings/${context.kind}/${encodeURIComponent(token)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success || !data.context) throw new Error(data.error || "Unable to refresh available times.");
      setContext(data.context);
      setSelected("");
      setSelectedDate((current) => data.context.slots.some((slot: Slot) => slot.date === current) ? current : (data.context.slots[0]?.date || ""));
      setConfirmationMessage("Availability refreshed. Choose a current time.");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh available times.");
    } finally {
      setRefreshing(false);
    }
  }

  const interviewLabel = context.kind === "voice" ? "AI voice interview" : "face-to-face interview";
  return <main className="booking-page"><section className="booking-card">
    <div className="booking-brand"><span className="booking-brand-mark">M</span><span><strong>McLink</strong><small>Recruitment Portal</small></span></div>
    <div className="booking-eyebrow">{title}</div>
    <h1>{noAvailability ? (noShow ? "No replacement times are available" : "No interview times are currently available") : noShow ? "Choose a new interview time" : completed ? "Your interview has been completed" : booked ? "Your interview is confirmed" : "Choose a time for your interview"}</h1>
    <p className="booking-intro">Hello {context.candidateName || "there"}. {noAvailability ? <>We do not have any available times for {roleName ? <><strong>{roleName}</strong> at this time</> : interviewLabel}.</> : selecting ? <>Select a time that suits you for {roleName ? <><strong>{roleName}</strong></> : "your interview"}.</> : <>{roleName ? <>Your <strong>{roleName}</strong> interview has been confirmed.</> : "Your interview has been confirmed."}</>}</p>
    {context.kind === "voice" && <p className="booking-ai-disclosure"><strong>About this interview</strong><br />Smile, McLink Group&apos;s AI interview assistant, will conduct this interview. Your responses may be recorded, transcribed, and assessed against job-related criteria before review by our recruitment team.</p>}
    {booked && !noShow ? <div className="booking-confirmed">
      {confirmationMessage && <ActionFeedback kind="success" className="booking-confirmed-feedback">{confirmationMessage}</ActionFeedback>}
      <div className="booking-confirmed-icon">✓</div>
      <h2>{completed ? "Interview completed" : "Interview time confirmed"}</h2>
      <div className="booking-confirmed-details"><div><span>Interview</span><strong>{title}</strong></div><div><span>Confirmed for</span><strong>{context.scheduledDate ? displayDate(context.scheduledDate) : "Your selected date"} · {context.scheduledTime || "Time confirmed"}</strong><small>{context.timezone || "Time zone not provided"}</small></div></div>
      {context.kind === "final" && context.finalInterviewVenue?.trim() && <div className="booking-venue"><strong>Interview location</strong><p>{context.finalInterviewVenue.trim()}</p></div>}
      <small>{completed ? "The recruitment team has received the interview result." : "You may close this page. The recruitment team has received your booking."}</small>
    </div> : noAvailability ? <div className="booking-empty booking-no-availability" role="status"><strong>No times are currently available</strong><p>Please reply to your invitation email so our recruitment team can provide a new booking link.</p></div> : <>
      {noShow && <div className="booking-notice">This interview was marked as a <strong>no-show</strong>. You can choose a new time below.</div>}
      {context.kind === "voice" && <div className="field booking-mobile-field"><span>Mobile number for the interview call *</span><div className="contact-number-controls"><label><CountrySelect ariaLabel="Country code" value={country} disabled={saving} onChange={(option) => { setCountry(option.country); setLocalMobile(""); }} /></label><label><span className="sr-only">Local mobile number</span><input required aria-label="Local mobile number" inputMode="numeric" value={localMobile} disabled={saving} placeholder={selectedCountry.placeholder} onChange={(event) => setLocalMobile(cleanDigits(event.target.value))} /></label></div><small>Enter the local number only, without the country code.</small></div>}
      {confirmationMessage && !booked && <ActionFeedback kind="success" className="booking-confirmed-feedback">{confirmationMessage}</ActionFeedback>}
      <div className="booking-section-heading"><h2>Select a date</h2><span>{context.slots.length} available time{context.slots.length === 1 ? "" : "s"}</span></div>
      {context.slots.length === 0 ? <div className="booking-empty">There are no available times right now. Please contact the recruitment team for a new booking link.</div> : <>
      <div className="booking-date-cards" aria-label="Available interview dates">{dates.map((date) => <button type="button" key={date} className={`booking-date-card ${selectedDate === date ? "is-selected" : ""}`} onClick={() => { setSelectedDate(date); setSelected(""); setError(""); }}><strong>{displayDate(date)}</strong><span>{slotsByDate.get(date)?.length || 0} available time{slotsByDate.get(date)?.length === 1 ? "" : "s"}</span></button>)}</div>
        <div className="booking-section-heading booking-time-heading"><h2>Select a time</h2><span>{selectedDate ? displayDate(selectedDate) : "Select a date first"}</span></div>
        <div className="booking-time-list">{selectedDateSlots.map((slot) => <button type="button" className={`booking-slot ${selected === slot.slotId ? "booking-slot-selected" : ""}`} key={slot.slotId} onClick={() => setSelected(slot.slotId)}><strong>{slot.startTime} - {slot.endTime}</strong><small>{slot.timezone}</small></button>)}</div>
      </>}
      {error && <><ValidationSummary error={error} title="We couldn&apos;t confirm this time" /><div className="booking-refresh-action"><button type="button" className="booking-inline-action" disabled={saving || refreshing} onClick={() => void refreshAvailability()}>{refreshing ? "Refreshing available times…" : "Refresh available times"}</button></div></>}
      <button type="button" className="booking-submit" disabled={saving || refreshing || !selected || (context.kind === "voice" && !localMobile.trim()) || context.slots.length === 0} onClick={() => void reserve()}>{saving ? "Confirming your time…" : noShow ? "Confirm new interview time" : "Confirm this interview time"}</button>
    </>}
    <p className="booking-help">Need help? Reply to your invitation email and our recruitment team will assist you.</p>
  </section></main>;
}
