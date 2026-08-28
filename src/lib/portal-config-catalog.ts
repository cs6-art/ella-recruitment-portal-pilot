/**
 * Catalog of operational portal configuration that can be set either as a
 * Vercel env var or, at runtime, from the Settings page. No imports — this is
 * shared by both `portal-config.ts` (resolution) and `google-sheets.ts`
 * (default Settings rows) without creating an import cycle.
 *
 * Excludes bootstrap identifiers (spreadsheet id, service account) and every
 * secret (session secret, webhook secret, OAuth client secret): those stay in
 * the hosting environment.
 */

export type PortalConfigType = "text" | "url" | "number" | "choice";

export type PortalConfigEntry = {
  key: string;
  envKeys: string[];
  category: string;
  description: string;
  type: PortalConfigType;
  default: string;
  min?: number;
  max?: number;
};

export const PORTAL_CONFIG_CATALOG: PortalConfigEntry[] = [
  {
    key: "App_URL",
    envKeys: ["NEXT_PUBLIC_APP_URL"],
    category: "Infrastructure",
    description: "Public HTTPS origin of this portal. Used to build booking links, invite links, and email URLs. Leave blank to derive it from the incoming request.",
    type: "url",
    default: "",
  },
  {
    key: "N8N_Role_Webhook_URL",
    envKeys: ["N8N_ROLE_REQUEST_WEBHOOK_URL", "N8N_ROLE_WEBHOOK_URL"],
    category: "Infrastructure",
    description: "n8n webhook for role requests, status transitions, and recruitment-setup events.",
    type: "url",
    default: "",
  },
  {
    key: "N8N_Recruitment_Setup_Webhook_URL",
    envKeys: ["N8N_RECRUITMENT_SETUP_WEBHOOK_URL"],
    category: "Infrastructure",
    description: "Dedicated n8n webhook for recruitment-setup updates. Falls back to the role webhook when blank.",
    type: "url",
    default: "",
  },
  {
    key: "N8N_Role_Description_Parser_Webhook_URL",
    envKeys: ["N8N_ROLE_DESCRIPTION_PARSER_WEBHOOK_URL"],
    category: "Infrastructure",
    description: "n8n webhook that turns a pasted job description into structured role fields.",
    type: "url",
    default: "",
  },
  {
    key: "N8N_Candidate_Application_Webhook_URL",
    envKeys: ["N8N_CANDIDATE_APPLICATION_WEBHOOK_URL"],
    category: "Infrastructure",
    description: "n8n webhook that runs AI CV screening for a submitted application.",
    type: "url",
    default: "",
  },
  {
    key: "N8N_Application_Invite_Email_Webhook_URL",
    envKeys: ["N8N_APPLICATION_INVITE_EMAIL_WEBHOOK_URL"],
    category: "Infrastructure",
    description: "n8n webhook that emails an HR-generated application invitation to a candidate.",
    type: "url",
    default: "",
  },
  {
    key: "N8N_Bulk_Resume_Upload_Webhook_URL",
    envKeys: ["N8N_BULK_RESUME_UPLOAD_WEBHOOK_URL"],
    category: "Infrastructure",
    description: "n8n webhook that receives each resume from the bulk upload panel.",
    type: "url",
    default: "",
  },
  {
    key: "N8N_Bulk_Resume_Portal_Base_URL",
    envKeys: ["N8N_BULK_RESUME_PORTAL_BASE_URL"],
    category: "Infrastructure",
    description: "Portal origin reachable from n8n for PDF/DOCX text extraction. Must be publicly resolvable, not localhost.",
    type: "url",
    default: "",
  },
  {
    key: "Resume_Screening_Invite_Base_URL",
    envKeys: ["RESUME_SCREENING_INVITE_BASE_URL"],
    category: "Infrastructure",
    description: "Candidate-facing site used in HR-generated application links. If only an origin is given, /index.html is appended.",
    type: "url",
    default: "",
  },
  {
    key: "Resume_Storage_Drive_Folder_ID",
    envKeys: ["RESUME_STORAGE_DRIVE_FOLDER_ID"],
    category: "Infrastructure",
    description: "Google Drive folder ID for private resume file storage. Must be shared with the service account as Editor.",
    type: "text",
    default: "",
  },
  {
    key: "Bulk_Resume_Drive_URL",
    envKeys: ["GOOGLE_BULK_RESUME_DRIVE_URL"],
    category: "Infrastructure",
    description: "Link shown on the Resume Screening page directing HR to the shared bulk-intake Drive folder.",
    type: "url",
    default: "",
  },
  {
    key: "Allowed_Google_Domain",
    envKeys: ["ALLOWED_GOOGLE_DOMAIN"],
    category: "Access & Security",
    description: "Google Workspace hosted domain allowed to sign in. Changing this changes who can log in.",
    type: "text",
    default: "mclinkgroup.com",
  },
  {
    key: "Booking_Link_Expiry_Days",
    envKeys: ["BOOKING_LINK_EXPIRY_DAYS"],
    category: "Booking & Interview",
    description: "Days a pending final-interview booking link stays valid (1-30).",
    type: "number",
    default: "7",
    min: 1,
    max: 30,
  },
  {
    key: "Resume_Screening_Link_Expiry_Days",
    envKeys: ["RESUME_SCREENING_LINK_EXPIRY_DAYS"],
    category: "Booking & Interview",
    description: "Days an HR-generated application invitation link stays valid (1-30).",
    type: "number",
    default: "7",
    min: 1,
    max: 30,
  },
  {
    key: "Bulk_Resume_Upload_Concurrency",
    envKeys: ["BULK_RESUME_UPLOAD_CONCURRENCY"],
    category: "Workflow Rules",
    description: "How many resumes the bulk upload route processes at once (1-10). Raise only with confirmed OpenAI/Sheets quota headroom.",
    type: "number",
    default: "5",
    min: 1,
    max: 10,
  },
  {
    key: "Bulk_Resume_Notify_On_Success",
    envKeys: ["BULK_RESUME_NOTIFY_ON_SUCCESS"],
    category: "Notifications",
    description: "Send the internal HR/management 'batch complete' email after a bulk upload finishes.",
    type: "choice",
    default: "No",
  },
  {
    key: "Voice_Call_Max_Attempts",
    envKeys: ["VOICE_CALL_MAX_ATTEMPTS"],
    category: "Workflow Rules",
    description: "How many AI phone-call attempts a candidate gets before a missed interview becomes a final no-show (1-5). The n8n calling workflow must honour this.",
    type: "number",
    default: "3",
    min: 1,
    max: 5,
  },
  {
    key: "Voice_Call_Retry_Gap_Hours",
    envKeys: ["VOICE_CALL_RETRY_GAP_HOURS"],
    category: "Workflow Rules",
    description: "Hours the n8n calling workflow should wait before the next attempt after a missed AI phone call.",
    type: "number",
    default: "24",
    min: 1,
    max: 168,
  },
  {
    key: "Ella_Credit_Cost_CV_Analysis",
    envKeys: [],
    category: "Ella Credits",
    description: "Ella Credits consumed per resume screened (AI CV Analysis).",
    type: "number",
    default: "1",
    min: 0,
    max: 100000,
  },
  {
    key: "Ella_Credit_Cost_Phone_Interview",
    envKeys: [],
    category: "Ella Credits",
    description: "Ella Credits consumed per AI phone interview booked.",
    type: "number",
    default: "10",
    min: 0,
    max: 100000,
  },
  {
    key: "Ella_Credit_Discount_Threshold",
    envKeys: [],
    category: "Ella Credits",
    description: "Single top-up amount at or above which the volume discount bonus is added. Set to 0 to disable the discount.",
    type: "number",
    default: "2000",
    min: 0,
    max: 10000000,
  },
  {
    key: "Ella_Credit_Discount_Percent",
    envKeys: [],
    category: "Ella Credits",
    description: "Bonus credits added as a percentage of a qualifying top-up (e.g. 10 = 10% extra).",
    type: "number",
    default: "10",
    min: 0,
    max: 100,
  },
];

export type PortalConfigKey = (typeof PORTAL_CONFIG_CATALOG)[number]["key"];

const CATALOG_BY_KEY = new Map(PORTAL_CONFIG_CATALOG.map((entry) => [entry.key, entry]));

/** True when a "choice" value means yes/on. */
export function isEnabledChoice(value: string): boolean {
  return ["yes", "true", "on", "1"].includes(value.trim().toLowerCase());
}

export type PortalConfigSource = "sheet" | "env" | "default";

function envValue(entry: PortalConfigEntry): string {
  for (const name of entry.envKeys) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * Resolve one config value: Settings-sheet override, then env var, then the
 * catalog default. `settings` is any `{ key, value }` list (the Settings tab).
 */
export function resolvePortalConfigValue(
  key: string,
  settings: { key: string; value: string }[],
): { value: string; source: PortalConfigSource } {
  const entry = CATALOG_BY_KEY.get(key);
  if (!entry) return { value: "", source: "default" };
  const sheetValue = settings.find((setting) => setting.key === key)?.value?.trim() || "";
  if (sheetValue) return { value: sheetValue, source: "sheet" };
  const fromEnv = envValue(entry);
  if (fromEnv) return { value: fromEnv, source: "env" };
  return { value: entry.default, source: "default" };
}
