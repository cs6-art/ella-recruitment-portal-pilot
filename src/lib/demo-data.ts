import type { InterviewBooking } from "@/lib/candidate-applications";
import type { RoleRequestSummary } from "@/lib/google-sheets";

/**
 * Synthetic recruitment history for client demonstrations, covering roughly
 * November 2025 to today.
 *
 * Nothing here is ever persisted. The rows below are shaped exactly like the
 * Google Sheets records the portal normally reads, so they can be handed to the
 * real `mapApplicant()` and `calculateApplicantMetrics()` functions. That keeps
 * the dashboard totals, the Applicants list, and the Bookings calendar
 * consistent with each other without duplicating any workflow logic.
 *
 * Every candidate is invented. Real applicant records are never read, altered,
 * or shown while demo mode is on, so no real person's contact details are
 * exposed to a third party during a presentation.
 */

const DEMO_START = "2025-11-03";
/**
 * The synthetic history stops short of today so that records created live
 * during a presentation are always the most recent rows in every list. Without
 * the gap, generated applicants share today's date and outrank the very record
 * being demonstrated.
 */
const HISTORY_GAP_DAYS = 3;
const TIMEZONE = "Asia/Singapore";

/** Mirrors `normalizeHeader()` in candidate-applications.ts / google-sheets.ts. */
function headerKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function row(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [headerKey(key), value]));
}

/**
 * Deterministic PRNG. A demo must not have its numbers shift between page
 * refreshes while someone is presenting, so every value is derived from a fixed
 * seed rather than Math.random().
 */
