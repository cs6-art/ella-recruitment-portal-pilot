import { cookies } from "next/headers";
import type { Metadata } from "next";
import "./globals.css";
import PortalBrandingProvider from "@/components/PortalBrandingContext";
import { getOrganizationBranding } from "@/lib/organization-branding";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recruitment Portal",
  description: "Role-first recruitment request and approval portal",
};

// Applies the saved sidebar-collapsed preference before first paint so the
// sidebar does not flash open then collapse. Kept as a plain inline <script>
// at the top of <body> — a <script> directly under <html> is invalid HTML and
// triggers a hydration error in Next 16.
const sidebarPreferenceScript = `try { if (window.localStorage.getItem("mclink.sidebar.collapsed") === "true") document.documentElement.dataset.sidebarCollapsed = "true"; } catch (_) {}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <RootLayoutContent>{children}</RootLayoutContent>;
}

async function RootLayoutContent({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const user = verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
  let initialBranding = { name: "Recruitment Portal", subtitle: "" };
  if (user) {
    try {
      initialBranding = await getOrganizationBranding(user.organizationId);
    } catch {
      // The login page and shell remain usable if branding storage is unavailable.
    }
  }

  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: sidebarPreferenceScript }} />
        <PortalBrandingProvider initialBranding={initialBranding}>{children}</PortalBrandingProvider>
      </body>
    </html>
  );
}
