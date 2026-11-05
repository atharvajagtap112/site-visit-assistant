import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/bits";
import { Icon } from "@/components/icons";
import { LanguagePicker } from "@/components/language-picker";
import { MapLink } from "@/components/map-link";
import { PhoneSignIn } from "@/components/phone-sign-in";
import { card, primaryButton } from "@/components/ui";
import { BookAgain, OptOut, VisitActions } from "@/components/visit-actions";
import { getBuyerState, showCodes } from "@/lib/buyer";
import { getConversation } from "@/lib/buyer-session";
import { formatVisitTime } from "@/lib/format";
import { STRINGS } from "@/lib/i18n";
import { getLanguage } from "@/lib/language";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${STRINGS[await getLanguage()].visitTitle} | Company A Homes`, robots: "noindex" };
}

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
    <div lang={language} className="mx-auto min-h-dvh max-w-2xl px-4 py-4 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Link href="/">
          <Logo />
        </Link>
        <LanguagePicker current={language} />
      </header>

      <main className="pt-8 pb-16">
        <h1 className="font-serif text-4xl">{t.visitTitle}</h1>

        {notice && (
          <p role="status" className="mt-4 flex items-center gap-2 rounded-2xl bg-neem-soft px-4 py-3 text-neem">
            <Icon name="check" />
            {notice}
          </p>
        )}

        {visit ? (
          <>
            <section className="on-dark mt-6 rounded-3xl bg-neem-dark p-6 text-white shadow-soft">
              <p className="flex items-start gap-3 font-serif text-3xl leading-tight">
                <Icon name="calendar" className="mt-1 size-7" />
                {formatVisitTime(visit.startsAt, language)}
              </p>
              <p className="mt-4 text-lg font-medium">{visit.project}</p>
              <p className="mt-1">{visit.locationLabel}</p>
              <p className="mt-1 text-sm text-white/90">
                {t.rera}: {visit.reraNumber}
              </p>
              <div className="mt-2 [&_a]:text-white">
                <MapLink url={visit.mapUrl} label={t.directions} />
              </div>
              {state.executive && (
                <p className="mt-3 border-t border-white/25 pt-3">
                  {state.executive} {t.contactTitle}
                </p>
              )}
            </section>

            {isPast ? (
              <>
                <p className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-soft px-4 py-3 text-amber">
                  <Icon name="alert" />
                  {t.visitPastNote}
                </p>
                <div className="mt-4">
                  <BookAgain language={language} project={visit.slug} showCodes={showCodes()} />
                </div>
              </>
            ) : (
              <>
                <section className={`mt-4 ${card}`}>
                  <h2 className="font-medium">{t.remindersTitle}</h2>
                  {state.reminders.length ? (
                    <ul className="mt-2 space-y-1 text-muted">
                      {state.reminders.includes("reminder_1d") && (
                        <li className="flex items-center gap-2">
                          <Icon name="clock" />
                          {t.reminder1d}
                        </li>
                      )}
                      {state.reminders.includes("reminder_2h") && (
                        <li className="flex items-center gap-2">
                          <Icon name="clock" />
                          {t.reminder2h}
                        </li>
                      )}
                    </ul>
                  ) : (
                    <p className="mt-1 text-muted">{t.noReminders}</p>
                  )}
                </section>
                <div className="mt-4">
                  <VisitActions language={language} project={visit.slug} showCodes={showCodes()} />
                </div>
              </>
            )}
          </>
        ) : (
          <div className={`mt-6 ${card}`}>
            <p className="text-lg">{t.noVisit}</p>
            <Link href="/chat" className={`mt-4 ${primaryButton}`}>
              {t.bookVisit}
            </Link>
            {!state?.hasContact && <PhoneSignIn language={language} showCodes={showCodes()} />}
          </div>
        )}

        {state?.hasContact &&
          (state.optedOutAt ? <p className={`mt-4 text-muted ${card}`}>{t.optedOut}</p> : <OptOut language={language} />)}
      </main>
    </div>
  );
}
