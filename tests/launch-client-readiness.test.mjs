import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  FEEDBACK_IMPROVEMENT_QUESTION,
  FEEDBACK_ISSUE_DETAIL_PROMPT,
  FEEDBACK_ISSUE_QUESTION,
  FEEDBACK_RATING_QUESTIONS,
  parseFeedback,
} from "../src/lib/feedback.ts";
import { parseManual, slugifyHeading } from "../src/lib/manual.ts";
import { resolveManualVideo } from "../src/lib/manual-video.ts";
import { welcomeCredits } from "../src/lib/welcome-credit-config.ts";

const read = (path) => fs.readFileSync(path, "utf8");
const valid = { source: "smile_bot", navigationEase: 4, taskCompletion: 5, aiUsefulness: 3, experiencedIssue: false, issueDescription: "", improvementSuggestion: "Faster uploads" };

// ---------------------------------------------------------------------------
// Feedback survey
// ---------------------------------------------------------------------------

test("the survey asks the five agreed questions with the agreed scale labels", () => {
  assert.deepEqual(FEEDBACK_RATING_QUESTIONS.map((q) => [q.question, q.low, q.high]), [
    ["How easy was it to navigate and understand the app?", "Very difficult", "Very easy"],
    ["Were you able to complete the recruitment tasks you expected to do?", "Not at all", "Completely"],
    ["How clear and useful were the AI-generated results or recommendations?", "Very unclear / not useful", "Very clear / useful"],
  ]);
  assert.equal(FEEDBACK_ISSUE_QUESTION, "Did you experience any errors, confusing steps, or slow parts while testing the app?");
  assert.equal(FEEDBACK_ISSUE_DETAIL_PROMPT, "Please describe what happened.");
  assert.equal(FEEDBACK_IMPROVEMENT_QUESTION, "What is the most important thing we should improve before the app is fully launched?");
});

test("feedback is validated on the server: ratings 1-5, Yes/No, and a description when Yes", () => {
  assert.equal(parseFeedback(valid).ok, true);
  for (const bad of [0, 6, 2.5, "4", null, undefined]) {
    assert.equal(parseFeedback({ ...valid, navigationEase: bad }).ok, false, `navigationEase ${String(bad)}`);
    assert.equal(parseFeedback({ ...valid, aiUsefulness: bad }).ok, false);
  }
  assert.equal(parseFeedback({ ...valid, source: "email" }).ok, false, "only sign_out and smile_bot are accepted");
  assert.equal(parseFeedback({ ...valid, experiencedIssue: undefined }).ok, false, "Yes/No is required");
  assert.equal(parseFeedback({ ...valid, experiencedIssue: "yes" }).ok, false);
  assert.equal(parseFeedback({ ...valid, experiencedIssue: true, issueDescription: "  " }).ok, false, "Yes needs a description");
  assert.equal(parseFeedback({ ...valid, improvementSuggestion: "x".repeat(2001) }).ok, false);
  assert.equal(parseFeedback(null).ok, false);
});

test("a Yes answer keeps its description and a No answer never stores one", () => {
  const yes = parseFeedback({ ...valid, source: "sign_out", experiencedIssue: true, issueDescription: "  Upload was slow " });
  assert.equal(yes.ok, true);
  assert.equal(yes.value.issueDescription, "Upload was slow");
  assert.equal(yes.value.source, "sign_out");
  const no = parseFeedback({ ...valid, experiencedIssue: false, issueDescription: "typed before switching to No" });
  assert.equal(no.value.issueDescription, "");
  const noSuggestion = parseFeedback({ ...valid, improvementSuggestion: undefined });
  assert.equal(noSuggestion.ok, true, "the last question is optional");
  assert.equal(noSuggestion.value.improvementSuggestion, "");
});

