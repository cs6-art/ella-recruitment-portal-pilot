import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import ManualMarkdown from "@/components/ManualMarkdown";
import ManualViewer from "@/components/ManualViewer";
import PageHeader from "@/components/ui/PageHeader";
import { loadManual } from "@/lib/manual";
import { resolveManualTutorials } from "@/lib/manual-tutorials";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Explore Manual" };

/** Every signed-in person can read the manual; it contains no organization data. */
export default async function ManualPage() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");

  const manual = loadManual();
  const tutorials = resolveManualTutorials(manual.sections);

  return (
    <main className="container page">
      <PageHeader
        eyebrow="HELP"
        title="Explore Manual"
        description="Learn how to use the Recruitment Portal, step by step. Watch a topic walkthrough, or search the manual for what you need."
      />
      <ManualViewer
        intro={manual.intro ? <ManualMarkdown>{manual.intro}</ManualMarkdown> : null}
        sections={manual.sections.map((section) => ({
          id: section.id,
          title: section.title,
          searchText: section.searchText,
          tutorial: tutorials.get(section.id),
          content: <ManualMarkdown>{section.body}</ManualMarkdown>,
        }))}
      />
    </main>
  );
}
