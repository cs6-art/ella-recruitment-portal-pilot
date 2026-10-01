import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The Google Picker is a browser-only widget, so these assert the contract the
// component must keep. Each guards a real bug fixed in the Drive folder picker.
const source = readFileSync("src/components/RecordingDriveConnect.tsx", "utf8");
const pickerBlock = source.slice(source.indexOf("const folderView"));

test("folder picker offers separate My Drive, Shared with me and Shared drives tabs", () => {
  assert.match(pickerBlock, /folderView\("My Drive"\)\.setParent\("root"\)/);
  assert.match(pickerBlock, /folderView\("Shared with me"\)\.setOwnedByMe\(false\)/);
  assert.match(pickerBlock, /folderView\("Shared drives"\)\.setEnableDrives\(true\)/);
  const order = ["myDriveView", "sharedWithMeView", "sharedDrivesView"].map((name) => pickerBlock.indexOf(`.addView(${name})`));
  assert.ok(order.every((index) => index > -1), "all three views must be added to the picker");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "My Drive must be the first tab");
});

test("setEnableDrives is only applied to the Shared drives view", () => {
  // It turns a view into Shared-drives-only, which previously hid My Drive.
  const uses = source.match(/setEnableDrives\(true\)/g) || [];
  assert.equal(uses.length, 1);
  const shared = pickerBlock.match(/const folderView = [\s\S]*?\.setMode\("list"\);/)?.[0] || "";
  assert.doesNotMatch(shared, /setEnableDrives/);
});

test("every picker view is restricted to selectable folders", () => {
  const shared = pickerBlock.match(/const folderView = [\s\S]*?\.setMode\("list"\);/)?.[0] || "";
  assert.match(shared, /setIncludeFolders\(true\)/);
  assert.match(shared, /setSelectFolderEnabled\(true\)/);
  assert.match(shared, /setMimeTypes\(FOLDER_MIME_TYPE\)/);
  assert.match(source, /FOLDER_MIME_TYPE = "application\/vnd\.google-apps\.folder"/);
});

test("picker sets the page origin and a fixed size", () => {
  assert.match(pickerBlock, /\.setOrigin\(window\.location\.origin\)/);
  assert.match(pickerBlock, /\.setSize\(900, 600\)/);
});

test("the picker's 'loaded' callback does not close or reset the picker", () => {
  const callback = pickerBlock.slice(pickerBlock.indexOf(".setCallback("));
  const loadedAt = callback.indexOf('data.action === "loaded"');
  const closeAt = callback.indexOf("picker.setVisible(false)");
  assert.ok(loadedAt > -1, "loaded action must be handled");
  assert.ok(loadedAt < closeAt, "loaded must return before the cancel/close branch");
  assert.match(callback, /data\.action === "loaded"\) return;/);
});
