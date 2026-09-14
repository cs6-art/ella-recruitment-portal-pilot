import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Environment file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));

const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey =
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!spreadsheetId) {
  throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID is missing.");
}

if (!serviceAccountEmail) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL is missing.");
}

if (!privateKey) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is missing.");
}

const emailToFind =
  process.argv[2]?.trim().toLowerCase() || "cs7@mclinkgroup.com";

const auth = new google.auth.JWT({
  email: serviceAccountEmail,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

const response = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: "User_Directory!A2:K",
});

const rows = response.data.values ?? [];

const matchedRow = rows.find(
  (row) =>
    String(row[0] ?? "").trim().toLowerCase() === emailToFind,
);

console.log("Spreadsheet rows read:", rows.length);
console.log("Email searched:", emailToFind);

if (!matchedRow) {
  console.log("RESULT: USER NOT FOUND");
  process.exit(0);
}

console.log("RESULT: USER FOUND");
console.log({
  email: matchedRow[0],
  fullName: matchedRow[1],
  accessRole: matchedRow[2],
  department: matchedRow[3],
  canCreateRole: matchedRow[4],
  canReviewRole: matchedRow[5],
  canApproveRole: matchedRow[6],
  canEditSettings: matchedRow[7],
  canManageUsers: matchedRow[8],
  active: matchedRow[9],
  canReviewDepartmentRole: matchedRow[10],
});
