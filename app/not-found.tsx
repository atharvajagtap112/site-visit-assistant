import Link from "next/link";
import { primaryButton } from "@/components/ui";
import { STRINGS } from "@/lib/i18n";
import { getLanguage } from "@/lib/language";
import { getCurrentUser } from "@/lib/session";

export default async function NotFound() {
  // A wrong address should still get this page while the database is down.
  const user = await getCurrentUser().catch(() => null);
  const language = user ? "en" : await getLanguage();
  const t = STRINGS[language];
  return (
    <main lang={language} className="mx-auto max-w-md px-6 py-24">
      <h1 className="font-serif text-4xl">{t.notFoundTitle}</h1>
      <p className="mt-3 text-muted">{t.notFoundHelp}</p>
      <Link href={user ? "/leads" : "/"} className={`mt-6 inline-block ${primaryButton}`}>
        {user ? "Back to leads" : t.goHome}
      </Link>
    </main>
  );
}
