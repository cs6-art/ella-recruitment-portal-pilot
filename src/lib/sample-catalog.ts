/**
 * Built-in sample job descriptions and sample resumes.
 *
 * One shared, read-only catalog serves every organization: nothing is copied
 * into the database per organization. A role created from a sample JD, or an
 * applicant screened from a sample resume, is an ordinary record owned by the
 * organization that created it.
 *
 * The three JDs and three resumes form one demo set (Sales, Customer Service,
 * Accounts). Each resume is relevant to its matching role but deliberately not
 * a perfect fit, so the real screening model has strengths and gaps to find.
 * Nothing here predicts or fixes a score.
 *
 * Every candidate is fictional. Emails use the reserved example.com domain
 * (RFC 2606) and phone numbers come from the Australian range reserved for
 * fiction (0491 570 xxx), so neither can reach a real person.
 *
 * Dependency-free so tests and client components can import it directly.
 */

export const SAMPLE_CATALOG_VERSION = 1;

export type SampleJobId = "sales-executive" | "customer-service-representative" | "accounts-executive";
export type SampleResumeId = "sales-executive-candidate" | "customer-service-candidate" | "accounts-executive-candidate";

export type SampleJobDescription = {
  id: SampleJobId;
  kind: "job_description";
  version: number;
  sample: true;
  title: string;
  /** One of DEPARTMENT_OPTIONS, so the role form's department select accepts it. */
  department: string;
  employmentType: "Full-Time";
  summary: string;
  /** The sample resume written for this role. */
  matchingResumeId: SampleResumeId;
  content: string;
};

export type SampleResumeSection = { heading: string; lines: string[] };

export type SampleResume = {
  id: SampleResumeId;
  kind: "resume";
  version: number;
  sample: true;
  /** What the sample is meant to demonstrate, e.g. "Sales Executive candidate". */
  label: string;
  summary: string;
  /** The sample JD this resume was written for. */
  intendedJobId: SampleJobId;
  candidate: {
    name: string;
    headline: string;
    email: string;
    /** International format, from the range reserved for fiction. */
    phone: string;
    /** ISO country of the phone number. */
    country: "AU";
    location: string;
  };
  fileName: string;
  sections: SampleResumeSection[];
};

const salesExecutive = `Sales Executive

About the role
We are looking for a motivated Sales Executive to grow our business with small and mid-sized companies. You will own the full sales cycle for your territory, from finding and qualifying new prospects to presenting solutions, negotiating terms and handing new customers over to the onboarding team. You will work closely with marketing, customer success and finance, and report to the Sales Manager.

Key responsibilities
- Prospect for new business through calls, email, LinkedIn, referrals and industry events, and keep a healthy pipeline of qualified opportunities.
- Run discovery meetings to understand each prospect's goals, budget, decision process and timeline.
- Prepare and deliver tailored presentations, product demonstrations and written proposals.
- Negotiate pricing and contract terms within approved limits, and close deals.
- Manage existing accounts in your territory, identify upsell and renewal opportunities, and keep customers informed of new offerings.
- Record every activity, opportunity and forecast accurately in the CRM.
- Work with marketing on campaigns and follow up on inbound leads within one business day.
- Share customer feedback with the product and service teams.

Sales targets and pipeline
- Achieve a monthly and quarterly revenue quota agreed with the Sales Manager.
- Maintain a pipeline of at least three times the quarterly quota.
- Hit weekly activity targets for calls, meetings and proposals sent.
- Provide an accurate weekly forecast and explain any changes to it.

Communication skills
- Confident, clear spoken and written English; another regional language is an advantage.
- Able to present to business owners and senior managers, in person and online.
- Strong listening skills and the ability to handle objections professionally.

Requirements
- At least 3 years of business-to-business (B2B) sales experience with a measurable track record of meeting or exceeding quota.
- Experience managing a full sales cycle, from prospecting to closing.
- Working knowledge of a CRM such as Salesforce or HubSpot.
- Good organisational skills and the discipline to manage a high volume of activity.
- Diploma or bachelor's degree in business, marketing or a related field.

Preferred qualifications
- Experience selling software, technology services or other subscription products.
- Experience with key account management or larger multi-stakeholder deals.
- Formal sales training (for example SPIN, Challenger or solution selling).

What we offer
Base salary plus commission, health benefits, ongoing sales training and a clear path to Senior Sales Executive.`;

