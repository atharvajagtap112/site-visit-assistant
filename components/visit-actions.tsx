"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { STRINGS, type Language } from "@/lib/i18n";
import { BookingSheet } from "./booking-sheet";
import { card, postJson, primaryButton, secondaryButton } from "./ui";

export function VisitActions({ language, project, showCodes }: { language: Language; project: string; showCodes: boolean }) {
  const t = STRINGS[language];
  const router = useRouter();
  const confirm = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function cancel() {
    setBusy(true);
    setFailed(false);
    const { ok } = await postJson("/api/visit/manage", { action: "cancel" });
    setBusy(false);
    confirm.current?.close();
    if (ok) router.replace("/visit?done=cancelled");
    else setFailed(true);
  }

  return (
    <div>
      {failed && (
        <p role="alert" className="mb-3 text-sm text-alert">
          {t.actionFailed}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setChanging(true)} className={secondaryButton}>
          {t.reschedule}
        </button>
        <button
          type="button"
          onClick={() => {
            confirm.current?.showModal();
            // A native dialog focuses its first button, and here that one cancels the visit.
            keep.current?.focus();
          }}
          className={`${secondaryButton} text-alert`}
        >
          {t.cancelVisit}
        </button>
      </div>

      <dialog ref={confirm} lang={language} aria-label={t.cancelVisit} className="m-auto w-full max-w-sm rounded-3xl bg-white p-6 text-ink">
        <h2 className="font-serif text-2xl">{t.cancelVisit}</h2>
        <button
          type="button"
          disabled={busy}
          onClick={cancel}
          className="mt-5 min-h-11 w-full rounded-full bg-alert px-5 py-2.5 font-medium text-white disabled:opacity-60"
        >
          {t.confirmCancel}
        </button>
        <button ref={keep} type="button" onClick={() => confirm.current?.close()} className={`mt-2 w-full ${secondaryButton}`}>
          {t.close}
        </button>
      </dialog>

      <BookingSheet
        open={changing}
        onClose={() => setChanging(false)}
        t={t}
        language={language}
        project={project}
        hasContact
        showCodes={showCodes}
        reschedule
        onRescheduled={() => {
          setChanging(false);
          router.replace("/visit?done=changed");
          router.refresh();
        }}
      />
    </div>
  );
}

/** For a visit whose time has passed. Booking closes that visit, so the buyer is never locked out. */
export function BookAgain({ language, project, showCodes }: { language: Language; project: string; showCodes: boolean }) {
  const t = STRINGS[language];
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primaryButton}>
        {t.bookAgain}
      </button>
      <BookingSheet
        open={open}
        onClose={() => setOpen(false)}
        t={t}
        language={language}
        project={project}
        hasContact
        showCodes={showCodes}
        onBooked={() => {
          setOpen(false);
          router.replace("/visit?done=booked");
          router.refresh();
        }}
      />
    </>
  );
}

export function OptOut({ language }: { language: Language }) {
  const t = STRINGS[language];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function optOut() {
    setBusy(true);
    setFailed(false);
    const { ok } = await postJson("/api/visit/manage", { action: "opt_out" });
    setBusy(false);
    if (ok) router.refresh();
    else setFailed(true);
  }

  return (
    <section className={`mt-4 ${card}`}>
      <h2 className="font-medium">{t.optOutTitle}</h2>
      <p className="mt-1 text-sm text-muted">{t.optOutHelp}</p>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-alert">
          {t.actionFailed}
        </p>
      )}
      <button type="button" disabled={busy} onClick={optOut} className={`mt-3 ${secondaryButton}`}>
        {t.optOut}
      </button>
    </section>
  );
}
