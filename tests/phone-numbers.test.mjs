import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const { countryOptions } = await import("../src/lib/country-codes.ts");
const guide = await import("../src/lib/phone-guide.ts");
const caller = await import("../src/lib/voice-caller.ts");
const country = (iso) => countryOptions.find((option) => option.country === iso);

test("every country with mobile-number data gets a real example, and that example is accepted", () => {
  const withoutExample = countryOptions.filter((option) => !guide.phoneExample(option)).map((option) => option.country);
  // Only uninhabited territories and Åland (its calling code is shared with Finland) have no example.
  assert.deepEqual(withoutExample.sort(), ["AX", "BV", "GS", "PN", "TF", "UM"]);
  for (const option of countryOptions) {
    const sample = guide.phoneExample(option);
    if (sample) assert.equal(guide.phoneProblem(option, sample), "", `${option.country} rejected its own example ${sample}`);
  }
});

test("guides name the country, the code, an example and the leading zero to leave out", () => {
  assert.match(guide.phoneGuide(country("AF")), /Afghanistan mobile number without the country code \+93 and without the leading 0\. Example: 70 123 4567\./);
  assert.match(guide.phoneGuide(country("SG")), /Singapore mobile number without the country code \+65\. Example: 8123 4567\./);
  assert.match(guide.phoneGuide(country("PH")), /Philippines .* \+63 and without the leading 0/);
  assert.match(guide.phoneGuide(country("MY")), /Malaysia .* \+60 and without the leading 0/);
  assert.equal(guide.phonePlaceholder(country("BV")), "Local mobile number");
});

test("a leading zero or a typed country code never reaches the stored number", () => {
  const ph = country("PH");
  for (const typed of ["0917 123 4567", "09171234567", "9171234567", "639171234567", "+63 917 123 4567"]) {
    assert.equal(guide.internationalNumber(ph, typed), "+639171234567", typed);
  }
  assert.equal(guide.internationalNumber(country("AF"), "070 123 4567"), "+93701234567");
  // Territories that share a calling code keep the area digits in the code.
  assert.equal(guide.internationalNumber(country("AS"), "6847331234"), "+16847331234");
  assert.equal(guide.internationalNumber(country("AS"), "7331234"), "+16847331234");
});

test("PH, SG and MY must be mobile numbers; other countries only need a plausible length", () => {
  assert.equal(guide.phoneProblem(country("PH"), "09171234567"), "");
  assert.notEqual(guide.phoneProblem(country("PH"), "12345"), "");
  assert.notEqual(guide.phoneProblem(country("PH"), "2123456789"), "");
  assert.equal(guide.phoneProblem(country("SG"), "81234567"), "");
  assert.notEqual(guide.phoneProblem(country("SG"), "61234567"), "", "a Singapore landline is not a mobile number");
  assert.equal(guide.phoneProblem(country("MY"), "0123456789"), "");
  assert.equal(guide.phoneProblem(country("AF"), "701234567"), "");
  assert.match(guide.phoneProblem(country("AF"), "12"), /valid Afghanistan mobile number, for example 70 123 4567/);
  assert.equal(guide.phoneProblem(country("AF"), ""), "Enter your contact number.");
});

test("calls come from the Philippine or Malaysian number for those candidates and the Singapore number for everyone else", () => {
  assert.equal(caller.callerRegionFor("+639171234567"), "PH");
  assert.equal(caller.callerRegionFor("+60123456789"), "MY");
  for (const other of ["+6581234567", "+93701234567", "+14155550100", "+447400123456", "+61412345678", "+971501234567"]) {
    assert.equal(caller.callerRegionFor(other), "SG", other);
  }
  const env = { VAPI_PHONE_NUMBER_ID_PH: "ph-id", VAPI_PHONE_NUMBER_ID_MY: "my-id", VAPI_PHONE_NUMBER_ID_SG: "sg-id" };
  assert.deepEqual(caller.callerFor("+639171234567", env), { region: "PH", phoneNumberId: "ph-id" });
  assert.deepEqual(caller.callerFor("+60123456789", env), { region: "MY", phoneNumberId: "my-id" });
  assert.deepEqual(caller.callerFor("+93701234567", env), { region: "SG", phoneNumberId: "sg-id" });
});

test("a region with no configured number sends an empty id so the n8n workflow keeps its own default", () => {
  assert.deepEqual(caller.callerFor("+639171234567", {}), { region: "PH", phoneNumberId: "" });
  assert.deepEqual(caller.callerFor("+60123456789", {}), { region: "MY", phoneNumberId: "" });
  assert.deepEqual(caller.callerFor("+93701234567", {}), { region: "SG", phoneNumberId: "" });
  // The Singapore number was first configured under the pilot name; a Singapore-only id never leaks into PH or MY.
  const legacy = { PILOT_VAPI_PHONE_NUMBER_ID: "legacy-sg" };
  assert.equal(caller.callerFor("+93701234567", legacy).phoneNumberId, "legacy-sg");
  assert.equal(caller.callerFor("+639171234567", legacy).phoneNumberId, "");
  assert.equal(caller.callerFor("+60123456789", legacy).phoneNumberId, "");
});

test("all number boxes use the shared guide and check, and the dispatch response names the caller number", () => {
  for (const path of ["src/components/CandidateApplicationForm.tsx", "src/components/ApplicantEditForm.tsx", "src/components/BookingSelector.tsx"]) {
    const source = read(path);
    assert.match(source, /phoneGuide\(selectedCountry\)/, path);
    assert.match(source, /phonePlaceholder\(selectedCountry\)/, path);
    assert.match(source, /phoneProblem\(selectedCountry,/, path);
    assert.match(source, /internationalNumber\(selectedCountry,/, path);
    assert.doesNotMatch(source, /Enter the local number only, without the country code\./, path);
  }
  const dispatch = read("src/app/api/internal/recruitment/voice/dispatch/route.ts");
  assert.match(dispatch, /callerFor\(phoneNumber\)/);
  assert.match(dispatch, /caller:/);
  assert.match(read(".env.example"), /VAPI_PHONE_NUMBER_ID_PH=/);
});
