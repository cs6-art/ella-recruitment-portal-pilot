import { internalJson, withInternalAuth } from "@/lib/internal-api-http";
import { pendingVoiceBookingInvitations } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// n8n "Voice Booking Invitations" reads applications awaiting a voice
// booking invite instead of polling High_Match_Profile. Actually issuing the
// invitation (token + link + notification row) is the existing
// POST /api/internal/recruitment/bookings/tokens (kind: "voice") -- this
// route only supplies the read side that was missing.
export const GET = withInternalAuth("booking", async () => {
  const items = await pendingVoiceBookingInvitations();
  return internalJson({ ok: true, migrated: true, count: items.length, items });
});
