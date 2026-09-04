import crypto from "node:crypto";
import { google } from "googleapis";

import { getGoogleServiceAccountPrivateKey } from "@/lib/google-service-account";
import { getPortalConfigNumber } from "@/lib/portal-config";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { targetCreateScreeningInvitation, targetGetScreeningInvitation, targetUseScreeningInvitation } from "@/lib/recruitment-target-portal";

// Application invitations live alongside the other candidate-facing sheets
// so a single spreadsheet holds the whole applicant lifecycle.
const spreadsheetId = process.env.GOOGLE_CANDIDATE_SPREADSHEET_ID || process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = getGoogleServiceAccountPrivateKey();

if (!spreadsheetId || !serviceAccountEmail || !privateKey) {
  throw new Error("Candidate spreadsheet access is not configured.");
}

const auth = new google.auth.JWT({
  email: serviceAccountEmail,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const TAB = "Resume_Screening_Invitations";
const HEADERS = [
  "Invitation_ID",
  "Role_ID",
  "Role_Title",
  "Candidate_Name",
  "Candidate_Email",
  "Token",
  "Token_Hash",
  "Status",
  "Created_At",
  "Created_By_Name",
  "Created_By_Email",
  "Expires_At",
  "Used_At",
  "Application_ID",
];

function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Build the candidate-facing URL used by HR-generated application links.
 *
 * The candidate experience is a static `index.html` page. Keeping the page
 * path here means the HR button continues to work when the page is hosted at
 * the root of its own site, while also supporting a full URL such as
 * `https://careers.example.com/index.html`.
 */
export function applicationInviteLink(baseUrl: string, token: string) {
  const url = new URL(baseUrl.trim());
  if (!url.pathname || url.pathname === "/") url.pathname = "/index.html";
  url.search = "";
  url.searchParams.set("invite", token);
  return url.toString();
}

let ensureTabPromise: Promise<void> | null = null;

// The tab is created on first use instead of requiring a human to
// pre-provision it, matching how the rest of this feature is meant to work
// out of the box the first time an HR reviewer generates a link.
async function ensureTab() {
  if (!ensureTabPromise) {
    ensureTabPromise = (async () => {
      const metadata = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title))",
      });
      const exists = metadata.data.sheets?.some((sheet) => sheet.properties?.title === TAB);
      if (exists) return;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${TAB}'!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [HEADERS] },
      });
    })().catch((error) => {
      // Let the next call retry instead of caching a failed provisioning attempt.
      ensureTabPromise = null;
      throw error;
    });
  }
  return ensureTabPromise;
}