const customerService = `Customer Service Representative

About the role
We are hiring a Customer Service Representative to look after our customers by phone, email and live chat. You will be the first point of contact for questions about orders, accounts, billing and our products, and you will resolve most issues yourself on the first contact. You will join a team of eight representatives and report to the Customer Service Team Lead. The role works on a rotating roster that includes some weekend shifts.

Key responsibilities
- Answer customer enquiries by phone, email and live chat within our service-level targets.
- Help customers with orders, deliveries, returns, account changes and basic billing questions.
- Log every interaction accurately in the helpdesk system, including the outcome and any follow-up needed.
- Follow up on open cases until they are resolved and keep the customer updated.
- Escalate complex technical or billing issues to the right team with a clear summary.
- Identify recurring problems and suggest improvements to processes and help articles.

Handling enquiries and complaints
- Listen to complaints calmly, acknowledge the customer's concern and take ownership of finding a solution.
- Apply our refund, replacement and goodwill policies fairly and consistently.
- De-escalate difficult conversations and know when to involve the Team Lead.
- Record complaint details so trends can be reviewed every month.

Communication requirements
- Excellent spoken and written English with a friendly, professional tone.
- Clear, accurate written replies with correct spelling and grammar.
- Comfortable handling a high volume of contacts while staying patient and courteous.

Problem-solving skills
- Able to ask the right questions to understand the real issue quickly.
- Able to find answers in the knowledge base and internal systems, and to think of practical solutions when the answer is not obvious.
- Good judgement about when a case needs to be escalated.

Requirements
- At least 1 year of customer service experience in a contact centre, retail, hospitality or similar customer-facing role.
- Experience with a helpdesk or CRM system such as Zendesk, Freshdesk or Salesforce Service Cloud.
- Typing speed of at least 40 words per minute and good computer skills.
- Completed secondary education; a diploma or degree is an advantage.
- Available to work a rotating roster, including some weekends.

Preferred qualifications
- Experience with live chat or handling several conversations at once.
- Track record against customer satisfaction (CSAT) or quality scores.
- Experience in e-commerce, telecommunications or subscription services.

What we offer
Competitive salary, shift allowance for weekend work, health benefits, paid training and opportunities to move into team lead or quality roles.`;

const accountsExecutive = `Accounts Executive

About the role
We are looking for a detail-oriented Accounts Executive to handle day-to-day accounting for our company. You will look after bookkeeping, invoicing, payments and reconciliations, and help the Finance Manager prepare the monthly accounts. This is a hands-on role for someone who enjoys accuracy and keeping financial records in order.

Bookkeeping responsibilities
- Record daily transactions accurately in the accounting system, including sales, purchases, receipts and payments.
- Maintain the general ledger and make sure every entry is supported by the right documents.
- Post month-end accruals, prepayments and simple journal entries under the Finance Manager's guidance.

Invoicing and reconciliation duties
- Prepare and send customer invoices and statements on time, and follow up on overdue accounts.
- Process supplier invoices, match them to purchase orders and delivery records, and prepare payment runs for approval.
- Reconcile bank accounts weekly and investigate any unmatched items.
- Reconcile accounts receivable and accounts payable ledgers to the general ledger every month.
- Handle staff expense claims and petty cash, checking receipts against company policy.

Financial record handling
- Keep financial records, contracts and supporting documents organised, complete and confidential.
- Prepare GST or VAT working papers and help with filing returns.
- Support the year-end audit by preparing schedules and answering auditor questions.
- Help with payroll input and checks when required.

Requirements
- At least 3 years of experience in an accounting, bookkeeping or accounts assistant role.
- Diploma or bachelor's degree in accounting, finance or a related field.
- Strong Microsoft Excel skills, including VLOOKUP or XLOOKUP, pivot tables and basic formulas.
- Hands-on experience with an accounting system such as Xero, QuickBooks, MYOB or SAP Business One.
- Good understanding of double-entry bookkeeping, accounts receivable, accounts payable and bank reconciliations.
- High level of accuracy and the ability to meet month-end deadlines.

Preferred qualifications
- Progress towards a professional qualification such as ACCA, CPA or CA.
- Experience with payroll processing.
- Experience preparing full month-end closing packs.

What we offer
Competitive salary, annual performance bonus, study support for professional qualifications and a friendly finance team.`;

