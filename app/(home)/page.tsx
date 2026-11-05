import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { LanguagePicker } from "@/components/language-picker";
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

// ponytail: sample photos of other buildings until the client supplies its own, so each is labelled
// as a sample. RERA rules out implying that a photo shows the registered project.
const PHOTOS = [
  {
    src: "/images/project-1.jpg",
    position: "50% 42%",
    credit: "Nikhilb239, CC BY 3.0, cropped",
    url: "https://commons.wikimedia.org/wiki/File:Residential_Building,_Hyderabad,_20022015.jpg",
  },
  {
    src: "/images/project-2.jpg",
    position: "50% 55%",
    credit: "Sanfy, CC BY-SA 4.0, cropped",
    url: "https://commons.wikimedia.org/wiki/File:Tower_blocks_in_Mira_Road.jpg",
  },
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
            <figure>
              <div className="relative h-56 overflow-hidden bg-line sm:h-80">
                <Image
                  src={PHOTOS[index % PHOTOS.length].src}
                  alt={t.illustration}
                  fill
                  sizes="100vw"
                  priority={index === 0}
                  className="object-cover"
                  style={{ objectPosition: PHOTOS[index % PHOTOS.length].position }}
                />
              </div>
              <figcaption className="mx-auto max-w-6xl px-5 pt-2 text-sm text-muted sm:px-8">
                {t.samplePhoto}{" "}
                <a href={PHOTOS[index % PHOTOS.length].url} lang="en" className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-0">
                  Photo: {PHOTOS[index % PHOTOS.length].credit}
                </a>
              </figcaption>
            </figure>
            <div className="mx-auto grid max-w-6xl gap-6 px-5 pt-8 sm:px-8 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <h2 id={`project-${project.id}`} className="font-serif text-3xl sm:text-4xl">
                  {project.name}
                </h2>
                <p className="mt-3 text-lg">{project.homes}</p>
                <p className="mt-1 text-lg tabular-nums">{project.priceRange.replace(/\blakh\b/gi, t.lakh).replace(/\bcrore\b/gi, t.crore)}</p>
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
