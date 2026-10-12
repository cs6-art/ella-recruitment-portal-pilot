import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { parseManual } from "../src/lib/manual.ts";
import { panelScrollTarget, pickActiveSection, sectionScrollTop } from "../src/lib/manual-scrollspy.ts";

const manual = parseManual(fs.readFileSync("docs/Smile-Recruitment-Portal-User-Manual.md", "utf8"));
const ids = manual.sections.map((section) => section.id);

/** Lay the sections out 900px apart, as if the page were scrolled by `scrollY`. */
function boxes(scrollY, heights = ids.map(() => 900)) {
  let top = 300;
  return ids.map((id, index) => {
    const box = { id, top: top - scrollY };
    top += heights[index];
    return box;
  });
}

const options = (over = {}) => ({ line: 150, atBottom: false, viewportHeight: 900, ...over });

test("the manual has topics A to S", () => {
  assert.equal(ids.length, 19);
  assert.match(manual.sections[0].title, /^A\. Quick start/);
  assert.match(manual.sections[18].title, /^S\. Troubleshooting/);
});

test("every section A to S becomes active when its heading reaches the reading line", () => {
  for (let index = 0; index < ids.length; index += 1) {
    const scrollY = 300 + index * 900 - 100; // heading 100px below the top edge
    assert.equal(pickActiveSection(boxes(scrollY), options()), ids[index], `section ${manual.sections[index].title}`);
  }
});

test("at the top of the page the first section is active", () => {
  assert.equal(pickActiveSection(boxes(0), options()), ids[0]);
});

test("short final sections still become active at the bottom of the page", () => {
  const heights = ids.map((_, index) => (index >= 16 ? 200 : 900));
  // Q, R and S are all on screen once the page cannot scroll further.
  const scrollY = 300 + 16 * 900 - 100;
  const atBottomBoxes = boxes(scrollY, heights);
  assert.equal(pickActiveSection(atBottomBoxes, options()), ids[16], "mid-scroll: the section under the reading line");
  assert.equal(pickActiveSection(atBottomBoxes, options({ atBottom: true })), ids[18], "at the bottom: the last visible section");
});

test("highlighting depends only on positions, so it is stable near boundaries", () => {
  const scrollY = 300 + 5 * 900 - 150; // F's heading exactly on the reading line
  assert.equal(pickActiveSection(boxes(scrollY), options()), ids[5]);
  assert.equal(pickActiveSection(boxes(scrollY - 1), options()), ids[4]);
  assert.equal(pickActiveSection(boxes(scrollY), options()), pickActiveSection(boxes(scrollY), options()), "same input, same section");
});

test("a sticky header moves the reading line and the jump target", () => {
  assert.equal(sectionScrollTop({ sectionTop: 500, scrollY: 1000, stickyOffset: 50 }), 1438);
  assert.equal(sectionScrollTop({ sectionTop: 10, scrollY: 0, stickyOffset: 64 }), 0);
});

test("the active topic is scrolled into view inside the topics panel only when hidden", () => {
  assert.equal(panelScrollTarget({ panelScrollTop: 0, panelHeight: 400, itemTop: 100, itemHeight: 30 }), null);
  assert.equal(panelScrollTarget({ panelScrollTop: 0, panelHeight: 400, itemTop: 600, itemHeight: 30 }), 254);
  assert.equal(panelScrollTarget({ panelScrollTop: 500, panelHeight: 400, itemTop: 100, itemHeight: 30 }), 76);
});

test("the viewer highlights, deep-links and follows Back/Forward without URL loops", () => {
  const viewer = fs.readFileSync("src/components/ManualViewer.tsx", "utf8");
  assert.match(viewer, /aria-current=\{active \? "location" : undefined\}/);
  assert.match(viewer, /window\.history\.pushState\(window\.history\.state, "", `#\$\{encodeURIComponent\(id\)\}`\)/, "a topic click adds one history entry");
  assert.match(viewer, /window\.history\.replaceState\(window\.history\.state, "", `#\$\{encodeURIComponent\(activeId\)\}`\)/, "scrolling only replaces the hash, which fires no event");
  assert.match(viewer, /addEventListener\("popstate", onHash\)/);
  assert.match(viewer, /new ResizeObserver\(scheduleMeasure\)/, "late-loading content re-measures");
  const css = fs.readFileSync("src/components/ManualViewer.module.css", "utf8");
  assert.match(css, /\.topicList a\.topicActive \{ background: #e6f2fd; color: #0e4471; font-weight: 700; box-shadow: inset 3px 0 0 #0071f7; \}/);
});
