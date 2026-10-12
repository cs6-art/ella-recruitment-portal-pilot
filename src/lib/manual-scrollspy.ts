/**
 * Which Explore Manual section is "being read", from the sections' positions
 * relative to the viewport. Dependency-free so it can be unit tested.
 *
 * A section is current once its heading passes the reading line (just below
 * any sticky header). At the very bottom of the page the last section that is
 * on screen wins, so short final sections (R, S) can still become current.
 * The result depends only on positions, never on the URL, so scrolling,
 * clicking, Back/Forward and refresh all agree.
 */

export type SectionBox = { id: string; top: number };

export function pickActiveSection(boxes: SectionBox[], options: { line: number; atBottom: boolean; viewportHeight: number }): string {
  if (boxes.length === 0) return "";
  if (options.atBottom) {
    const onScreen = boxes.filter((box) => box.top < options.viewportHeight);
    if (onScreen.length > 0) return onScreen[onScreen.length - 1].id;
  }
  let active = boxes[0].id;
  for (const box of boxes) {
    if (box.top <= options.line) active = box.id;
    else break;
  }
  return active;
}

/** Scroll position that puts a section's heading just below the sticky header. */
export function sectionScrollTop(input: { sectionTop: number; scrollY: number; stickyOffset: number; gap?: number }): number {
  return Math.max(0, Math.round(input.sectionTop + input.scrollY - input.stickyOffset - (input.gap ?? 12)));
}

/** How far a topic link must scroll inside the topics panel to be fully visible (null when it already is). */
export function panelScrollTarget(input: { panelScrollTop: number; panelHeight: number; itemTop: number; itemHeight: number; padding?: number }): number | null {
  const padding = input.padding ?? 24;
  const visibleTop = input.panelScrollTop;
  const visibleBottom = input.panelScrollTop + input.panelHeight;
  if (input.itemTop - padding < visibleTop) return Math.max(0, input.itemTop - padding);
  if (input.itemTop + input.itemHeight + padding > visibleBottom) return input.itemTop + input.itemHeight + padding - input.panelHeight;
  return null;
}
