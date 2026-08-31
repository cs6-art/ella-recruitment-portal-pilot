import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "McLink Recruitment Portal",
  description: "Role-first recruitment request and approval portal",
};

// Applies the saved sidebar-collapsed preference before first paint so the
// sidebar does not flash open then collapse. Kept as a plain inline <script>
// at the top of <body> — a <script> directly under <html> is invalid HTML and
// triggers a hydration error in Next 16.
const sidebarPreferenceScript = `try { if (window.localStorage.getItem("mclink.sidebar.collapsed") === "true") document.documentElement.dataset.sidebarCollapsed = "true"; } catch (_) {}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: sidebarPreferenceScript }} />
        {children}
      </body>
    </html>
  );
}
