import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { recommendedSampleResumeFor, SAMPLE_JOB_DESCRIPTIONS, SAMPLE_RESUMES, sampleResumeText } from "../src/lib/sample-catalog.ts";
import { renderSampleResumePdf } from "../src/lib/sample-resume-pdf.ts";
import { isReservedDemoEmail, isReservedDemoPhone, isSampleApplication, sampleResumeIdFromSource, sampleSourceDetail } from "../src/lib/sample-safety.ts";
import { DEPARTMENT_OPTIONS } from "../src/lib/department-options.ts";

const read = (file) => fs.readFileSync(file, "utf8");
const require = createRequire(import.meta.url);

test("three detailed sample job descriptions with the required sections", () => {
  assert.deepEqual(SAMPLE_JOB_DESCRIPTIONS.map((job) => job.title), ["Sales Executive", "Customer Service Representative", "Accounts Executive"]);
  const sections = {
    "sales-executive": [/About the role/, /Key responsibilities/, /Sales targets and pipeline/, /Communication skills/, /Requirements/, /Preferred qualifications/],
    "customer-service-representative": [/About the role/, /Handling enquiries and complaints/, /Communication requirements/, /Problem-solving skills/, /Requirements/, /Preferred qualifications/],
    "accounts-executive": [/Bookkeeping responsibilities/, /Invoicing and reconciliation duties/, /Financial record handling/, /Excel/, /Xero/, /Preferred qualifications/],
  };
  for (const job of SAMPLE_JOB_DESCRIPTIONS) {
    assert.ok(job.content.length > 1800, `${job.title} is a realistic, detailed JD`);
    for (const pattern of sections[job.id]) assert.match(job.content, pattern, `${job.title} covers ${pattern}`);
    assert.ok(DEPARTMENT_OPTIONS.includes(job.department), "the department is one the role form accepts");
    assert.equal(job.sample, true);
  }
});

test("three fictional sample resumes, each matched to one sample JD", () => {
  assert.equal(SAMPLE_RESUMES.length, 3);
  const pairs = SAMPLE_JOB_DESCRIPTIONS.map((job) => [job.id, recommendedSampleResumeFor(job.id)?.intendedJobId]);
  for (const [jobId, resumeJob] of pairs) assert.equal(resumeJob, jobId, "each JD recommends the resume written for it");
  assert.equal(recommendedSampleResumeFor("custom-role"), null, "custom roles get no claimed match");
  for (const resume of SAMPLE_RESUMES) {
    assert.ok(isReservedDemoEmail(resume.candidate.email), `${resume.candidate.name} uses a reserved example.com address`);
    assert.ok(isReservedDemoPhone(resume.candidate.phone), `${resume.candidate.name} uses the phone range reserved for fiction`);
    const text = sampleResumeText(resume);
    for (const heading of ["PROFESSIONAL SUMMARY", "WORK EXPERIENCE", "EDUCATION", "SKILLS"]) assert.match(text, new RegExp(heading));
    assert.match(text, /fictional/i);
  }
});

test("sample resumes are realistic but not perfect matches (gaps are written in)", () => {
  const text = Object.fromEntries(SAMPLE_RESUMES.map((resume) => [resume.id, sampleResumeText(resume)]));
  assert.match(text["sales-executive-candidate"], /Not yet completed: formal sales methodology/);
  assert.match(text["customer-service-candidate"], /no accounting or bookkeeping experience/);
  assert.match(text["accounts-executive-candidate"], /2 years/);
  assert.match(text["accounts-executive-candidate"], /Not yet: payroll/);
});

test("nothing in the catalog fixes, predicts or fakes a screening score", () => {
  const catalog = read("src/lib/sample-catalog.ts");
  assert.doesNotMatch(catalog, /matchScore|expectedScore|score:\s*\d/);
  const intake = read("src/lib/sample-intake.ts");
  assert.doesNotMatch(intake, /screening|score/i, "a sample only supplies the file and fictional details; the normal pipeline screens it");
});

