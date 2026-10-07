import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { bubbleAlign, bubbleDuration, BUBBLE_HEADROOM, IDLE_AWAY_MS, pageIntroFor, placeBeside, tipFor } from "../src/lib/smile-tips.ts";

const ctx = (over) => ({ event: "click", path: "/", tag: "button", type: "", text: "", id: "", name: "", value: "", checked: false, number: "", section: "", ...over });

test("ticking Interview automation explains what it will do, for on and off", () => {
  const on = tipFor(ctx({ tag: "input", type: "checkbox", checked: true, number: "80", section: "interview-automation", text: "automatically invite applicants scoring at least" }));
  assert.match(on.text, /80% or more are invited to interview automatically/);
  assert.match(on.text, /Anyone already waiting stays with you/);
  const off = tipFor(ctx({ tag: "input", type: "checkbox", checked: false, section: "interview-automation", text: "automatically invite applicants scoring at least" }));
  assert.match(off.text, /Automation is off/);
  assert.notEqual(on.key, off.key, "a different state is a different message");
});

test("interview type choices each get their own explanation", () => {
  const radio = (text) => tipFor(ctx({ tag: "input", type: "radio", checked: true, name: "interviewType", text }));
  assert.match(radio("voice interview only applicants get an ai phone interview.").text, /Voice only/);
  assert.match(radio("avatar interview only applicants get a live avatar").text, /Avatar only/);
  assert.match(radio("both hr chooses the voice or live avatar interview").text, /never have to do both/);
});

test("form fields and selects speak for the role form", () => {
  assert.match(tipFor(ctx({ event: "focus", tag: "input", type: "date", id: "targetHiringDate", path: "/roles/new" })).text, /role stops taking new applicants/);
  assert.match(tipFor(ctx({ event: "change", tag: "select", id: "setup_salaryDisclosureStatus", value: "Not disclosed", path: "/roles/new" })).text, /candidates won't see it/);
  assert.match(tipFor(ctx({ event: "change", tag: "select", id: "setup_hodInterviewRequired", value: "Required", path: "/roles/new" })).text, /connect Google Calendar/);
  assert.match(tipFor(ctx({ tag: "input", type: "checkbox", checked: true, text: "communication quality", path: "/roles/new" })).text, /Added "Communication quality"/);
  assert.equal(tipFor(ctx({ event: "focus", tag: "input", type: "text", id: "someUnknownField", path: "/roles/new" })), null, "no tip, no bubble");
});

test("applicant actions explain themselves and respect the page they are on", () => {
  const list = tipFor(ctx({ text: "send phone interview", path: "/applicants" }));
  assert.match(list.text, /anyone already invited, or whose role doesn't use this type, is skipped/);
  const one = tipFor(ctx({ text: "send phone interview", path: "/applicants/APP-1" }));
  assert.match(one.text, /this applicant/);
  assert.match(tipFor(ctx({ text: "reject", path: "/applicants/APP-1" })).text, /needs a short reason/);
  assert.match(tipFor(ctx({ event: "change", tag: "select", value: "Highest match", path: "/applicants" })).text, /isn't a decision/);
  assert.match(tipFor(ctx({ event: "change", tag: "select", value: "Resume Review", path: "/applicants" })).text, /waiting for your decision/);
  assert.match(tipFor(ctx({ text: "delete selected", path: "/applicants" })).text, /for good/);
});

test("credits, screening, settings and other pages have tips; page intros exist for every main page", () => {
  assert.match(tipFor(ctx({ event: "focus", tag: "input", type: "text", id: "smile-promo-code", path: "/credits" })).text, /once/);
  assert.match(tipFor(ctx({ type: "file", tag: "input", path: "/resume-screening" })).text, /1 credit/);
  assert.match(tipFor(ctx({ text: "change folder", path: "/settings" })).text, /can't start without one/);
  assert.match(tipFor(ctx({ text: "mark no show", path: "/bookings" })).text, /after the interview's start time/);
  for (const path of ["/dashboard", "/roles", "/roles/new", "/roles/R1", "/roles/R1/edit", "/applicants", "/applicants/A1", "/resume-screening", "/bookings", "/credits", "/settings", "/user-accounts", "/profile"]) {
    assert.ok(pageIntroFor(path)?.text, `page intro for ${path}`);
  }
  assert.equal(pageIntroFor("/nowhere"), null);
});

test("Smile stands beside a control without covering it, and the bubble stays on screen", () => {
  const view = { width: 1280, height: 800 };
  // Room to the right: stand there, speech grows away from the control.
  const right = placeBeside({ left: 40, top: 400, right: 420, bottom: 430 }, view, 96);
  assert.equal(right.side, "right");
  assert.ok(right.left >= 420);
  assert.equal(bubbleAlign(right.left, 96, view.width, right.side), "start");
  // No room right or left (a full-width field): below the control.
  const below = placeBeside({ left: 8, top: 300, right: 1270, bottom: 340 }, view, 96);
  assert.equal(below.side, "below");
  assert.ok(below.top >= 340);
  // Never above the headroom the bubble needs, never off screen.
  const top = placeBeside({ left: 100, top: 5, right: 200, bottom: 30 }, view, 96);
  assert.ok(top.top >= BUBBLE_HEADROOM);
  for (const place of [right, below, top]) {
    assert.ok(place.left >= 8 && place.left + 96 <= view.width - 8, "inside horizontally");
    assert.ok(place.top + 96 <= view.height - 8, "inside vertically");
  }
  // Robot near the left edge: the bubble must not run off the left.
  assert.notEqual(bubbleAlign(20, 96, view.width, "left"), "end");
  assert.ok(bubbleDuration("x".repeat(500)) <= 11_000);
  assert.ok(bubbleDuration("short") >= 3_500);
  assert.equal(IDLE_AWAY_MS, 8_000);
});

test("the guide ignores dialogs, Smile's own panel and fields without a tip; components can speak", () => {
  const hook = fs.readFileSync("src/components/useSmileGuide.ts", "utf8");
  assert.match(hook, /\[data-smile-ignore\], #smile-help-panel/);
  assert.match(hook, /\[role='dialog'\], \.confirmation-modal-backdrop/);
  assert.match(hook, /if \(!tip\) return;/);
  assert.match(hook, /SMILE_SAY_EVENT/);
  for (const file of ["src/components/PromoCodeRedeem.tsx", "src/components/InterviewTypeCard.tsx", "src/components/InterviewAutomationCard.tsx"]) {
    assert.match(fs.readFileSync(file, "utf8"), /smileSay\(/, file);
  }
  const bot = fs.readFileSync("src/components/HelpBot.tsx", "utf8");
  assert.match(bot, /useSmileGuide\(\{ enabled: enabled === true && tips && !open/);
  assert.match(bot, /styles\.roamerGuiding/, "Smile never blocks the control it is speaking about");
});
