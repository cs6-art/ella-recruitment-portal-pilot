import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("automatic changes never show a technical actor name in any history or ledger", async () => {
  const { historyActorLabel } = await import("../src/lib/applicant-stage-labels.ts");
  for (const [name, email] of [["pilot-target-worker", "pilot-target-worker"], ["", "pilot-target-worker"], ["System", "system@recruitment-portal.local"], ["", "system:published-role-id-repair"]]) {
    assert.deepEqual(historyActorLabel(name, email), { automated: true, name: "", email: "" }, `${name}/${email}`);
  }
  assert.deepEqual(historyActorLabel("Julio Padilla", "julio@example.com"), { automated: false, name: "Julio Padilla", email: "julio@example.com" });
  assert.deepEqual(historyActorLabel("Sam Worker", "sam.worker@acme.com"), { automated: false, name: "Sam Worker", email: "sam.worker@acme.com" });
  for (const path of ["src/components/CandidateHistoryTimeline.tsx", "src/components/RoleDetails.tsx", "src/components/EllaCreditsPanel.tsx"]) {
    assert.match(read(path), /historyActorLabel\(/, path);
  }
  assert.match(read("src/components/EllaCreditsPanel.tsx"), /replace\(\/\^Postgres target/);
});

test("screens and error messages use plain wording", () => {
  const banned = /\b(n8n|webhook|VAPI|DATABASE_URL|HitPay keys|payload|workflow is not configured|deployment)\b/i;
  const screens = [
    "src/components/ApplicantEditForm.tsx", "src/components/ApplicantDecisionPanel.tsx", "src/components/EllaCreditsPurchase.tsx", "src/components/GettingStarted.tsx", "src/components/ResumeScreeningInviteGenerator.tsx",
  ];
  for (const path of screens) {
    const visible = read(path).split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
    assert.doesNotMatch(visible.replace(/href=[^ >]*/g, ""), banned, path);
  }
  assert.match(read("src/components/RecruitmentSetupEditor.tsx"), /AI_System_Prompt: "Voice interview instructions"/);
  assert.doesNotMatch(read("src/app/api/roles/route.ts"), /The n8n role automation/);
  assert.doesNotMatch(read("src/app/api/ella-credits/payments/route.ts"), /DATABASE_URL \+ HitPay/);
});