async function readRows() {
  await ensureTab();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A:N` });
  const values = response.data.values ?? [];
  const headers = (values[0] ?? []).map(text);
  return values.slice(1)
    .filter((row) => row.some((value) => text(value) !== ""))
    .map((row, index) => ({
      rowNumber: index + 2,
      record: Object.fromEntries(headers.map((header, headerIndex) => [header, text(row[headerIndex])])) as Record<string, string>,
    }));
}

export type ResumeScreeningInvitation = {
  invitationId: string;
  roleId: string;
  roleTitle: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  applicationId: string;
  expiresAt: string;
  valid: boolean;
  reason?: "expired" | "used" | "revoked" | "invalid";
};

export async function createResumeScreeningInvitation(input: {
  roleId: string;
  roleTitle: string;
  candidateName: string;
  candidateEmail: string;
  createdByName: string;
  createdByEmail: string;
  baseUrl: string;
}) {
  if (isPostgresRecruitmentTarget()) {
    const configuredDays = await getPortalConfigNumber("Resume_Screening_Link_Expiry_Days", 7);
    const expiryDays = Number.isFinite(configuredDays) ? Math.min(Math.max(configuredDays, 1), 30) : 7;
    const target = await targetCreateScreeningInvitation({ roleId: input.roleId, candidateEmail: input.candidateEmail, createdBy: input.createdByEmail, expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString() });
    return { ...target, link: applicationInviteLink(input.baseUrl, target.token) };
  }
  await ensureTab();
  const token = crypto.randomBytes(32).toString("hex");
  const configuredDays = await getPortalConfigNumber("Resume_Screening_Link_Expiry_Days", 7);
  const expiryDays = Number.isFinite(configuredDays) ? Math.min(Math.max(configuredDays, 1), 30) : 7;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
  const invitationId = `INV-${crypto.randomUUID()}`;
  const row = [
    invitationId,
    input.roleId,
    input.roleTitle,
    input.candidateName,
    input.candidateEmail,
    token,
    hashToken(token),
    "Pending",
    now.toISOString(),
    input.createdByName,
    input.createdByEmail,
    expiresAt,
    "",
    "",
  ];
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TAB}'!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  const link = applicationInviteLink(input.baseUrl, token);
  return { invitationId, token, link, expiresAt };
}

export async function getResumeScreeningInvitationByToken(token: string): Promise<ResumeScreeningInvitation | null> {
  const cleanToken = text(token);
  if (!cleanToken) return null;
  if (isPostgresRecruitmentTarget()) return targetGetScreeningInvitation(cleanToken);
  const tokenHash = hashToken(cleanToken);
  const rows = await readRows();
  const match = rows.find((row) => row.record.Token === cleanToken || row.record.Token_Hash === tokenHash);
  if (!match) return null;
  const record = match.record;
  const status = text(record.Status).toLowerCase();
  const expiresAt = text(record.Expires_At);
  const expiryTime = Date.parse(expiresAt);
  const expired = Number.isFinite(expiryTime) && expiryTime < Date.now();
  const valid = status === "pending" && !expired;
  return {
    invitationId: text(record.Invitation_ID),
    roleId: text(record.Role_ID),
    roleTitle: text(record.Role_Title),
    candidateName: text(record.Candidate_Name),
    candidateEmail: text(record.Candidate_Email),
    status: text(record.Status),
    applicationId: text(record.Application_ID),
    expiresAt,
    valid,
    reason: valid
      ? undefined
      : expired
        ? "expired"
        : status === "used"
          ? "used"
          : status === "revoked"
            ? "revoked"
            : "invalid",
  };
}

// Marks an invitation as consumed. Only called after a real application has
// been accepted by the screening pipeline, so a failed submission leaves the
// link usable for a retry instead of permanently burning it.
export async function markResumeScreeningInvitationUsed(token: string, applicationId: string): Promise<void> {
  const cleanToken = text(token);
  if (isPostgresRecruitmentTarget()) {
    await targetUseScreeningInvitation(cleanToken, applicationId);
    return;
  }
  const tokenHash = hashToken(cleanToken);
  await ensureTab();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A:N` });
  const values = response.data.values ?? [];
  const headers = (values[0] ?? []).map(text);
  const tokenIndex = headers.indexOf("Token");
  const tokenHashIndex = headers.indexOf("Token_Hash");
  const statusIndex = headers.indexOf("Status");
  const usedAtIndex = headers.indexOf("Used_At");
  const applicationIdIndex = headers.indexOf("Application_ID");
  const rowIndex = values.slice(1).findIndex((row) => text(row[tokenIndex]) === cleanToken || text(row[tokenHashIndex]) === tokenHash);
  if (rowIndex < 0) return;
  const rowNumber = rowIndex + 2;
  const columnLetter = (index: number) => String.fromCharCode(65 + index);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `'${TAB}'!${columnLetter(statusIndex)}${rowNumber}`, values: [["Used"]] },
        { range: `'${TAB}'!${columnLetter(usedAtIndex)}${rowNumber}`, values: [[new Date().toISOString()]] },
        { range: `'${TAB}'!${columnLetter(applicationIdIndex)}${rowNumber}`, values: [[applicationId]] },
      ],
    },
  });
}
