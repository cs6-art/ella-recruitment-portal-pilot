import Link from "next/link";

export const metadata = { title: "Privacy Policy" };

// Plain-language notice linked from the application form. It describes what the
// portal actually does today; have it reviewed by your legal advisers before launch.
export default function PrivacyNoticePage() {
  return (
    <main className="container page" style={{ maxWidth: 760 }}>
      <h1>Privacy Policy</h1>
      <p><strong>Last updated: 8 October 2026</strong></p>
      <p>This policy explains how information is handled in the Smile Recruitment Portal (smile.mclinkgroup.com), operated by MPS Solutions Pte Ltd. It covers people who apply for a role (Part 1) and recruiters who use the portal and connect Google services (Part 2).</p>

      <h2>Part 1: Applicants</h2>

      <h3>What we collect</h3>
      <ul>
        <li>The details you enter: your name, email address, contact number and country.</li>
        <li>Your resume or CV, and the text extracted from it.</li>
        <li>Results of the screening and interviews: scores, summaries and the recruiter&apos;s decisions.</li>
        <li>If you take an AI interview: a transcript of the conversation and a video and audio recording. The interview page asks for your agreement to the recording, camera and microphone before it starts.</li>
        <li>If you take a phone interview: the name, email address and phone number taken from your application, and the call report returned to us by Vapi, including the transcript.</li>
      </ul>

      <h3>How we use it</h3>
      <ul>
        <li>To assess your suitability for the role you applied for, and to contact you about it, including by email and phone.</li>
        <li>Artificial intelligence helps to read resumes and to run and summarise interviews. Its output is a recommendation only: a member of the recruitment team reviews it and makes every hiring decision.</li>
        <li>We do not use your name, age, gender, ethnicity, religion, accent, appearance or similar personal characteristics to score you.</li>
        <li>We use Vapi for phone interviews, and Vapi acts as our data processor. Vapi&apos;s privacy policy allows it to use call data to help train its AI models, and we are confirming with Vapi that data processed for us is excluded from that.</li>
      </ul>

      <h3>Who can see it</h3>
      <p>The recruitment team of the organization you applied to. To provide the service, your information is processed by trusted providers acting for us: our hosting provider (Vercel), our database provider (Neon), our workflow automation service (n8n), Google (storage, calendar and email), our AI provider (OpenAI), our phone interview provider (Vapi), and our video interview provider (LiveAvatar, provided by HeyGen).</p>

      <h3>How long we keep it</h3>
      <ul>
        <li>Resume files stored by the portal are deleted 30 days after upload.</li>
        <li>Interview recordings are deleted once they are older than the period your organization sets in Settings. The period can be between 7 and 365 days. Where your organization has not set one, the platform default of 90 days applies.</li>
        <li>Your application record, interview transcripts, phone call reports and results are kept while the organization needs them for this recruitment, and are removed when the organization deletes your application.</li>
      </ul>

      <h3>Your choices</h3>
      <p>You may ask to see, correct or delete your information, or withdraw your consent, by contacting the organization you applied to, or by emailing cs6@mclinkgroup.com. If you do not agree to the recording on the interview page, the interview does not start; you can ask the recruitment team about another way to be interviewed.</p>

      <h2>Part 2: Google user data (recruiters and organization staff)</h2>
      <p>Recruiters can optionally connect a Google account so the portal can work with their Google services. Connecting is always a choice, and you can disconnect at any time.</p>

      <h3>What we access and why</h3>
      <ul>
        <li><strong>Your Google email address</strong> (userinfo.email): to show which Google account is connected.</li>
        <li><strong>Google Calendar</strong> (calendar.events, calendar.events.freebusy): to read when you are free or busy and to create, update and cancel interview events on your calendar.</li>
        <li><strong>Google Drive</strong> (drive.file): to read only the resume files you select in the Google file chooser, and to store and read files the portal itself creates, such as interview recordings. The portal cannot see or list any other file in your Drive.</li>
      </ul>
      <p>The portal does not ask you for access to Google Sheets or to any other Google service. Recruitment records that the portal keeps in spreadsheets are written by the portal&apos;s own service account to spreadsheets we own, not to your Google account.</p>

      <h3>How we use and protect it</h3>
      <ul>
        <li>Google data is used only to provide these features inside the portal. We do not sell it, use it for advertising, or transfer it to others except to provide the service.</li>
        <li>Humans at the organization see only what the connected features display to them. We do not use Google user data to develop, improve or train generalized AI or machine-learning models.</li>
        <li>Access tokens are stored encrypted on our servers and are used only for the actions above.</li>
        <li>The portal&apos;s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</li>
      </ul>

      <h3>How we protect Google user data</h3>
      <ul>
        <li><strong>Encryption in transit:</strong> all traffic between your browser, the portal and Google APIs uses HTTPS (TLS).</li>
        <li><strong>Encryption at rest:</strong> Google OAuth access and refresh tokens are encrypted before they are stored. Resume files and interview recordings are held in access-controlled storage.</li>
        <li><strong>Least privilege:</strong> we request the narrowest scopes that make each feature work. For Drive this is <code>drive.file</code>, which only reaches files you pick in the Google file chooser; we cannot list or search the rest of your Drive.</li>
        <li><strong>Access control:</strong> data is separated by organization, and every request is checked against the signed-in user&apos;s role and organization. Staff of the organization see only what the portal screens display to them. Our own engineers do not browse Google user data, and any support access is limited, logged and only for resolving your request.</li>
        <li><strong>Secrets handling:</strong> tokens and API keys are kept in server-side configuration, never in the browser or in source code.</li>
        <li><strong>Minimal retention:</strong> resume files stored by the portal are deleted 30 days after upload. Connection tokens are deleted as described under Retention and deletion below.</li>
        <li><strong>Incident response:</strong> if we become aware of unauthorized access to Google user data, we will investigate promptly, contain it, and notify affected users and organizations as required by law.</li>
      </ul>

      <h3>Use of AI with Google user data</h3>
      <ul>
        <li>When you select resumes from Google Drive for screening, the text of those files is sent to the OpenAI API (model gpt-4.1-mini) through our workflow automation service, n8n, solely to extract and score the resume for the role. Interview transcripts are analysed in the same way using the OpenAI API (model gpt-4o-mini by default). Interview video and audio are handled by our live-interview provider (LiveAvatar). That provider does not receive Google user data other than what the interview itself contains. Phone interviews are placed by Vapi, which receives the name, email address and phone number recorded on the application, along with the role details and interview questions it needs to run the call. For resumes imported from Google Drive, our workflow automation (n8n) takes the phone number and email address from the resume text and the name from the file name when it creates the application.</li>
        <li>For OpenAI and LiveAvatar, we use the providers under their business terms, under which data sent through the API is not used to train or improve their models. We do not enable any setting that allows training on this data. Vapi&apos;s terms are different, as described in Part 1 and above.</li>
        <li>We do not use Google user data, including raw, aggregated or derived data, to create, train or improve any generalized or foundational AI or machine-learning model ourselves. Phone interviews are the exception to the no-third-party rule: the name, email address and phone number recorded on an application imported from Google Drive are passed to Vapi. Vapi&apos;s privacy policy allows training on call data, and we are confirming with Vapi that this data is excluded. This statement will be updated when that is confirmed.</li>
        <li>We do not self-host these models. Data sent to the AI providers is limited to what is needed for the single task, and is not shared with any other third party.</li>
        <li>AI output is a recommendation only; a person at the organization reviews it and makes every hiring decision.</li>
      </ul>

      <h3>Payments</h3>
      <p>When an organization buys Smile Credits, payment is taken on the hosted checkout page of our payment provider, HitPay. Card details are entered there, and we do not receive or store them.</p>

      <h3>Retention and deletion</h3>
      <ul>
        <li><strong>Drive connection for resumes:</strong> deleted when you disconnect. Reconnecting replaces the stored connection with the new one.</li>
        <li><strong>Calendar connection:</strong> deleted when you disconnect.</li>
        <li><strong>Recording folder connection (organization-level):</strong> kept only while interview recordings saved with that Google account still exist. It is removed once those recordings are deleted under the retention period, or when the organization connects a different Google account and no recordings still use the old one.</li>
      </ul>
      <p>You can also revoke access at any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>. To ask us to delete data we hold, email cs6@mclinkgroup.com or contact your organization&apos;s administrator.</p>

      <h2>Contact</h2>
      <p>
        MPS Solutions Pte Ltd<br />
        51 Ubi Ave 1, #05-11 Paya Ubi Industrial Park, Singapore 408933<br />
        Email: <a href="mailto:cs6@mclinkgroup.com">cs6@mclinkgroup.com</a>
      </p>

      <p><Link className="btn btn-primary" href="/">Back to the portal</Link></p>
    </main>
  );
}
