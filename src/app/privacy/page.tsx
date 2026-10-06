import Link from "next/link";

export const metadata = { title: "Privacy Policy" };

// Plain-language notice linked from the application form. It describes what the
// portal actually does today; have it reviewed by your legal advisers before launch.
export default function PrivacyNoticePage() {
  return (
    <main className="container page" style={{ maxWidth: 760 }}>
      <h1>Privacy Policy</h1>
      <p>This policy explains how information is handled in the Smile Recruitment Portal (smile.mclinkgroup.com), operated by MPS Solutions Pte Ltd. It covers people who apply for a role (Part 1) and recruiters who use the portal and connect Google services (Part 2).</p>

      <h2>Part 1: Applicants</h2>

      <h3>What we collect</h3>
      <ul>
        <li>The details you enter: your name, email address, contact number and country.</li>
        <li>Your resume or CV, and the text extracted from it.</li>
        <li>Results of the screening and interviews: scores, summaries and the recruiter&apos;s decisions.</li>
        <li>If you take an AI interview: a transcript of the conversation and a video and audio recording. The interview page asks for your agreement to the recording, camera and microphone before it starts.</li>
      </ul>

      <h3>How we use it</h3>
      <ul>
        <li>To assess your suitability for the role you applied for, and to contact you about it, including by email and phone.</li>
        <li>Artificial intelligence helps to read resumes and to run and summarise interviews. Its output is a recommendation only: a member of the recruitment team reviews it and makes every hiring decision.</li>
        <li>We do not use your name, age, gender, ethnicity, religion, accent, appearance or similar personal characteristics to score you.</li>
      </ul>

      <h3>Who can see it</h3>
      <p>The recruitment team of the organization you applied to. To provide the service, your information is processed by trusted providers acting for us, such as our hosting and database provider, Google (storage, calendar and email), and the AI, voice and video interview providers we use.</p>

      <h3>How long we keep it</h3>
      <ul>
        <li>Resume files are deleted 30 days after upload.</li>
        <li>Interview recordings are deleted after 90 days unless the organization sets a different period.</li>
        <li>Your application record, transcript and results are kept while the organization needs them for this recruitment, and are removed when the organization deletes your application.</li>
      </ul>

      <h3>Your choices</h3>
      <p>You may ask to see, correct or delete your information, or withdraw your consent, by contacting the organization you applied to. If you do not agree to the recording on the interview page, the interview does not start; you can ask the recruitment team about another way to be interviewed.</p>

      <h2>Part 2: Google user data (recruiters and organization staff)</h2>
      <p>Recruiters can optionally connect a Google account so the portal can work with their Google services. Connecting is always a choice, and you can disconnect at any time.</p>

      <h3>What we access and why</h3>
      <ul>
        <li><strong>Your Google email address</strong> (userinfo.email): to show which Google account is connected.</li>
        <li><strong>Google Calendar</strong> (calendar.events, calendar.freebusy): to read when you are free or busy and to create, update and cancel interview events on your calendar.</li>
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
        <li><strong>Minimal retention:</strong> resume files are deleted 30 days after upload, and tokens are deleted when you disconnect.</li>
        <li><strong>Incident response:</strong> if we become aware of unauthorized access to Google user data, we will investigate promptly, contain it, and notify affected users and organizations as required by law.</li>
      </ul>

      <h3>Use of AI with Google user data</h3>
      <ul>
        <li>When you select resumes from Google Drive for screening, the text of those files is sent to OpenAI (API, gpt-5-mini) solely to extract and score the resume for the role. Interview transcripts are analysed in the same way using the OpenAI API. Interview video and audio are handled by our live-interview provider (LiveAvatar). That provider does not receive Google user data other than what the interview itself contains.</li>
        <li>We use these providers under their business API terms. Under those terms, data sent through the API is not used to train or improve their models. We do not enable any setting that allows training on this data.</li>
        <li>We do not use Google user data, including raw, aggregated or derived data, to create, train or improve any generalized or foundational AI or machine-learning model, and we do not allow any third party to do so.</li>
        <li>We do not self-host these models. Data sent to the AI providers is limited to what is needed for the single task, and is not shared with any other third party.</li>
        <li>AI output is a recommendation only; a person at the organization reviews it and makes every hiring decision.</li>
      </ul>

      <h3>Retention and deletion</h3>
      <p>Connection tokens are kept until you disconnect the Google account or your portal account is removed, and are then deleted. You can also revoke access at any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>. To ask us to delete data we hold, contact your organization&apos;s administrator or McLink support.</p>

      <p><Link href="/">Back to the portal</Link></p>
    </main>
  );
}
