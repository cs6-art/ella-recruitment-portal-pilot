import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schemaSource = fs.readFileSync("src/lib/role-schema.ts", "utf8");
const formSource = fs.readFileSync("src/components/RoleRequestForm.tsx", "utf8");
const departmentSource = fs.readFileSync("src/lib/department-options.ts", "utf8");
const apiSource = fs.readFileSync("src/app/api/roles/route.ts", "utf8");
const parseDescriptionSource = fs.readFileSync("src/app/api/roles/parse-description/route.ts", "utf8");
const documentExtractionSource = fs.readFileSync("src/lib/document-extraction.ts", "utf8");
const pdfTextParserSource = fs.readFileSync("src/lib/pdf-text-parser.ts", "utf8");
const dateOnlySource = fs.readFileSync("src/lib/date-only.ts", "utf8");

function validate(input) {
  const email = String(input.requesterEmail || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return false;
  if (input.requestType === "Staff Replacement" && !String(input.replacementEmployee || "").trim()) return false;
  if (input.salaryMin !== undefined && input.salaryMin < 1) return false;
  if (input.salaryMax !== undefined && input.salaryMax < 1) return false;
  if (input.salaryMin !== undefined && input.salaryMax !== undefined && input.salaryMin > input.salaryMax) return false;
  return true;
}

test("Staff Addition clears and does not require replacement employee", () => {
  assert.equal(validate({ requestType: "Staff Addition", replacementEmployee: "", requesterEmail: "user@mclinkgroup.com" }), true);
  assert.match(formSource, /replacementEmployee: \"\"/);
});

test("Staff Replacement requires replacement employee", () => {
  assert.equal(validate({ requestType: "Staff Replacement", replacementEmployee: "", requesterEmail: "user@mclinkgroup.com" }), false);
  assert.equal(validate({ requestType: "Staff Replacement", replacementEmployee: "Former employee", requesterEmail: "user@mclinkgroup.com" }), true);
  assert.match(schemaSource, /Staff Replacement/);
});

test("requester identity is not collected as a form field and remains server-owned", () => {
  assert.doesNotMatch(formSource, /id="requesterName"/);
  assert.doesNotMatch(formSource, /id="requesterEmail"/);
  assert.match(apiSource, /requesterName: user\.name/);
  assert.match(apiSource, /requesterEmail: sessionEmail/);
  assert.match(apiSource, /submittedBy: \{/);
});

test("invalid requester emails are rejected while directory users may use any domain", () => {
  assert.equal(validate({ requesterEmail: "bad-email" }), false);
  assert.equal(validate({ requesterEmail: "user@example.com" }), true);
  assert.equal(validate({ requesterEmail: "user@invalid" }), false);
});

test("salary validation rejects negative and inverted values", () => {
  assert.equal(validate({ requesterEmail: "user@mclinkgroup.com", salaryMin: 100, salaryMax: 50 }), false);
  assert.equal(validate({ requesterEmail: "user@mclinkgroup.com", salaryMin: -1 }), false);
  assert.equal(validate({ requesterEmail: "user@mclinkgroup.com", salaryMin: 0 }), false);
  assert.equal(validate({ requesterEmail: "user@mclinkgroup.com", salaryMax: 0 }), false);
  assert.equal(validate({ requesterEmail: "user@mclinkgroup.com", salaryMin: 50, salaryMax: 100 }), true);
  assert.equal(validate({ requesterEmail: "user@mclinkgroup.com" }), true);
});

test("required-field and vacancy rules remain in the shared schema", () => {
  assert.match(schemaSource, /department: z\.string\(\)\.trim\(\)\.min/);
  assert.match(schemaSource, /jobTitle: z\.string\(\)\.trim\(\)\.min/);
  assert.match(schemaSource, /numberOfVacancies: z\.coerce\.number\(\)\.int\(\)\.min\(1\)/);
  assert.match(schemaSource, /reasonForRequest: z\.string\(\)\.trim\(\)\.min/);
  assert.match(schemaSource, /targetHiringDate: z\.string\(\)\.trim\(\)\.min/);
});

test("role creation only renders the requisition and HR screening fields", () => {
  assert.match(formSource, /id=\"employmentType\"/);
  assert.match(apiSource, /employmentType: input\.employmentType/);
  assert.match(schemaSource, /employmentType: z\.enum/);

  for (const field of [
    "jobDescription",
    "jobTitle",
    "department",
    "numberOfVacancies",
    "reasonForRequest",
    "targetHiringDate",
    "customScreeningQuestion1",
    "customScreeningQuestion2",
  ]) {
    assert.match(formSource, new RegExp(`id=\\"${field}\\"`));
  }

  for (const removedField of [
    "workLocation",
    "jobResponsibilities",
    "requiredSkills",
    "experienceRequired",
    "educationRequirements",
    "preferredQualifications",
    "roleExpectations",
    "salaryMin",
    "salaryMax",
    "workSchedule",
    "noticePeriodRequirement",
    "salaryExpectationGuidance",
  ]) {
    assert.doesNotMatch(formSource, new RegExp(`id=\\"${removedField}\\"`));
  }
});

test("role request uses department choices and keeps required markers on fields", () => {
  assert.match(formSource, /DEPARTMENT_OPTIONS/);
  assert.match(formSource, /Select a department/);
  assert.match(departmentSource, /"Other"/);
  assert.doesNotMatch(formSource, /Required fields\./);
});

test("HR interviewer identity is explicit while final availability comes from Google Calendar", () => {
  assert.match(formSource, /id=\"hodEmail\"/);
  assert.match(formSource, /Shared HR Calendar Account/);
  assert.match(formSource, /connected HR Google Calendar/);
  assert.match(formSource, /AI-generated questions appear below for HR guidance/);
  assert.match(formSource, /Generate AI questions/);
  assert.match(formSource, /HR Screening Question 1/);
  assert.match(formSource, /HR Screening Question 2/);
  assert.doesNotMatch(formSource, /addAvailability|removeAvailability|updateAvailability/);
  assert.match(apiSource, /getFinalInterviewCalendarConfig/);
  assert.match(apiSource, /hodEmail: finalInterviewCalendar\.email/);
  assert.match(apiSource, /hodAvailabilitySlots: input\.hodAvailabilitySlots/);
});

test("role creation can generate AI guidance from typed job descriptions", () => {
  assert.match(parseDescriptionSource, /jobDescriptionText/);
  assert.match(parseDescriptionSource, /typed-job-description/);
  assert.match(parseDescriptionSource, /requestedRole/);
  assert.match(formSource, /Generate AI questions/);
  assert.match(formSource, /const raw = await response\.text\(\)/);
  assert.match(formSource, /AI draft service returned an empty response/);
});

test("role drafts normalize the stored target date for the browser date input", () => {
  assert.match(formSource, /targetHiringDate: toDateInputValue\(initialValues\?\.targetHiringDate\)/);
  assert.match(dateOnlySource, /monthFirst/);
  assert.match(dateOnlySource, /input type="date"/);
});

test("job-description PDF extraction uses the current resilient parser", () => {
  assert.match(documentExtractionSource, /createPdfTextParser/);
  assert.match(pdfTextParserSource, /createRequire\(import\.meta\.url\)/);
  assert.match(pdfTextParserSource, /requireNodeModule\("@napi-rs\/canvas"\)/);
  assert.match(pdfTextParserSource, /requireNodeModule\("pdf-parse"\)/);
  assert.match(pdfTextParserSource, /requireNodeModule\("pdf-parse\/worker"\)/);
  assert.match(pdfTextParserSource, /PDFParse\.setWorker\(getData\(\)\)/);
  assert.match(pdfTextParserSource, /"DOMMatrix"/);
  assert.match(documentExtractionSource, /await parser\.destroy\(\)/);
  assert.doesNotMatch(pdfTextParserSource, /pdf-parse\/lib\/pdf-parse/);
});
