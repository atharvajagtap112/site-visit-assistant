"use client";

import { useRouter } from "next/navigation";
import { LANGUAGE_NAMES, LANGUAGES, STRINGS, type Language } from "@/lib/i18n";

/** Saved in a readable cookie, because the server needs it to pick the page's language. */
export function LanguagePicker({ current }: { current: Language }) {
  const router = useRouter();

  function choose(language: Language) {
    document.cookie = `lang=${language}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div role="group" aria-label={STRINGS[current].languageLabel} className="flex gap-0.5 rounded-full bg-white p-0.5 text-sm ring-1 ring-line">
      {LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          lang={language}
          aria-pressed={language === current}
          onClick={() => choose(language)}
          className={`min-h-11 rounded-full px-3 ${language === current ? "bg-neem font-medium text-white" : "text-muted hover:text-ink"}`}
        >
          {LANGUAGE_NAMES[language]}
        </button>
      ))}
    </div>
  );
}
