import Link from "next/link";

export const metadata = { title: "Terms of Service" };

// Plain-language terms for the Smile Recruitment Portal. Have them reviewed by
// your legal advisers before launch.
export default function TermsOfServicePage() {
  return (
    <main className="container page" style={{ maxWidth: 760 }}>
      <h1>Terms of Service</h1>
      <p>These terms apply to your use of the Smile Recruitment Portal (smile.mclinkgroup.com), operated by MPS Solutions Pte Ltd. By registering or logging in you agree to them.</p>

      <h2>The service</h2>
      <p>Smile helps organizations create role requests, screen candidates and run AI-assisted interviews. AI output is a recommendation only. The organization&apos;s recruitment team is responsible for every hiring decision.</p>

      <h2>Accounts</h2>
      <ul>
        <li>Register with your work email address and keep your login details confidential.</li>
        <li>You are responsible for activity under your account and for the accuracy of what you enter.</li>
        <li>Accounts belong to an organization. The organization&apos;s owner and administrators manage who has access.</li>
      </ul>

      <h2>Acceptable use</h2>
      <ul>
        <li>Use the portal only for lawful recruitment purposes.</li>
        <li>Do not discriminate against candidates on the basis of protected characteristics, and do not upload information you have no right to use.</li>
        <li>Do not attempt to disrupt, probe or gain unauthorized access to the portal or other users&apos; data.</li>
      </ul>

      <h2>Candidate data</h2>
      <p>The organization is responsible for the candidate information it collects and for having a lawful basis to process it. See our <Link href="/privacy">Privacy Policy</Link> for how data is handled.</p>

      <h2>Google and other connected services</h2>
      <p>Connecting a Google account is optional and governed by Part 2 of the <Link href="/privacy">Privacy Policy</Link>. You can disconnect at any time.</p>

      <h2>Credits and payments</h2>
      <p>Some features use credits, which are shared by the organization. Prices and how credits are used are shown in the portal when you buy or use them.</p>

      <h2>Availability and liability</h2>
      <p>The service is provided as is. We aim to keep it available but do not guarantee uninterrupted access. To the extent permitted by law, we are not liable for indirect or consequential loss arising from use of the portal.</p>

      <h2>Changes and contact</h2>
      <p>We may update these terms and will post the current version on this page. Questions can be sent to McLink support.</p>

      <p><Link href="/">Back to the portal</Link></p>
    </main>
  );
}