test("sample resume PDFs are deterministic and parse with the portal's PDF reader", async () => {
  const canvas = require("@napi-rs/canvas");
  for (const name of ["DOMMatrix", "DOMPoint", "DOMRect", "ImageData", "Path2D"]) if (!globalThis[name]) globalThis[name] = canvas[name];
  const { PDFParse } = require("pdf-parse");
  for (const resume of SAMPLE_RESUMES) {
    const first = renderSampleResumePdf(resume);
    const second = renderSampleResumePdf(resume);
    assert.deepEqual(first, second, "identical bytes every time (no timestamps)");
    assert.equal(new TextDecoder().decode(first.slice(0, 8)), "%PDF-1.4");
    const parser = new PDFParse({ data: Buffer.from(first) });
    const { text } = await parser.getText();
    await parser.destroy();
    assert.match(text, new RegExp(resume.candidate.name));
    assert.match(text, /WORK EXPERIENCE/);
    assert.ok(text.length > 1500, `${resume.id} extracts its full text`);
  }
});

test("sample applications are recognised at every outbound boundary", () => {
  assert.equal(sampleSourceDetail("sales-executive-candidate"), "sample_resume:sales-executive-candidate");
  assert.equal(sampleResumeIdFromSource("sample_resume:accounts-executive-candidate"), "accounts-executive-candidate");
  assert.equal(isSampleApplication({ sourceDetail: "hr_manual", email: "real.person@gmail.com" }), false);
  assert.equal(isSampleApplication({ sourceDetail: "sample_resume:x", email: "real.person@gmail.com" }), true);
  assert.equal(isSampleApplication({ sourceDetail: "", email: "x@example.com" }), true);
  assert.equal(isReservedDemoEmail("someone@mclinkgroup.com"), false);
  assert.equal(isReservedDemoPhone("+639171234567"), false);

  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(queries, /if \(isSampleApplication\(application\)\) return \{ token: null, created: false, notificationHistoryId: null, error: "sample_candidate"/, "no booking link, so no email, call, avatar session or calendar invite");
  assert.match(queries, /NOTIFICATION_SAMPLE_ERROR[\s\S]*source_detail LIKE/, "queued emails for sample candidates are retired, never claimed");
  const portal = read("src/lib/recruitment-target-portal.ts");
  assert.match(portal, /if \(isSampleApplication\(row\.application\)\) return \{ outcome: "sample_candidate" \}/);
  assert.match(portal, /if \(row && isSampleApplication\(row\.application\)\) return \{ updated: false as const, duplicate: false as const, error: "sample_candidate"/);
  assert.match(read("src/lib/auto-advance.ts"), /isSampleApplication\(row\.application\)\) return \{ advanced: false, reason: "sample_candidate" \}/);
  assert.match(read("src/app/api/internal/recruitment/voice/dispatch/route.ts"), /isReservedDemoPhone\(phoneNumber\)\) return block\("sample_candidate"/);
});

test("the intake API supplies the sample itself and tags the record; billing is unchanged", () => {
  const route = read("src/app/api/applicants/route.ts");
  assert.match(route, /const \{ sample, error: sampleError \} = applySampleResume\(intake\);/);
  assert.match(route, /sourceDetail: sample \? sampleSourceDetail\(sample\.id\) : "hr_manual"/);
  // The same credit check runs before any sample is stored.
  assert.ok(route.indexOf("applySampleResume(intake)") < route.indexOf("assertCreditsAvailable(1, \"cv_analysis\""));
  const intake = read("src/lib/sample-intake.ts");
  assert.match(intake, /intake\.body\.email = candidate\.email;/, "browser-supplied contact details are replaced by the fictional ones");
  assert.match(intake, /intake\.resumeFile = new File\(/);
});

test("sample previews may only be framed by the portal itself", () => {
  const config = read("next.config.mjs");
  assert.match(config, /source: "\/api\/samples\/resumes\/:sampleId"[\s\S]*X-Frame-Options", value: "SAMEORIGIN"[\s\S]*frame-ancestors 'self'/);
  assert.match(read("src/app/api/samples/resumes/[sampleId]/route.ts"), /getActiveSessionUser/);
});
