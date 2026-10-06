export type CalendarLookupStatus = "ready" | "not_connected" | "error";

/** A failed availability request does not establish that OAuth is disconnected. */
export function calendarLookupStatus(result: { checked: boolean; reason?: "not_connected" | "error" }): CalendarLookupStatus {
  return result.checked ? "ready" : result.reason === "not_connected" ? "not_connected" : "error";
}