test("one shared form renders the survey in the sign-out prompt and in Smile Bot", () => {
  const form = read("src/components/FeedbackForm.tsx");
  assert.equal((form.match(/type="radio"/g) || []).length, 3, "rating radios, Yes and No");
  assert.match(form, /\[1, 2, 3, 4, 5\]\.map/);
  assert.doesNotMatch(form, /<select/, "ratings are radio buttons, never a dropdown");
  assert.match(form, /experiencedIssue === true && \(/, "the description box appears only for Yes");
  assert.match(form, /parseFeedback\(/, "the browser and the API validate with the same rules");
  assert.match(form, /fetch\("\/api\/feedback"/);
  // Both places render the same component with their own source.
  assert.match(read("src/components/SignOutFeedbackModal.tsx"), /<FeedbackForm[\s\S]*source="sign_out"/);
  assert.match(read("src/components/SmileFeedbackTab.tsx"), /<FeedbackForm[\s\S]*source="smile_bot"/);
  // The scale is one row even on a phone.
  assert.match(read("src/components/FeedbackForm.module.css"), /\.scale \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(read("src/components/FeedbackForm.module.css"), /\.choices \{[^}]*display: flex/);
});

test("Sign Out shows optional feedback and can never trap the person", () => {
  const shell = read("src/components/AppShell.tsx");
  assert.match(shell, /onClick=\{\(\) => setSignOutPromptOpen\(true\)\}/, "Sign Out opens the prompt");
  assert.doesNotMatch(shell, /<form action="\/api\/auth\/logout"/, "the immediate logout form is gone");
  assert.match(shell, /window\.location\.href = "\/api\/auth\/logout"/);
  const modal = read("src/components/SignOutFeedbackModal.tsx");
  assert.match(modal, /secondaryLabel="Skip & Sign Out"/);
  assert.match(modal, /submitLabel="Submit Feedback & Sign Out"/);
  assert.match(modal, /onSecondary=\{onSignOut\}/, "skip signs out immediately");
  assert.match(modal, /onSubmitted=\{onSignOut\}/, "a saved submission signs out");
  assert.match(modal, /We couldn’t save your feedback, but you can still sign out\./);
  assert.match(modal, /event\.key === "Escape"/, "Escape closes the prompt and keeps the person signed in");
  // A failed save never calls onSubmitted, so it never signs out silently, and Skip stays available.
  const form = read("src/components/FeedbackForm.tsx");
  assert.match(form, /setSaveFailed\(true\)/);
  assert.ok(form.indexOf("onSubmitted();") > form.indexOf("setSaveFailed(true)"));
});

test("Smile Bot has a Feedback tab and no Suggestion wording", () => {
  const bot = read("src/components/HelpBot.tsx");
  assert.match(bot, /type Tab = "ask" \| "help" \| "feedback"/);
  assert.match(bot, /<SmileFeedbackTab \/>/);
  assert.doesNotMatch(bot, /Suggestion/);
  for (const file of ["src/lib/support-contact.ts", "src/lib/help-bot/knowledge.md", "docs/Smile-Recruitment-Portal-User-Manual.md"]) {
    assert.doesNotMatch(read(file), /Suggestion/, file);
  }
});

test("the feedback API stores the session organization and is readable only by platform administrators", () => {
  const route = read("src/app/api/feedback/route.ts");
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function GET"));
  assert.match(post, /getActiveSessionUser/);
  assert.match(post, /organizationId: user\.organizationId/);
  assert.doesNotMatch(post, /organizationId: parsed/, "the organization is never taken from the request body");
  assert.match(post, /consumeRateLimit/);
  const get = route.slice(route.indexOf("export async function GET"));
  assert.match(get, /isPlatformAdmin\(user\)/);
  assert.match(get, /status|403/);
  const store = read("src/lib/feedback-store.ts");
  assert.match(store, /source: feedback\.source/);
  for (const column of ["navigationEase", "taskCompletion", "aiUsefulness", "experiencedIssue", "issueDescription", "improvementSuggestion", "createdAt", "organizationId", "userEmail"]) {
    assert.match(read("src/db/schema.ts"), new RegExp(`${column}: `), column);
  }
  const migration = read("drizzle/0041_launch_promotion_and_feedback.sql");
  assert.match(migration, /"source"\s+text NOT NULL CHECK \("source" IN \('sign_out', 'smile_bot'\)\)/);
  assert.match(migration, /BETWEEN 1 AND 5/);
});

// ---------------------------------------------------------------------------
// Event launch promotion (first 100 organizations)
// ---------------------------------------------------------------------------

test("the promotion is one conditional UPDATE guarded by the cap, with database backstops", () => {
  const promotion = read("src/lib/launch-promotion.ts");
  assert.match(promotion, /\.update\(launchPromotions\)/);
  assert.match(promotion, /allocatedCount\} \+ 1/);
  assert.match(promotion, /allocatedCount\} < \$\{launchPromotions\.maxAllocations\}/);
  assert.match(promotion, /eq\(launchPromotions\.active, true\)/);
  assert.match(promotion, /startsAt\} <= now\(\)/);
  assert.doesNotMatch(promotion, /count\(\*\)/i, "no count-then-insert race");
  const migration = read("drizzle/0041_launch_promotion_and_feedback.sql");
  assert.match(migration, /"allocated_count" <= "max_allocations"/);
  assert.match(migration, /UNIQUE \("promotion_id", "organization_id"\)/);
  assert.match(migration, /VALUES \('event-launch-first-100', 'Event Launch — First 100 Organizations', 250, 100, false\)/, "seeded 250 credits, 100 slots, inactive");
});

test("the normal welcome credits are preserved and the promotion is checked once per new organization", () => {
  assert.equal(welcomeCredits(undefined), 40);
  const grant = read("src/lib/organization-welcome-credits.ts");
  assert.match(grant, /promotion \? promotion\.credits : welcomeCredits\(\)/);
  assert.match(grant, /"welcome_credit"/);
  assert.match(grant, /Welcome credits for a new organization/);
  assert.match(grant, /LAUNCH_WELCOME_CREDIT_NOTE/);
  // An organization that already has a credit account never claims a slot or gets a second grant.
  assert.ok(grant.indexOf("if (existing) return 0;") < grant.indexOf("claimLaunchPromotion("));
  // Both organization-creation paths go through the one function, inside their transaction.
  for (const file of ["src/lib/registration.ts", "src/app/api/organizations/route.ts"]) {
    assert.match(read(file), /await grantWelcomeCredits\(tx, id\);/, file);
  }
});

test("the launch grant appears in the client's credit history as Event Welcome Credits", () => {
  const panel = read("src/components/EllaCreditsPanel.tsx");
  assert.match(panel, /launch_welcome_credit: "Event Welcome Credits"/);
  assert.match(panel, /welcome_credit: "Welcome Credits"/);
  assert.match(read("src/lib/launch-promotion.ts"), /LAUNCH_WELCOME_CREDIT_NOTE = "Event Welcome Credits"/);
});

test("only platform administrators can see or switch the promotion, and clients never see it", () => {
  const route = read("src/app/api/launch-monitor/route.ts");
  assert.match(route, /isPlatformAdmin\(user\)/);
  assert.equal((route.match(/requirePlatformAdmin\(\)/g) || []).length, 3, "defined once, used by GET and POST");
  const page = read("src/app/launch-monitor/page.tsx");
  assert.match(page, /if \(!isPlatformAdmin\(user\)\) redirect\("\/dashboard"\)/);
  const shell = read("src/components/AppShell.tsx");
  assert.match(shell, /isPlatformAdmin\(user\) && <Link href="\/launch-monitor"/);
  const ui = read("src/components/LaunchMonitor.tsx");
  assert.match(ui, /Event Welcome Promotion/);
  assert.match(ui, /organizations allocated/);
  assert.match(ui, /remaining/);
});

// ---------------------------------------------------------------------------
// Credit visibility
// ---------------------------------------------------------------------------

test("credits are described as shared across the organization on the Credits page and in Get Started", () => {
  const panel = read("src/components/EllaCreditsPanel.tsx");
  assert.match(panel, /Credits are shared across your organization\./);
  assert.match(panel, /Organization Credits/);
  assert.match(panel, /credits available/);
  assert.match(panel, /data\?\.organizationName/);
  const start = read("src/components/GettingStarted.tsx");
  assert.match(start, /Credits are shared across your organization\./);
  assert.match(start, /Everyone in your organization uses the same credit balance/);
  assert.match(start, /href="\/manual"/);
  // The organization name comes from the server; internal ids are never rendered.
  const api = read("src/app/api/ella-credits/route.ts");
  assert.match(api, /organizationName,/);
  assert.doesNotMatch(panel, /\{data\??\.organizationId\}/);
});

test("the credits API stays scoped to the signed-in organization", () => {
  const api = read("src/app/api/ella-credits/route.ts");
  assert.match(api, /if \(!organizationId \|\| organizationId === user\.organizationId\) return \{ id: user\.organizationId \};/);
  assert.match(api, /if \(!canManageAllOrganizationCredits\(user\)\) return \{ error: "You can only manage your own organization's credits\.", status: 403 \}/);
  assert.match(read("src/app/api/ella-credits/balance/route.ts"), /organizationId: user\.organizationId/);
});

// ---------------------------------------------------------------------------
// Explore Manual
// ---------------------------------------------------------------------------

test("the manual page needs a signed-in user and is easy to find", () => {
  const page = read("src/app/manual/page.tsx");
  assert.match(page, /if \(!user\) redirect\("\/"\)/);
  assert.match(page, /resolveManualVideo\(process\.env\.MANUAL_VIDEO_URL\)/);
  const shell = read("src/components/AppShell.tsx");
  assert.match(shell, /"\/manual",/, "the shell treats /manual as a portal page");
  assert.match(shell, /<Link href="\/manual"[\s\S]*Explore Manual/);
  assert.match(read("next.config.mjs"), /"\/manual": \["\.\/docs\/Smile-Recruitment-Portal-User-Manual\.md"\]/);
  assert.match(read("src/components/ManualViewer.tsx"), /type="search"/);
});

test("the manual covers the real menu and every internal link points at a real heading", () => {
  const manual = parseManual(read("docs/Smile-Recruitment-Portal-User-Manual.md"));
  const titles = manual.sections.map((section) => section.title);
  assert.ok(!titles.some((title) => /^contents$/i.test(title)), "the manual's own contents list is replaced by the page's topic list");
  for (const topic of ["Quick start", "User types", "Navigation overview", "Role Requests", "Applicants", "Resume Screening", "Interviews", "Credits", "Smile Bot, help and feedback", "Settings", "User Accounts", "Troubleshooting"]) {
    assert.ok(titles.some((title) => title.includes(topic)), `manual has a ${topic} section`);
  }
  const anchors = new Set(manual.sections.map((section) => section.id));
  const source = read("docs/Smile-Recruitment-Portal-User-Manual.md");
  for (const match of source.matchAll(/^###\s+(.+)$/gm)) anchors.add(slugifyHeading(match[1]));
  const targets = [...source.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1]);
  assert.ok(targets.length > 5);
  for (const target of targets) assert.ok(anchors.has(target), `#${target} resolves to a heading`);
  const ids = manual.sections.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length, "section ids are unique");
  // The sections describe the features of this release.
  const text = source;
  for (const phrase of ["Explore Manual", "Event Welcome Credits", "Credits are shared across your", "Skip & Sign Out", "Submit Feedback & Sign Out", "Organization Credits"]) assert.ok(text.includes(phrase), phrase);
  assert.doesNotMatch(text, /Help & Feedback|Continue in email/);
});

test("the tutorial video is configurable, never autoplays and is not hardcoded", () => {
  assert.equal(resolveManualVideo(undefined), null);
  assert.equal(resolveManualVideo(""), null);
  assert.deepEqual(resolveManualVideo("/videos/tutorial.mp4"), { kind: "file", src: "/videos/tutorial.mp4", mimeType: "video/mp4" });
  assert.deepEqual(resolveManualVideo("https://cdn.example.com/walkthrough.webm"), { kind: "file", src: "https://cdn.example.com/walkthrough.webm", mimeType: "video/webm" });
  assert.deepEqual(resolveManualVideo("https://www.youtube.com/watch?v=abcdEFG1234"), { kind: "embed", src: "https://www.youtube-nocookie.com/embed/abcdEFG1234" });
  assert.deepEqual(resolveManualVideo("https://youtu.be/abcdEFG1234"), { kind: "embed", src: "https://www.youtube-nocookie.com/embed/abcdEFG1234" });
  assert.deepEqual(resolveManualVideo("https://vimeo.com/123456789"), { kind: "embed", src: "https://player.vimeo.com/video/123456789" });
  assert.deepEqual(resolveManualVideo("https://www.loom.com/share/0123456789abcdef0123456789abcdef"), { kind: "embed", src: "https://www.loom.com/embed/0123456789abcdef0123456789abcdef" });
  assert.deepEqual(resolveManualVideo("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing"), { kind: "embed", src: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview" });
  for (const unsafe of ["http://example.com/a.mp4", "https://evil.example.com/page", "javascript:alert(1)", "//evil.example.com/a.mp4", "/videos/../secret.mp4", "/notes.txt", "not a url"]) {
    assert.equal(resolveManualVideo(unsafe), null, unsafe);
  }
  const video = read("src/components/ManualVideo.tsx");
  assert.match(video, /controls preload="none" playsInline/);
  assert.match(video, /loading="lazy"/);
  assert.doesNotMatch(video, /<video[^>]*autoPlay|autoplay=1|[?&]autoplay/i, "never autoplays");
  assert.match(video, /Tutorial video coming soon/);
  assert.doesNotMatch(video, /youtube|vimeo|\.mp4/i, "no video is hardcoded");
  assert.match(read("src/components/ManualViewer.module.css"), /\.videoFrame \{[^}]*aspect-ratio: 16 \/ 9/);
});

test("Smile's knowledge matches the new feedback and manual behaviour", () => {
  const knowledge = read("src/lib/help-bot/knowledge.md");
  assert.match(knowledge, /Skip & Sign Out/);
  assert.match(knowledge, /Explore Manual/);
  assert.match(knowledge, /Event Welcome Credits/);
  assert.match(knowledge, /Credits are shared across your organization/);
});
