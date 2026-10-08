import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import ManualMarkdown from "@/components/ManualMarkdown";
import ManualVideo from "@/components/ManualVideo";
import ManualViewer from "@/components/ManualViewer";
import PageHeader from "@/components/ui/PageHeader";
import { loadManual } from "@/lib/manual";
import { resolveManualVideo } from "@/lib/manual-video";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Explore Manual" };

/** Every signed-in person can read the manual; it contains no organization data. */
export default async function ManualPage() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");

  const manual = loadManual();
  const video = resolveManualVideo(process.env.MANUAL_VIDEO_URL);

  return (
    <main className="container page">
      <PageHeader
        eyebrow="HELP"
        title="Explore Manual"
        description="Learn how to use the Recruitment Portal, step by step. Watch the tutorial video, then pick a topic or search for what you need."
      />
      <ManualViewer
        video={<ManualVideo video={video} />}
        intro={manual.intro ? <ManualMarkdown>{manual.intro}</ManualMarkdown> : null}
        sections={manual.sections.map((section) => ({
          id: section.id,
          title: section.title,
          searchText: section.searchText,
          content: <ManualMarkdown>{section.body}</ManualMarkdown>,
        }))}
      />
    </main>
  );
}
