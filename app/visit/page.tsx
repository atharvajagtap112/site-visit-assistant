import type { Metadata } from "next";
import Link from "next/link";
import { LanguagePicker } from "@/components/language-picker";
import { MapLink } from "@/components/map-link";
import { PhoneSignIn } from "@/components/phone-sign-in";
import { primaryButton } from "@/components/ui";
import { BookAgain, OptOut, VisitActions } from "@/components/visit-actions";
import { getBuyerState } from "@/lib/buyer";
import { getConversation } from "@/lib/buyer-session";
import { formatVisitTime } from "@/lib/format";
import { STRINGS } from "@/lib/i18n";
import { getLanguage } from "@/lib/language";

export const metadata: Metadata = { title: "My visit | Company A Homes", robots: "noindex" };

export default async function VisitPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const language = await getLanguage();
  const t = STRINGS[language];
  const { done } = await searchParams;

  const conversation = await getConversation();
  const state = conversation ? await getBuyerState(conversation.leadId) : null;
  const visit = state?.visit;
  const isPast = visit ? visit.startsAt <= new Date() : false;
  const notices: Record<string, string> = { changed: t.visitChanged, cancelled: t.visitCancelled, booked: t.visitBooked };
  const notice = done && Object.hasOwn(notices, done) ? notices[done] : null;

  return (
    <div lang={language} className="mx-auto min-h-dvh max-w-2xl px-5 py-5 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="font-serif text-lg whitespace-nowrap sm:text-xl">
          Company A Homes
        </Link>
        <LanguagePicker current={language} />
      </header>

      <main className="pt-10 pb-16">
        <h1 className="font-serif text-4xl">{t.visitTitle}</h1>

        {notice && (
          <p role="status" className="mt-4 rounded-md bg-neem-soft px-3 py-2">
            {notice}
          </p>
        )}

        {visit ? (
          <>
            <p className="mt-8 font-serif text-3xl tabular-nums">{formatVisitTime(visit.startsAt)}</p>
            <p className="mt-3 text-lg">{visit.project}</p>
            <p className="mt-1">{visit.locationLabel}</p>
            <div className="mt-1">
              <MapLink url={visit.mapUrl} label={t.directions} />
            </div>
            <p className="mt-2 text-sm text-muted">
              {t.rera}: {visit.reraNumber}
            </p>
            {state.executive && (
              <p className="mt-4">
                {state.executive} {t.contactTitle}
              </p>
            )}

            {isPast ? (
              <>
                <p className="mt-8 rounded-md bg-amber-soft px-3 py-2 text-amber">{t.visitPastNote}</p>
                <div className="mt-5">
                  <BookAgain language={language} project={visit.slug} />
                </div>
              </>
            ) : (
              <>
                <section className="mt-8">
                  <h2 className="font-medium">{t.remindersTitle}</h2>
                  {state.reminders.length ? (
                    <ul className="mt-1 text-muted">
                      {state.reminders.includes("reminder_1d") && <li>{t.reminder1d}</li>}
                      {state.reminders.includes("reminder_2h") && <li>{t.reminder2h}</li>}
                    </ul>
                  ) : (
                    <p className="mt-1 text-muted">{t.noReminders}</p>
                  )}
                </section>
                <div className="mt-8">
                  <VisitActions language={language} project={visit.slug} />
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <p className="mt-6 text-lg">{t.noVisit}</p>
            <Link href="/chat" className={`mt-5 inline-block ${primaryButton}`}>
              {t.bookVisit}
            </Link>
            {!state?.hasContact && <PhoneSignIn language={language} />}
          </>
        )}

        {state?.hasContact &&
          (state.optedOutAt ? (
            <p className="mt-10 border-t border-line pt-6 text-muted">{t.optedOut}</p>
          ) : (
            <OptOut language={language} />
          ))}
      </main>
    </div>
  );
}
