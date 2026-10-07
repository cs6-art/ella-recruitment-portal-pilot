/**
 * Let a component make Smile (the robot) speak after something happens, for
 * example "210 credits added" once a promo code is redeemed. Smile walks beside
 * `target` when it is given (and Smile's movement is on), and says `text` there.
 * Does nothing when the user switched Smile's tips off or Smile isn't on screen.
 */
export const SMILE_SAY_EVENT = "smile:say";

export type SmileSayDetail = { text: string; target?: Element | null };

export function smileSay(text: string, target?: Element | null): void {
  if (typeof window === "undefined" || !text.trim()) return;
  window.dispatchEvent(new CustomEvent<SmileSayDetail>(SMILE_SAY_EVENT, { detail: { text: text.trim(), target } }));
}
