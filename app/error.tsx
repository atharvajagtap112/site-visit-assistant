"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { primaryButton } from "@/components/ui";
import { LANGUAGES, STRINGS, type Language } from "@/lib/i18n";

const STAFF_PATHS = /^\/(leads|dashboard|admin|sign-in)/;
const noSubscribe = () => () => {};
const cookieLanguage = (): Language => LANGUAGES.find((l) => l === /(?:^|; )lang=(\w+)/.exec(document.cookie)?.[1]) ?? "en";

export default function ErrorPage({ retry }: { retry: () => void }) {
  const isStaff = STAFF_PATHS.test(usePathname());
  const buyerLanguage = useSyncExternalStore(noSubscribe, cookieLanguage, (): Language => "en");
  const language = isStaff ? "en" : buyerLanguage;
  const t = STRINGS[language];

  return (
    <main lang={language} className="mx-auto mt-16 max-w-md rounded-3xl bg-white p-8 shadow-soft max-sm:mx-4">
      <h1 className="font-serif text-3xl">{t.errorTitle}</h1>
      <p role="alert" className="mt-3 text-muted">
        {t.errorHelp}
      </p>
      <button type="button" onClick={() => retry()} className={`mt-6 ${primaryButton}`}>
        {t.retry}
      </button>
    </main>
  );
}
