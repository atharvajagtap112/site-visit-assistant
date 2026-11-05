"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { requestError, type Language, type Strings } from "@/lib/i18n";
import { Icon } from "./icons";
import { MapLink } from "./map-link";
import { postJson, primaryButton, secondaryButton, textInput } from "./ui";

export type Slot = { id: number; label: string };
export type Booked = { label: string; project: string; reraNumber: string; mapUrl: string; executive: string | null };
type Step = "times" | "details" | "confirm" | "done";

/**
 * The whole booking flow in one native dialog: pick a time, give details and consent if we have
 * none, confirm. It works with no AI at all, so a Gemini outage never stops a booking.
 */
export function BookingSheet({
  open,
  onClose,
  t,
  language,
  source,
  project,
  hasContact,
  showCodes,
  startSlot,
  contactOnly,
  reschedule,
  onBooked,
  onContactSaved,
  onRescheduled,
  onTalkToPerson,
}: {
  open: boolean;
  onClose: () => void;
  t: Strings;
  language: Language;
  source?: string;
  project: string;
  hasContact: boolean;
  showCodes: boolean;
  startSlot?: Slot | null;
  contactOnly?: boolean;
  reschedule?: boolean;
  onBooked?: (booked: Booked) => void;
  onContactSaved?: (executive: string | null) => void;
  onRescheduled?: () => void;
  onTalkToPerson?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>("times");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsFailed, setSlotsFailed] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showVisitLink, setShowVisitLink] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [contactSaved, setContactSaved] = useState(false);

  const loadSlots = useCallback(async () => {
    setSlots(null);
    setSlotsFailed(false);
    try {
      const response = await fetch(`/api/visit/slots?project=${encodeURIComponent(project)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setSlots((await response.json()).slots);
    } catch {
      setSlotsFailed(true);
    }
  }, [project]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) {
      if (element.open) element.close();
      return;
    }
    if (!element.open) element.showModal();
    setError(null);
    setNote(null);
    setShowVisitLink(false);
    setBooked(null);
    setDemoCode(null);
    setCode("");
    setSlot(startSlot ?? null);
    if (contactOnly) setStep("details");
    else if (startSlot) setStep(hasContact ? "confirm" : "details");
    else {
      setStep("times");
      void loadSlots();
    }
    // Only when the sheet opens: later changes to these props must not restart the flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Each step replaces the button that was just pressed, so focus moves to the new step's title.
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open, step]);

  function chooseSlot(chosen: Slot) {
    setSlot(chosen);
    setError(null);
    setStep(hasContact || contactSaved ? "confirm" : "details");
  }

  async function submitVisit(chosen: Slot) {
    setBusy(true);
    setError(null);
    const { ok, data } = reschedule
      ? await postJson("/api/visit/manage", { action: "reschedule", slotId: chosen.id })
      : await postJson("/api/visit/book", { slotId: chosen.id });
    setBusy(false);

    if (ok) {
      if (reschedule) {
        onRescheduled?.();
        return;
      }
      setBooked(data);
      setStep("done");
      onBooked?.(data);
      return;
    }
    switch (data.error) {
      case "slot_taken":
      case "slot_unavailable":
        setError(t.slotTaken);
        setStep("times");
        void loadSlots();
        break;
      case "already_booked":
        setError(t.alreadyBooked);
        setShowVisitLink(true);
        setStep("confirm");
        break;
      case "opted_out":
        setNote(t.optedOutNote);
        setContactSaved(false);
        setStep("details");
        break;
      case "no_consent":
        setContactSaved(false);
        setStep("details");
        break;
      default:
        setError(t.bookingFailed);
        setStep("confirm");
    }
  }

  const phoneLooksValid = /^(?:\+?91|0)?[6-9]\d{9}$/.test(phone.replace(/[\s()-]/g, ""));

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError(t.nameInvalid);
    if (!phoneLooksValid) return setError(t.phoneInvalid);
    if (!consent) return setError(t.consentRequired);

    setBusy(true);
    setError(null);
    const { ok, data } = await postJson("/api/buyer/code", { phone });
    setBusy(false);
    if (ok) setDemoCode(data.demoCode);
    else setError(requestError(t, data, t.actionFailed));
  }

  async function confirmDetails(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson("/api/buyer/contact", {
      name,
      phone,
      code,
      consent,
      language,
      source,
      project,
    });
    setBusy(false);
    if (!ok) return setError(requestError(t, data, t.actionFailed));
    setContactSaved(true);
    onContactSaved?.(data.executive ?? null);
    if (contactOnly || !slot) onClose();
    else await submitVisit(slot);
  }

  const talkButton = onTalkToPerson ? (
    <button type="button" onClick={onTalkToPerson} className={`mt-4 w-full ${secondaryButton}`}>
      {t.talkToPerson}
    </button>
  ) : (
    <Link href="/chat" className={`mt-4 w-full ${secondaryButton}`}>
      {t.talkToPerson}
    </Link>
  );

  const title =
    step === "done" ? t.visitBooked : step === "details" ? t.yourDetails : step === "confirm" ? t.confirmBooking : t.pickVisitTime;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      lang={language}
      aria-labelledby="sheet-title"
      className="m-auto w-full max-w-md rounded-3xl bg-white p-0 text-ink max-sm:mb-0 max-sm:max-w-full max-sm:rounded-b-none"
    >
      <div className="flex max-h-[85dvh] flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
          <h2 id="sheet-title" ref={heading} tabIndex={-1} className="font-serif text-2xl outline-none">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-full px-3 text-sm font-medium text-muted underline underline-offset-4 hover:bg-paper">
            {t.close}
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          {note && <p className="mb-4 rounded-xl bg-amber-soft px-3 py-2 text-sm text-amber">{note}</p>}
          {error && (
            <p role="alert" className="mb-4 text-sm text-alert">
              {error}{" "}
              {showVisitLink && (
                <Link href="/visit" className="underline underline-offset-4">
                  {t.myVisit}
                </Link>
              )}
            </p>
          )}

          {step === "times" && (
            <>
              {slotsFailed ? (
                <div>
                  <p role="alert" className="text-sm text-alert">
                    {t.timesError}
                  </p>
                  <button type="button" onClick={loadSlots} className={`mt-4 w-full ${secondaryButton}`}>
                    {t.retry}
                  </button>
                </div>
              ) : !slots ? (
                <p role="status" className="text-muted">
                  {t.loadingTimes}
                </p>
              ) : slots.length === 0 ? (
                <div>
                  <p>{t.noTimes}</p>
                  {talkButton}
                </div>
              ) : (
                <ul className="grid grid-cols-2 gap-2">
                  {slots.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => chooseSlot(s)}
                        className="min-h-11 w-full rounded-full border border-line-strong bg-white px-2 py-2 text-sm font-medium tabular-nums hover:border-neem hover:bg-neem-soft"
                      >
                        {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {step === "details" && !showCodes && (
            <div>
              <p className="rounded-xl bg-amber-soft px-3 py-2 text-sm text-amber">{t.codesUnavailable}</p>
              {talkButton}
            </div>
          )}

          {step === "details" && showCodes && (
            <form onSubmit={demoCode ? confirmDetails : sendCode} className="space-y-4" noValidate>
              {slot && <p className="rounded-xl bg-neem-soft px-3 py-2 font-medium tabular-nums">{slot.label}</p>}
              <label className="block text-sm font-medium">
                {t.name}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={100}
                  disabled={Boolean(demoCode)}
                  className={`${textInput} font-normal`}
                />
              </label>
              <label className="block text-sm font-medium">
                {t.phone}
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={20}
                  disabled={Boolean(demoCode)}
                  aria-describedby="phone-hint"
                  className={`${textInput} font-normal`}
                />
                <span id="phone-hint" className="mt-1 block font-normal text-muted">
                  {t.phoneHint}
                </span>
              </label>
              <label className="flex gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  disabled={Boolean(demoCode)}
                  className="mt-0.5 size-5 shrink-0 accent-neem"
                />
                <span>{t.consent}</span>
              </label>

              {!demoCode && <p className="text-sm text-muted">{t.demoCodeNote}</p>}
              {demoCode && (
                <>
                  <p className="rounded-xl bg-neem-soft px-3 py-2 text-sm">
                    {t.demoCode} <strong className="tabular-nums">{demoCode}</strong>
                  </p>
                  <label className="block text-sm font-medium">
                    {t.enterCode}
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      autoFocus
                      className={`${textInput} font-normal tabular-nums`}
                    />
                  </label>
                </>
              )}

              <button type="submit" disabled={busy} className={`w-full ${primaryButton}`}>
                {!demoCode ? t.sendCode : contactOnly ? t.confirmDetails : t.confirmBooking}
              </button>
              {demoCode && (
                <button
                  type="button"
                  onClick={() => {
                    setDemoCode(null);
                    setCode("");
                    setError(null);
                  }}
                  className="min-h-11 w-full text-sm text-muted underline underline-offset-4"
                >
                  {t.newCode}
                </button>
              )}
            </form>
          )}

          {step === "confirm" && slot && (
            <div>
              <p className="flex items-center gap-3 rounded-2xl bg-neem-soft p-4 text-lg font-medium tabular-nums"><Icon name="calendar" />{slot.label}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => submitVisit(slot)}
                className={`mt-5 w-full ${primaryButton}`}
              >
                {t.confirmBooking}
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("times");
                  void loadSlots();
                }}
                className={`mt-2 w-full ${secondaryButton}`}
              >
                {t.chooseAnother}
              </button>
            </div>
          )}

          {step === "done" && booked && (
            <div className="space-y-2">
              <p className="flex items-center gap-3 rounded-2xl bg-neem-soft p-4 text-lg font-medium tabular-nums"><Icon name="check" />{booked.label}</p>
              <p>{booked.project}</p>
              <p className="text-sm text-muted">
                {t.rera}: {booked.reraNumber}
              </p>
              {booked.executive && (
                <p className="text-sm">
                  {booked.executive} {t.contactTitle}
                </p>
              )}
              <MapLink url={booked.mapUrl} label={t.directions} />
              <Link href="/visit" className={`mt-3 w-full ${primaryButton}`}>
                {t.viewVisit}
              </Link>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