function makeRandom(seed: number) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length];
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toDateString(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function isWeekend(iso: string) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Keep synthetic appointments aligned with the HR calendar's weekday rules. */
function nextWeekday(iso: string) {
  let date = iso;
  while (isWeekend(date)) date = addDays(date, 1);
  return date;
}

/**
 * Keep demo role calendars open for the current presentation window. The
 * source role seeds intentionally retain their historical creation dates, but
 * an old derived target date would otherwise make every calendar appear
 * overdue. A deterministic offset keeps dates stable between refreshes while
 * spreading them across the next few working weeks.
 */
function futureTargetHiringDate(today: string, roleIndex: number) {
  const offsetDays = 1 + ((roleIndex * 3) % 14);
  return nextWeekday(addDays(today, offsetDays));
}

/**
 * Historical demo appointments should read like attendance data, not a list
 * of future bookings. Future appointments remain booked; past appointments
 * are mostly completed with a small, believable no-show rate.
 */
function demoAppointmentStatus(scheduledDate: string, today: string, random: () => number) {
  if (scheduledDate >= today) return "Booked";
  return random() < 0.08 ? "No Show" : "Completed";
}

function timestamp(iso: string, hour: number, minute: number) {
  return `${iso}T${pad(hour)}:${pad(minute)}:00+08:00`;
}

const FIRST_NAMES = [
  "Juan", "Maria", "Jose", "Ana", "Antonio", "Rosa", "Ricardo", "Carmen", "Miguel", "Luz",
  "Andres", "Cristina", "Paolo", "Grace", "Emilio", "Divina", "Rafael", "Jasmine", "Noel", "Liza",
  "Arnel", "Michelle", "Dennis", "Rowena", "Jerome", "Kristine", "Marvin", "Angelica", "Rommel", "Charmaine",
  "Wei Ming", "Jia Hui", "Zhi Hao", "Xin Yi", "Kai Wen", "Li Ting", "Jun Jie", "Hui Min", "Yong Sheng", "Mei Ling",
  "Nurul", "Ahmad", "Siti", "Muhammad", "Aisyah", "Faizal", "Farah", "Hafiz", "Nadia", "Iskandar",
  "Priya", "Rajesh", "Kavitha", "Suresh", "Deepa", "Arun", "Meena", "Vikram",
] as const;

const LAST_NAMES = [
  "Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Torres", "Domingo", "Castillo",
  "Ramos", "Aquino", "Villanueva", "Navarro", "Salazar", "Pascual", "Manalo", "Fernandez", "Aguilar", "Marquez",
  "Tan", "Lim", "Lee", "Ng", "Wong", "Chan", "Goh", "Koh", "Teo", "Yeo", "Ong", "Chua", "Sim", "Low",
  "Ibrahim", "Rahman", "Ismail", "Osman", "Yusof", "Karim",
  "Kumar", "Menon", "Nair", "Pillai", "Subramaniam", "Sharma",
] as const;

const EMAIL_HOSTS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"] as const;

type DemoRoleSeed = {
  roleId: string;
  jobTitle: string;
  department: string;
  status: string;
  createdAt: string;
  vacancies: number;
  hodEmail: string;
  /** Roles only start attracting applicants once they are live. */
  intake: boolean;
};

/**
 * Roles staggered across the demo period so the Role Request Overview cards
 * show a realistic spread rather than a column of zeros.
 */
const ROLE_SEEDS: readonly DemoRoleSeed[] = [
  { roleId: "SBFC01", jobTitle: "SAP Business One Functional Consultant", department: "ERP", status: "Job Posted", createdAt: "2025-11-05", vacancies: 2, hodEmail: "hod.erp@mclinkgroup.com", intake: true },
  { roleId: "ISE01", jobTitle: "Inside Sales Executive", department: "Sales", status: "Job Posted", createdAt: "2025-11-18", vacancies: 3, hodEmail: "hod.sales@mclinkgroup.com", intake: true },
  { roleId: "ITSE01", jobTitle: "IT Support Engineer", department: "Technical Services", status: "Job Posted", createdAt: "2025-12-08", vacancies: 2, hodEmail: "hod.tech@mclinkgroup.com", intake: true },
  { roleId: "ACC01", jobTitle: "Accountant", department: "Finance", status: "Job Posted", createdAt: "2026-01-12", vacancies: 1, hodEmail: "hod.finance@mclinkgroup.com", intake: true },
  { roleId: "BDE01", jobTitle: "Business Development Executive", department: "Sales", status: "Job Posted", createdAt: "2026-01-26", vacancies: 2, hodEmail: "hod.sales@mclinkgroup.com", intake: true },
  { roleId: "WD01", jobTitle: "Web Developer", department: "IT", status: "Job Posted", createdAt: "2026-02-09", vacancies: 1, hodEmail: "hod.it@mclinkgroup.com", intake: true },
  { roleId: "HRG01", jobTitle: "HR Generalist", department: "Human Resources", status: "Job Posted", createdAt: "2026-02-23", vacancies: 1, hodEmail: "hod.hr@mclinkgroup.com", intake: true },
  { roleId: "MKE01", jobTitle: "Marketing Executive", department: "Marketing", status: "Job Posted", createdAt: "2026-03-09", vacancies: 1, hodEmail: "hod.marketing@mclinkgroup.com", intake: true },
  { roleId: "OT01", jobTitle: "Outdoor Technician", department: "Technical Services", status: "Job Posted", createdAt: "2026-03-30", vacancies: 4, hodEmail: "hod.tech@mclinkgroup.com", intake: true },
  { roleId: "SM01", jobTitle: "Sales Manager", department: "Sales", status: "Job Posted", createdAt: "2026-04-13", vacancies: 1, hodEmail: "hod.sales@mclinkgroup.com", intake: true },
  { roleId: "CSE01", jobTitle: "Customer Service Executive", department: "Customer Service", status: "Job Posted", createdAt: "2026-05-04", vacancies: 2, hodEmail: "hod.cs@mclinkgroup.com", intake: true },
  { roleId: "SBTC01", jobTitle: "SAP Business One Technical Consultant", department: "ERP", status: "Job Posted", createdAt: "2026-05-25", vacancies: 2, hodEmail: "hod.erp@mclinkgroup.com", intake: true },
  { roleId: "GM01", jobTitle: "General Manager", department: "Sales", status: "Job Posted", createdAt: "2026-06-15", vacancies: 1, hodEmail: "hod.sales@mclinkgroup.com", intake: true },
  { roleId: "ISS01", jobTitle: "Inside Sales Specialist", department: "Sales", status: "Job Posted", createdAt: "2026-07-06", vacancies: 2, hodEmail: "hod.sales@mclinkgroup.com", intake: true },
  { roleId: "QA01", jobTitle: "QA Analyst", department: "Quality Assurance", status: "Recruitment Setup", createdAt: "2026-07-27", vacancies: 1, hodEmail: "hod.it@mclinkgroup.com", intake: true },
  { roleId: "AIE01", jobTitle: "AI Engineer", department: "AI", status: "Recruitment Setup", createdAt: "2026-08-03", vacancies: 2, hodEmail: "hod.ai@mclinkgroup.com", intake: true },
  { roleId: "CYB01", jobTitle: "Cybersecurity Analyst", department: "IT", status: "Approved", createdAt: "2026-08-06", vacancies: 1, hodEmail: "hod.it@mclinkgroup.com", intake: false },
  { roleId: "PE01", jobTitle: "Prompt Engineer", department: "AI", status: "Approved", createdAt: "2026-08-10", vacancies: 1, hodEmail: "hod.ai@mclinkgroup.com", intake: false },
  { roleId: "LOG01", jobTitle: "Logistics Coordinator", department: "Operations", status: "Pending HR Discussion", createdAt: "2026-08-13", vacancies: 1, hodEmail: "hod.ops@mclinkgroup.com", intake: false },
  { roleId: "PM01", jobTitle: "Project Manager", department: "ERP", status: "Pending HR Discussion", createdAt: "2026-08-15", vacancies: 1, hodEmail: "hod.erp@mclinkgroup.com", intake: false },
  { roleId: "FA01", jobTitle: "Finance Analyst", department: "Finance", status: "Pending HR Discussion", createdAt: "2026-08-17", vacancies: 1, hodEmail: "hod.finance@mclinkgroup.com", intake: false },
  { roleId: "UX01", jobTitle: "UX Designer", department: "IT", status: "Pending HR Discussion", createdAt: "2026-08-18", vacancies: 1, hodEmail: "hod.it@mclinkgroup.com", intake: false },
  { roleId: "DA01", jobTitle: "Data Analyst", department: "AI", status: "Rejected", createdAt: "2026-04-20", vacancies: 1, hodEmail: "hod.ai@mclinkgroup.com", intake: false },
  { roleId: "OFA01", jobTitle: "Office Administrator", department: "Operations", status: "Rejected", createdAt: "2026-06-01", vacancies: 1, hodEmail: "hod.ops@mclinkgroup.com", intake: false },
];

const REQUESTERS = [
  { name: "Julio Jose Padilla", email: "cs6@mclinkgroup.com" },
  { name: "Bong Ramirez", email: "cs9@mclinkgroup.com" },
  { name: "Hazel Sy", email: "hrsg@mclinkgroup.com" },
] as const;

/**
 * Terminal and in-flight workflow states, expressed with the same status
 * vocabulary the live sheets use so `stageFor()`, `nextActionFor()`, and
 * `calculateApplicantMetrics()` classify them exactly as they would real rows.
 */
type Outcome =
  | "resume_rejected"
  | "resume_approved"
  | "voice_rejected"
  | "final_rejected"
  | "hired"
  | "pending_hr_review"
  | "voice_booking_pending"
  | "voice_scheduled"
  | "voice_review_pending"
  | "approved_for_final"
  | "final_scheduled"
  | "final_decision_pending";

function outcomeFields(outcome: Outcome): Record<string, string> {
  switch (outcome) {
    case "resume_rejected":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Reject", "Status 2 (Voice Interview)": "", "Status 3 (Final Interview)": "", Voice_HR_Decision: "", Final_Status: "Resume Rejected" };
    case "resume_approved":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Approve", "Status 2 (Voice Interview)": "", Voice_HR_Decision: "", "Status 3 (Final Interview)": "", Final_Status: "Resume Approved" };
    case "voice_rejected":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Approve", "Status 2 (Voice Interview)": "Completed", Voice_HR_Decision: "Reject", "Status 3 (Final Interview)": "", Final_Status: "Voice Interview Rejected" };
    case "final_rejected":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Approve", "Status 2 (Voice Interview)": "Completed", Voice_HR_Decision: "Approve", "Status 3 (Final Interview)": "Interview Completed", Final_Status: "Final Interview Rejected" };
    case "hired":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Approve", "Status 2 (Voice Interview)": "Completed", Voice_HR_Decision: "Approve", "Status 3 (Final Interview)": "Interview Completed", Final_Status: "Passed Final Interview" };
    case "pending_hr_review":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Pending", "Status 2 (Voice Interview)": "", "Status 3 (Final Interview)": "", Voice_HR_Decision: "", Final_Status: "Pending HR Review" };
    case "voice_booking_pending":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Approve", "Status 2 (Voice Interview)": "Awaiting Schedule", Voice_HR_Decision: "", "Status 3 (Final Interview)": "", Final_Status: "Approved for AI Voice Interview" };
    case "voice_scheduled":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Approve", "Status 2 (Voice Interview)": "Scheduled", Voice_HR_Decision: "", "Status 3 (Final Interview)": "", Final_Status: "Voice Interview Scheduled" };
    case "voice_review_pending":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Approve", "Status 2 (Voice Interview)": "Interviewed", Voice_HR_Decision: "Pending", "Status 3 (Final Interview)": "", Final_Status: "Voice Interview Completed" };
    case "approved_for_final":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Approve", "Status 2 (Voice Interview)": "Completed", Voice_HR_Decision: "Approve", "Status 3 (Final Interview)": "Awaiting Schedule", Final_Status: "Approved for Final Interview" };
    case "final_scheduled":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Approve", "Status 2 (Voice Interview)": "Completed", Voice_HR_Decision: "Approve", "Status 3 (Final Interview)": "Scheduled", Final_Status: "Final Interview Scheduled" };
    case "final_decision_pending":
      return { "Status (Resume Processing)": "Processed", Resume_HR_Decision: "Approve", "Status 2 (Voice Interview)": "Completed", Voice_HR_Decision: "Approve", "Status 3 (Final Interview)": "Interview Completed", Final_Status: "Final Interview Completed" };
  }
}

/** Older cohorts have settled; only recent applications are still in flight. */
function outcomeFor(random: () => number, ageDays: number): Outcome {
  const roll = random();
  if (ageDays > 45) {
    // Older cohorts are mostly settled, but a healthy funnel should retain
    // meaningful progression instead of turning nearly every record into a
    // rejection.
    if (roll < 0.38) return "resume_rejected";
    if (roll < 0.50) return "voice_rejected";
    if (roll < 0.58) return "final_rejected";
    if (roll < 0.72) return "hired";
    if (roll < 0.82) return "final_decision_pending";
    if (roll < 0.92) return "final_scheduled";
    if (roll < 0.97) return "approved_for_final";
    return "resume_approved";
  }
  if (ageDays > 21) {
    if (roll < 0.30) return "resume_rejected";
    if (roll < 0.40) return "voice_rejected";
    if (roll < 0.46) return "final_rejected";
    if (roll < 0.54) return "hired";
    if (roll < 0.64) return "final_decision_pending";
    if (roll < 0.76) return "final_scheduled";
    if (roll < 0.86) return "approved_for_final";
    if (roll < 0.90) return "resume_approved";
    if (roll < 0.95) return "voice_review_pending";
    if (roll < 0.98) return "voice_scheduled";
    return "voice_booking_pending";
  }
  if (ageDays > 7) {
    if (roll < 0.22) return "resume_rejected";
    if (roll < 0.30) return "voice_rejected";
    if (roll < 0.36) return "hired";
    if (roll < 0.48) return "final_scheduled";
    if (roll < 0.60) return "approved_for_final";
    if (roll < 0.66) return "resume_approved";
    if (roll < 0.76) return "voice_review_pending";
    if (roll < 0.90) return "voice_scheduled";
    return "voice_booking_pending";
  }
  if (roll < 0.30) return "pending_hr_review";
  if (roll < 0.55) return "voice_booking_pending";
  if (roll < 0.75) return "voice_scheduled";
  if (roll < 0.90) return "voice_review_pending";
  if (roll < 0.95) return "resume_rejected";
  if (roll < 0.98) return "resume_approved";
  return "approved_for_final";
}

function matchScoreFor(random: () => number, outcome: Outcome) {
  // Stronger candidates are the ones that advanced, so scores should correlate
  // with how far each applicant travelled rather than being uniformly random.
  const base = outcome === "hired" ? 82
    : outcome === "final_rejected" || outcome === "final_decision_pending" || outcome === "final_scheduled" || outcome === "approved_for_final" ? 74
      : outcome === "voice_rejected" || outcome === "voice_review_pending" || outcome === "voice_scheduled" || outcome === "voice_booking_pending" ? 63
        : outcome === "pending_hr_review" ? 58
          : 38;
  return String(Math.min(97, Math.max(21, Math.round(base + (random() * 16 - 8)))));
}

function recommendationFor(outcome: Outcome) {
  if (outcome === "resume_rejected") return "Not Recommended";
  if (outcome === "hired" || outcome === "final_rejected" || outcome === "final_decision_pending") return "Highly Recommended";
  return "For HR Review";
}

function phoneFor(random: () => number) {
  const roll = random();
  if (roll < 0.6) return `+639${Math.floor(random() * 900000000 + 100000000)}`;
  if (roll < 0.85) return `+65${Math.floor(random() * 9000000 + 80000000)}`;
  return `+601${Math.floor(random() * 90000000 + 10000000)}`;
}

type DemoDataset = {
  roles: RoleRequestSummary[];
  applicantRows: Record<string, string>[];
  bookings: InterviewBooking[];
  activeBookingLinkRoleIds: string[];
};

let cache: { day: string; data: DemoDataset } | null = null;

function buildDataset(today: string): DemoDataset {
  const random = makeRandom(20251103);

  const roles: RoleRequestSummary[] = ROLE_SEEDS.map((seed, index) => {
    const requester = REQUESTERS[index % REQUESTERS.length];
    return {
      roleId: seed.roleId,
      createdAt: timestamp(seed.createdAt, 9 + (index % 7), (index * 13) % 60),
      requesterEmail: requester.email,
      requesterName: requester.name,
      // Demo roles are presented as active recruiting requests. Keep every
      // derived target date in the future so the calendar does not show an
      // overdue overlay during a client demo, without changing the source
      // sheet's historical creation date.
      targetHiringDate: futureTargetHiringDate(today, index),
      department: seed.department,
      requestType: index % 5 === 0 ? "Staff Replacement" : "Staff Addition",
      jobTitle: seed.jobTitle,
      numberOfVacancies: seed.vacancies,
      status: seed.status,
      recruitmentSetupStatus: seed.status === "Job Posted" ? "Published" : seed.status === "Recruitment Setup" ? "Draft" : "",
      hodEmail: seed.hodEmail,
      hodAvailabilitySlots: "",
      voiceInterviewTimezone: TIMEZONE,
    };
  });

  const intakeRoles = ROLE_SEEDS.filter((seed) => seed.intake);
  const applicantRows: Record<string, string>[] = [];
  const bookings: InterviewBooking[] = [];

  const totalDays = Math.max(1, daysBetween(DEMO_START, today));
  const lastHistoryDay = Math.max(0, totalDays - HISTORY_GAP_DAYS);
  let sequence = 0;

  for (let dayOffset = 0; dayOffset <= lastHistoryDay; dayOffset += 1) {
    const date = addDays(DEMO_START, dayOffset);
    const ageDays = totalDays - dayOffset;

    // Applications ramp up over the period so the history reads like growing
    // adoption rather than a flat synthetic line, and taper on weekends.
    const adoption = 0.25 + 0.75 * (dayOffset / totalDays);
    const weekdayVolume = isWeekend(date) ? 2 : 11.2;
    const expected = weekdayVolume * adoption;
    const count = Math.max(0, Math.round(expected + (random() * 2 - 1)));

    const liveRoles = intakeRoles.filter((seed) => seed.createdAt <= date);
    if (liveRoles.length === 0) continue;

    for (let n = 0; n < count; n += 1) {
      sequence += 1;
      const roleSeed = pick(random, liveRoles);
      const outcome = outcomeFor(random, ageDays);
      const first = pick(random, FIRST_NAMES);
      const last = pick(random, LAST_NAMES);
      const name = `${first} ${last}`;
      const handle = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
      const applicationId = `APP-${date.replace(/-/g, "")}-${String(sequence).padStart(4, "0")}`;

      applicantRows.push(row({
        "Application ID": applicationId,
        "Candidate Name": name,
        Email: `${handle}${Math.floor(random() * 90 + 10)}@${pick(random, EMAIL_HOSTS)}`,
        "Contact Number": phoneFor(random),
        Role_ID: roleSeed.roleId,
        "Selected Role": roleSeed.jobTitle,
        Department: roleSeed.department,
        "Date of Application": timestamp(date, 8 + Math.floor(random() * 11), Math.floor(random() * 60)),
        "Match Score": matchScoreFor(random, outcome),
        Recommendation: recommendationFor(outcome),
        Resume_Text_Status: "Processed",
        ...outcomeFields(outcome),
      }));

      // Interview slots for candidates that actually reached those stages.
      const voiceStages: Outcome[] = ["voice_rejected", "final_rejected", "hired", "voice_scheduled", "voice_review_pending", "approved_for_final", "final_scheduled", "final_decision_pending"];
      if (voiceStages.includes(outcome)) {
        const voiceDate = nextWeekday(addDays(date, 2 + Math.floor(random() * 4)));
        const hour = 9 + Math.floor(random() * 8);
        const minute = Math.floor(random() * 6) * 10;
        bookings.push({
          slotId: `DEMO-V-${applicationId}`,
          interviewType: "AI Voice Interview",
          roleId: roleSeed.roleId,
          date: voiceDate,
          startTime: `${pad(hour)}:${pad(minute)}`,
          endTime: `${pad(minute === 50 ? hour + 1 : hour)}:${pad((minute + 10) % 60)}`,
          timezone: TIMEZONE,
          status: demoAppointmentStatus(voiceDate, today, random),
          applicationId,
          candidateName: name,
          candidateEmail: `${handle}@${EMAIL_HOSTS[0]}`,
          bookedAt: timestamp(date, 14, 0),
          lastUpdated: timestamp(voiceDate, hour, minute),
          calendarEventId: "",
          calendarEventLink: "",
          calendarEventStatus: "",
          calendarEventError: "",
        });
      }

      const finalStages: Outcome[] = ["final_rejected", "hired", "final_scheduled", "final_decision_pending"];
      if (finalStages.includes(outcome)) {
        const finalDate = nextWeekday(addDays(date, 8 + Math.floor(random() * 6)));
        const hour = 13 + Math.floor(random() * 4);
        bookings.push({
          slotId: `DEMO-F-${applicationId}`,
          interviewType: "Final Interview",
          roleId: roleSeed.roleId,
          date: finalDate,
          startTime: `${pad(hour)}:00`,
          endTime: `${pad(hour + 1)}:00`,
          timezone: TIMEZONE,
          status: demoAppointmentStatus(finalDate, today, random),
          applicationId,
          candidateName: name,
          candidateEmail: `${handle}@${EMAIL_HOSTS[0]}`,
          bookedAt: timestamp(addDays(date, 6), 11, 30),
          lastUpdated: timestamp(finalDate, hour, 0),
          calendarEventId: `demo-event-${applicationId}`,
          calendarEventLink: "",
          calendarEventStatus: "Confirmed",
          calendarEventError: "",
        });
      }
    }
  }

  return {
    roles,
    applicantRows,
    bookings: bookings.sort((left, right) => `${left.date} ${left.startTime}`.localeCompare(`${right.date} ${right.startTime}`)),
    activeBookingLinkRoleIds: intakeRoles.map((seed) => seed.roleId),
  };
}

/** Rebuilt at most once per calendar day so "today" stays current in a demo. */
function dataset(): DemoDataset {
  const today = toDateString(new Date());
  if (!cache || cache.day !== today) cache = { day: today, data: buildDataset(today) };
  return cache.data;
}

export function demoRoleSummaries(): RoleRequestSummary[] {
  return dataset().roles;
}

export function demoApplicantRows(): Record<string, string>[] {
  return dataset().applicantRows;
}

export function demoInterviewBookings(): InterviewBooking[] {
  return dataset().bookings;
}

export function demoActiveBookingLinkRoleIds(): string[] {
  return dataset().activeBookingLinkRoleIds;
}
