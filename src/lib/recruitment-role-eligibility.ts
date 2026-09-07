type PublishedRoleState = {
  status?: string;
  recruitmentSetupStatus?: string;
  postingConfirmed?: string | boolean;
  postedAt?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

/** Intake requires durable publication evidence in either backend. */
export function isPublishedRoleForIntake(role: PublishedRoleState): boolean {
  const status = text(role.status).toLowerCase();
  const setupStatus = text(role.recruitmentSetupStatus).toLowerCase();
  const postingConfirmed = text(role.postingConfirmed).toLowerCase();
  return status === "job posted"
    && setupStatus === "published"
    && (postingConfirmed === "true" || text(role.postedAt) !== "");
}
