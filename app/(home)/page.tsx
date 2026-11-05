import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { Logo } from "@/components/bits";
import { Icon } from "@/components/icons";
import { LanguagePicker } from "@/components/language-picker";
import { MapLink } from "@/components/map-link";
import { SamplePhoto } from "@/components/sample-photo";
import { db } from "@/db";
import { leadSourceEnum, projects } from "@/db/schema";
import { STRINGS } from "@/lib/i18n";
import { getLanguage } from "@/lib/language";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: STRINGS[await getLanguage()].homeMetaTitle,
    description: "2 and 3 BHK homes in Ahmedabad. Ask a question or book a site visit at any hour.",
  };
}

const source = z.enum(leadSourceEnum.enumValues).catch("website");

// 85% white and 90% deep green keep AA text over any pixel of the photo, even with no blur.
const glass = "rounded-2xl bg-white/85 p-4 shadow-soft ring-1 ring-white/60 backdrop-blur-md";

export default async function Home({ searchParams }: { searchParams: Promise<{ src?: string }> }) {
  const language = await getLanguage();
  const t = STRINGS[language];
  const src = source.parse((await searchParams).src);
  const rows = await db.select().from(projects).orderBy(asc(projects.id));

  return (
    <div lang={language} className="mx-auto max-w-7xl px-4 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-4">
        <Logo />
        <LanguagePicker current={language} />
      </header>

      <main>
        <h1 className="max-w-3xl pt-3 pb-7 font-serif text-4xl leading-tight sm:text-5xl sm:leading-tight">{t.homeTitle}</h1>

        {rows.length === 0 && <p className="pb-20 text-muted">{t.noProjects}</p>}

        {rows.map((project, index) => (
          <section key={project.id} aria-labelledby={`project-${project.id}`} className="relative mb-8 lg:min-h-[35rem]">
            <div className="relative h-72 overflow-hidden rounded-3xl bg-line lg:absolute lg:inset-0 lg:h-auto">
              <SamplePhoto index={index} alt={t.illustration} caption={t.samplePhoto} priority={index === 0} />
            </div>

            {/* Over the photo on a large screen. On a phone they overlap its lower edge, then stack below it. */}
            <div className={`relative -mt-12 grid gap-3 px-3 lg:absolute lg:inset-x-6 lg:bottom-6 lg:mt-0 lg:grid-cols-[minmax(0,26rem)_minmax(0,22rem)] lg:items-end lg:justify-between lg:px-0 ${index % 2 ? "lg:[direction:rtl] lg:*:[direction:ltr]" : ""}`}>
              <div className="on-dark rounded-3xl bg-neem-dark/90 p-6 text-white shadow-soft backdrop-blur-md">
                <h2 id={`project-${project.id}`} className="font-serif text-4xl">
                  {project.name}
                </h2>
                <p className="mt-3 text-sm text-white/90">{t.exactPriceNote}</p>
                <Link
                  href={`/chat?project=${project.slug}&src=${src}`}
                  className="mt-5 flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-center font-medium text-neem-dark hover:bg-neem-soft"
                >
                  <Icon name="chat" />
                  {t.askOrBook}
                </Link>
              </div>

              <dl className="grid grid-cols-2 gap-3">
                <div className={glass}>
                  <dt className="text-sm">{t.homesLabel}</dt>
                  <dd className="mt-1 text-lg font-semibold">{project.homes}</dd>
                </div>
                <div className={glass}>
                  <dt className="text-sm">{t.priceLabel}</dt>
                  <dd className="mt-1 text-lg font-semibold">{project.priceRange.replace(/\blakh\b/gi, t.lakh).replace(/\bcrore\b/gi, t.crore)}</dd>
                </div>
                <div className={`col-span-2 ${glass}`}>
                  <dt className="text-sm">{t.locationLabel}</dt>
                  <dd className="mt-1 font-medium">
                    {project.locationLabel}
                    <span className="block">
                      <MapLink url={project.mapUrl} label={t.directions} />
                    </span>
                  </dd>
                </div>
                <div className={`col-span-2 ${glass}`}>
                  <dt className="text-sm">{t.rera}</dt>
                  <dd className="mt-1 font-medium break-words">{project.reraNumber}</dd>
                </div>
              </dl>
            </div>
          </section>
        ))}
      </main>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line py-6 text-sm text-muted">
        <Link href="/visit" className="inline-flex min-h-11 items-center underline underline-offset-4">
          {t.myVisit}
        </Link>
        <Link href="/sign-in" className="inline-flex min-h-11 items-center underline underline-offset-4">
          {t.staffSignIn}
        </Link>
      </footer>
    </div>
  );
}