export const SAMPLE_JOB_DESCRIPTIONS: readonly SampleJobDescription[] = [
  {
    id: "sales-executive",
    kind: "job_description",
    version: SAMPLE_CATALOG_VERSION,
    sample: true,
    title: "Sales Executive",
    department: "Sales",
    employmentType: "Full-Time",
    summary: "B2B sales role owning the full cycle: prospecting, demos, proposals, closing and a quarterly quota.",
    matchingResumeId: "sales-executive-candidate",
    content: salesExecutive,
  },
  {
    id: "customer-service-representative",
    kind: "job_description",
    version: SAMPLE_CATALOG_VERSION,
    sample: true,
    title: "Customer Service Representative",
    department: "Other",
    employmentType: "Full-Time",
    summary: "Front-line support by phone, email and chat: enquiries, complaints, first-contact resolution and escalation.",
    matchingResumeId: "customer-service-candidate",
    content: customerService,
  },
  {
    id: "accounts-executive",
    kind: "job_description",
    version: SAMPLE_CATALOG_VERSION,
    sample: true,
    title: "Accounts Executive",
    department: "Finance",
    employmentType: "Full-Time",
    summary: "Hands-on bookkeeping, invoicing, AP/AR, bank reconciliations and month-end support.",
    matchingResumeId: "accounts-executive-candidate",
    content: accountsExecutive,
  },
];

