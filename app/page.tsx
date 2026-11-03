import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { Elevation, Tower } from "@/components/elevation";
import { LanguagePicker } from "@/components/language-picker";
import { db } from "@/db";
import { leadSourceEnum, projects } from "@/db/schema";
import { STRINGS } from "@/lib/i18n";
import { getLanguage } from "@/lib/language";

export const metadata: Metadata = {
  title: "Homes in Ahmedabad | Company A Homes",
  description: "2 and 3 BHK homes in Ahmedabad. Ask a question or book a site visit at any hour.",
};

// Each project gets its own drawing until the client supplies photography. The panel crops from
// the top, so the lit home sits in the lower floors, which show at every screen width.
const DRAWINGS = [
  [
    { x: 150, floors: 17, cols: 6, lit: [14, 3] as [number, number] },
    { x: 410, floors: 12, cols: 6 },
  ],
  [
    { x: 60, floors: 10, cols: 5 },
    { x: 260, floors: 15, cols: 5, lit: [12, 1] as [number, number] },
    { x: 460, floors: 10, cols: 5 },
  ],
];

const source = z.enum(leadSourceEnum.enumValues).catch("website");

export default async function Home({ searchParams }: { searchParams: Promise<{ src?: string }> }) {
  const language = await getLanguage();
  const t = STRINGS[language];
  const src = source.parse((await searchParams).src);
  const rows = await db.select().from(projects).orderBy(asc(projects.id));

  return (
    <div lang={language}>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <p className="font-serif text-lg whitespace-nowrap sm:text-xl">Company A Homes</p>
        <LanguagePicker current={language} />
      </header>

      <main>
        <h1 className="mx-auto max-w-6xl px-5 pt-4 pb-8 font-serif text-4xl leading-tight sm:px-8 sm:text-5xl">
          {t.homeTitle}
        </h1>

        {rows.length === 0 && (
          <p className="mx-auto max-w-6xl px-5 pb-20 text-muted sm:px-8">{t.noProjects}</p>
        )}

        {rows.map((project, index) => (
          <section key={project.id} aria-labelledby={`project-${project.id}`} className="mb-20">
            <div className="relative h-56 overflow-hidden bg-neem sm:h-72" role="img" aria-label={t.illustration}>
              <Elevation>
                {DRAWINGS[index % DRAWINGS.length].map((tower) => (
                  <Tower key={tower.x} {...tower} />
                ))}
              </Elevation>
            </div>
            <div className="mx-auto grid max-w-6xl gap-6 px-5 pt-8 sm:px-8 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <h2 id={`project-${project.id}`} className="font-serif text-3xl sm:text-4xl">
                  {project.name}
                </h2>
                <p className="mt-3 text-lg">{project.homes}</p>
                <p className="mt-1 text-lg tabular-nums">{project.priceRange}</p>
                <p className="mt-3 text-sm text-muted">{t.exactPriceNote}</p>
                <p className="mt-1 text-sm text-muted">
                  {t.rera}: {project.reraNumber}
                </p>
              </div>
              <Link
                href={`/chat?project=${project.slug}&src=${src}`}
                className="block rounded-md bg-neem px-6 py-4 text-center font-medium text-white hover:bg-neem-dark"
              >
                {t.askOrBook}
              </Link>
            </div>
          </section>
        ))}
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 border-t border-line px-5 py-8 text-sm text-muted sm:px-8">
        <Link href="/visit" className="underline underline-offset-4">
          {t.myVisit}
        </Link>
        <Link href="/sign-in" className="underline underline-offset-4">
          {t.staffSignIn}
        </Link>
      </footer>
    </div>
  );
}
