import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/lib/internal-recruitment-queries.ts", import.meta.url), "utf8");

// A raw `a or b` fragment pushed into an AND list turns the whole WHERE into
// `org = X and ... or b`, which matched other organizations' applicants.
test("SQL fragments that contain OR are bracketed before joining the applicant filter", () => {
  for (const name of ["hasAvatarInterviewSql", "hasVoiceInterviewChoiceSql"]) {
    const body = source.slice(source.indexOf(`function ${name}`), source.indexOf("}\n", source.indexOf(`function ${name}`)));
    assert.match(body, /sql<boolean>`\(exists/, `${name} must start with an opening bracket`);
    assert.match(body, /\)\)`;/, `${name} must close the bracket`);
  }
  assert.match(source, /const interviewInProgress = sql<boolean>`\(exists/);
  assert.match(source, /const reviewedRejection = sql<boolean>`\(lower/);
});