export const SAMPLE_RESUMES: readonly SampleResume[] = [
  {
    id: "sales-executive-candidate",
    kind: "resume",
    version: SAMPLE_CATALOG_VERSION,
    sample: true,
    label: "Sales Executive candidate",
    summary: "Four years of B2B software sales, consistently above quota; limited key-account and formal sales-method experience.",
    intendedJobId: "sales-executive",
    candidate: {
      name: "Daniel Reyes",
      headline: "B2B Sales Executive",
      email: "daniel.reyes.sample@example.com",
      phone: "+61491570156",
      country: "AU",
      location: "Sydney, NSW, Australia",
    },
    fileName: "Sample-Resume-Daniel-Reyes-Sales.pdf",
    sections: [
      { heading: "Professional summary", lines: [
        "Results-driven B2B sales executive with 4 years of experience selling cloud software and IT services to small and mid-sized businesses. Comfortable running the full sales cycle from cold outreach to signed contract. Known for disciplined pipeline management, clear proposals and building trust with business owners.",
      ] },
      { heading: "Work experience", lines: [
        "Sales Executive - Brightline Cloud Solutions (fictional company), Sydney | March 2023 - Present",
        "- Own a territory of about 400 small and mid-sized businesses selling a subscription accounting and inventory platform.",
        "- Achieved 112% of annual quota in 2024 and 104% in 2023; ranked second of nine executives in 2024.",
        "- Generate about 60% of my own pipeline through calls, LinkedIn and referral programmes; keep pipeline at roughly 3.5 times quarterly target.",
        "- Run discovery calls and online product demonstrations for owners, finance managers and operations leads.",
        "- Negotiate annual contracts within approved discount bands; average deal size AUD 9,000 per year.",
        "- Log all activity and forecasts in HubSpot; forecast accuracy within 10% for six consecutive quarters.",
        "",
        "Inside Sales Representative - Northgate IT Services (fictional company), Sydney | January 2021 - February 2023",
        "- Qualified inbound leads from marketing campaigns and booked meetings for senior account managers.",
        "- Made 60-80 outbound calls a day; booked an average of 14 qualified meetings a month against a target of 10.",
        "- Promoted to closing smaller managed-service deals (under AUD 5,000) in my final six months.",
        "",
        "Retail Sales Associate - City Electronics (fictional company), Sydney | 2019 - 2020 (part-time while studying)",
        "- Advised customers on laptops and home networking products; regularly in the store's top three for add-on sales.",
      ] },
      { heading: "Selected achievements", lines: [
        "- Closed the company's largest new small-business deal of 2024 (AUD 38,000 over two years) after a three-month evaluation with four stakeholders.",
        "- Built a referral programme with two accounting firms that produced 22 qualified opportunities in its first year.",
        "- Mentored two new inside sales hires through their first 90 days.",
      ] },
      { heading: "Client relationship skills", lines: [
        "- Regular quarterly check-ins with existing customers; renewal rate of 93% across my book of business.",
        "- Comfortable presenting to business owners and small management teams, in person and on video calls.",
        "- Handle pricing and contract objections calmly and look for options that work for both sides.",
      ] },
      { heading: "Education", lines: [
        "Diploma of Business (Marketing) - fictional institute, Sydney | 2020",
      ] },
      { heading: "Skills", lines: [
        "HubSpot CRM (daily use), Salesforce (basic), LinkedIn Sales Navigator, Microsoft Excel and PowerPoint, Zoom and Teams demonstrations, pipeline forecasting, proposal writing, negotiation.",
        "Languages: English (fluent), Filipino (conversational).",
        "Not yet completed: formal sales methodology training (SPIN, Challenger). Limited experience managing large enterprise or multi-site key accounts.",
      ] },
    ],
  },
  {
    id: "customer-service-candidate",
    kind: "resume",
    version: SAMPLE_CATALOG_VERSION,
    sample: true,
    label: "Customer Service candidate",
    summary: "Three years in a busy contact centre with strong CSAT and Zendesk experience; little exposure to billing systems.",
    intendedJobId: "customer-service-representative",
    candidate: {
      name: "Priya Nair",
      headline: "Customer Service Representative",
      email: "priya.nair.sample@example.com",
      phone: "+61491570157",
      country: "AU",
      location: "Parramatta, NSW, Australia",
    },
    fileName: "Sample-Resume-Priya-Nair-Customer-Service.pdf",
    sections: [
      { heading: "Professional summary", lines: [
        "Friendly, patient customer service representative with 3 years of experience handling phone, email and live chat enquiries in a high-volume contact centre. Consistently above team targets for customer satisfaction and first-contact resolution. Calm under pressure and good at turning frustrated customers into loyal ones.",
      ] },
      { heading: "Work experience", lines: [
        "Customer Service Representative - Harbourline Online Retail (fictional company), Sydney | June 2022 - Present",
        "- Handle 50-70 customer contacts a day across phone, email and live chat for an online home-goods retailer.",
        "- Help customers with orders, deliveries, returns, refunds and account changes using Zendesk and the order-management system.",
        "- Customer satisfaction (CSAT) average of 94% over the last 12 months against a team target of 88%.",
        "- First-contact resolution of 81% against a target of 75%.",
        "- Handle up to three live chats at once while meeting the 60-second first-response target.",
        "- Chosen as a buddy for new starters; trained five new representatives on the returns process.",
        "",
        "Retail Team Member - Greenleaf Supermarkets (fictional company), Parramatta | 2020 - 2022",
        "- Served customers at the registers and service desk, handled refunds and exchanges, and resolved complaints on the shop floor.",
        "- Opened and closed the store and balanced registers at end of shift.",
      ] },
      { heading: "Customer issue resolution examples", lines: [
        "- A customer received the wrong furniture item twice: arranged collection and a priority replacement, kept her updated daily and applied a goodwill credit; she later left a five-star review naming me.",
        "- Noticed a pattern of delivery complaints from one courier region, logged the cases and raised it with my team lead; the company changed courier for that area.",
        "- Rewrote three help-centre articles on returns that reduced related chat volume.",
      ] },
      { heading: "Communication and support skills", lines: [
        "- Clear, warm written replies; quality-assurance score average of 96% on written tickets.",
        "- De-escalation of upset customers on the phone; know when and how to involve a team lead.",
        "- Typing speed 55 words per minute.",
      ] },
      { heading: "Education", lines: [
        "Higher School Certificate - fictional high school, Parramatta | 2019",
        "Certificate III in Customer Engagement (in progress) - fictional college",
      ] },
      { heading: "Skills", lines: [
        "Zendesk, Shopify order management, Microsoft Office, Google Workspace, live chat, complaint handling, refunds and returns policy, knowledge-base writing.",
        "Available for rotating rosters including weekends.",
        "Limited experience with billing systems or subscription account changes; no accounting or bookkeeping experience.",
      ] },
    ],
  },
  {
    id: "accounts-executive-candidate",
    kind: "resume",
    version: SAMPLE_CATALOG_VERSION,
    sample: true,
    label: "Accounts Executive candidate",
    summary: "Two years as an accounts assistant with AP/AR, bank recs, Xero and Excel; fewer years than asked and no payroll.",
    intendedJobId: "accounts-executive",
    candidate: {
      name: "Marcus Tan",
      headline: "Accounts Assistant",
      email: "marcus.tan.sample@example.com",
      phone: "+61491570158",
      country: "AU",
      location: "Chatswood, NSW, Australia",
    },
    fileName: "Sample-Resume-Marcus-Tan-Accounts.pdf",
    sections: [
      { heading: "Professional summary", lines: [
        "Accurate and organised accounts assistant with 2 years of experience in accounts payable, accounts receivable and bank reconciliations for a mid-sized distribution company. Strong Excel skills and daily use of Xero. Currently studying towards the ACCA qualification and keen to take on more month-end responsibility.",
      ] },
      { heading: "Work experience", lines: [
        "Accounts Assistant - Riverside Distribution (fictional company), Sydney | August 2023 - Present",
        "- Process about 250 supplier invoices a month in Xero, matching each to purchase orders and delivery records before approval.",
        "- Prepare the fortnightly supplier payment run for the Finance Manager's approval.",
        "- Raise about 180 customer invoices a month, send statements and follow up overdue accounts by phone and email; reduced debts over 60 days by 30% in my first year.",
        "- Reconcile two bank accounts weekly and investigate unmatched items.",
        "- Reconcile the AP and AR ledgers to the general ledger at month end.",
        "- Process staff expense claims and petty cash, checking receipts against policy.",
        "",
        "Finance Intern - Kestrel Property Group (fictional company), Sydney | December 2022 - July 2023",
        "- Entered receipts and payments, filed supporting documents and helped prepare audit schedules for the year-end audit.",
      ] },
      { heading: "Reconciliation and invoicing highlights", lines: [
        "- Found and fixed a duplicate supplier payment of AUD 12,400 during a weekly bank reconciliation and recovered the funds.",
        "- Built an Excel ageing report with XLOOKUP and pivot tables that the Finance Manager now uses in the monthly review.",
        "- Helped prepare GST working papers for four quarterly returns.",
      ] },
      { heading: "Education", lines: [
        "Diploma of Accounting - fictional institute, Sydney | 2022",
        "ACCA - Applied Knowledge exams passed (3 of 3); Applied Skills in progress",
      ] },
      { heading: "Skills", lines: [
        "Xero (daily use), MYOB (basic), Microsoft Excel (XLOOKUP, pivot tables, SUMIFS), double-entry bookkeeping, AP and AR, bank reconciliations, GST working papers, document management.",
        "Not yet: payroll processing or preparing a full month-end closing pack on my own.",
      ] },
    ],
  },
];

export function sampleJobById(id: string | null | undefined): SampleJobDescription | null {
  return SAMPLE_JOB_DESCRIPTIONS.find((job) => job.id === id) ?? null;
}

export function sampleResumeById(id: string | null | undefined): SampleResume | null {
  return SAMPLE_RESUMES.find((resume) => resume.id === id) ?? null;
}

/** The sample resume written for a sample JD, or null for a custom role. */
export function recommendedSampleResumeFor(sampleJobId: string | null | undefined): SampleResume | null {
  return sampleResumeById(sampleJobById(sampleJobId)?.matchingResumeId);
}

/** The resume as plain text, in the same order as the PDF. */
export function sampleResumeText(resume: SampleResume): string {
  const { candidate } = resume;
  const header = [candidate.name, candidate.headline, `${candidate.location} | ${candidate.email} | ${candidate.phone}`, "SAMPLE RESUME - fictional candidate created for Smile Recruitment Portal demonstrations."];
  return [...header, ...resume.sections.flatMap((section) => ["", section.heading.toUpperCase(), ...section.lines])].join("\n");
}
