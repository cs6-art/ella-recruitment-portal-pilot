/** YouTube tutorial IDs keyed by the manual's stable section anchor IDs. */
export const MANUAL_TUTORIALS: Readonly<Record<string, string>> = {
  "a-quick-start": "b6aZWtOx1Mc",
  "b-user-types": "LYS8qBSqxQs",
  "c-navigation-overview": "LAff9qGLrQU",
  "d-dashboard": "yYPJssYbabM",
  "e-role-requests": "3x5RBwmVoXo",
  "f-applicants": "ijGBq4ycGDw",
  "g-resume-screening": "eqbymr5N0uk",
  "h-interviews": "MJXgCJbyMPQ",
  "i-credits": "PoZcmVoiX8Y",
  "j-smile-bot-help-and-feedback": "JPX8L-mnzjM",
  "k-settings": "9wXs0PwLWDU",
  "l-reports-and-exports": "Bd7mG_kNGXQ",
  "m-alerts-and-notifications": "MSOzXPAfwKo",
  "n-common-tasks": "UW4RPSN2f7A",
  "o-status-reference": "lo0cTwK1Ya4",
  "p-end-to-end-workflow": "qHloM0oDsLg",
  "q-button-and-action-reference": "2lTtjgScgMw",
};

export type ManualTutorial = {
  sectionId: string;
  sectionTitle: string;
  youtubeId: string;
  guideNumber: number;
  total: number;
  previous?: { sectionId: string; title: string };
  next?: { sectionId: string; title: string };
};

/** Resolve the configured tutorials in the manual's current section order. */
export function resolveManualTutorials(sections: readonly { id: string; title: string }[]) {
  const configured = sections.flatMap((section) => {
    const youtubeId = MANUAL_TUTORIALS[section.id];
    return youtubeId ? [{ sectionId: section.id, sectionTitle: section.title, youtubeId }] : [];
  });
  const total = configured.length;

  return new Map<string, ManualTutorial>(configured.map((tutorial, index) => [tutorial.sectionId, {
    ...tutorial,
    guideNumber: index + 1,
    total,
    previous: index > 0
      ? { sectionId: configured[index - 1].sectionId, title: configured[index - 1].sectionTitle }
      : undefined,
    next: index < total - 1
      ? { sectionId: configured[index + 1].sectionId, title: configured[index + 1].sectionTitle }
      : undefined,
  }]));
}
