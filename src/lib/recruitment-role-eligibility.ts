type PublishedRoleState = {
  status?: string;
  recruitmentSetupStatus?: string;
  postingConfirmed?: string | boolean;
  postedAt?: string;
  archivedAt?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

/**
 * Intake requires durable publication evidence in either backend. An
 * archived role keeps its last status (archiving does not rewrite it) so
 * `archivedAt` is checked independently of the status/publication fields.
 */
export function isPublishedRoleForIntake(role: PublishedRoleState): boolean {
  const status = text(role.status).toLowerCase();
  const setupStatus = text(role.recruitmentSetupStatus).toLowerCase();
  const postingConfirmed = text(role.postingConfirmed).toLowerCase();
  return text(role.archivedAt) === ""
    && status === "job posted"
    && setupStatus === "published"
    && (postingConfirmed === "true" || text(role.postedAt) !== "");
}
