import Link from "next/link";

export const metadata = { title: "Privacy Notice" };

// Plain-language notice linked from the application form. It describes what the
// portal actually does today; have it reviewed by your legal advisers before launch.
export default function PrivacyNoticePage() {
  return (
    <main className="container page" style={{ maxWidth: 760 }}>
      <h1>Privacy Notice for Applicants</h1>
      <p>This notice explains how your information is handled when you apply for a role through the Smile Recruitment Portal.</p>

      <h2>What we collect</h2>
      <ul>
        <li>The details you enter: your name, email address, contact number and country.</li>
        <li>Your resume or CV, and the text extracted from it.</li>
        <li>Results of the screening and interviews: scores, summaries and the recruiter&apos;s decisions.</li>
        <li>If you take an AI interview: a transcript of the conversation and a video and audio recording. The interview page asks for your agreement to the recording, camera and microphone before it starts.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To assess your suitability for the role you applied for, and to contact you about it, including by email and phone.</li>
        <li>Artificial intelligence helps to read resumes and to run and summarise interviews. Its output is a recommendation only: a member of the recruitment team reviews it and makes every hiring decision.</li>
        <li>We do not use your name, age, gender, ethnicity, religion, accent, appearance or similar personal characteristics to score you.</li>
      </ul>

      <h2>Who can see it</h2>
      <p>The recruitment team of the organization you applied to. To provide the service, your information is processed by trusted providers acting for us, such as our hosting and database provider, Google (storage, calendar and email), and the AI, voice and video interview providers we use.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Resume files are deleted 30 days after upload.</li>
        <li>Interview recordings are deleted after 90 days unless the organization sets a different period.</li>
        <li>Your application record, transcript and results are kept while the organization needs them for this recruitment, and are removed when the organization deletes your application.</li>
      </ul>

      <h2>Your choices</h2>
      <p>You may ask to see, correct or delete your information, or withdraw your consent, by contacting the organization you applied to. If you do not agree to the recording on the interview page, the interview does not start; you can ask the recruitment team about another way to be interviewed.</p>

      <p><Link href="/">Back to the portal</Link></p>
    </main>
  );
}
