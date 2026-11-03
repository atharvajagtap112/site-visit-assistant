"use client";

import { useRouter } from "next/navigation";
import { LANGUAGE_NAMES, LANGUAGES, type Language } from "@/lib/i18n";

/** Saved in a readable cookie, because the server needs it to pick the page's language. */
export function LanguagePicker({ current }: { current: Language }) {
  const router = useRouter();

  function choose(language: Language) {
    document.cookie = `lang=${language}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div role="group" aria-label="Language" className="flex gap-1 text-sm">
      {LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          lang={language}
          aria-pressed={language === current}
          onClick={() => choose(language)}
          className={`rounded px-2.5 py-2 ${language === current ? "bg-neem-soft font-medium text-neem" : "text-muted hover:text-ink"}`}
        >
          {LANGUAGE_NAMES[language]}
        </button>
      ))}
    </div>
  );
}
