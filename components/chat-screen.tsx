"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatCard } from "@/lib/assistant";
import { requestError, STRINGS, type Language } from "@/lib/i18n";
import { BookingSheet, type Booked, type Slot } from "./booking-sheet";
import { Icon } from "./icons";
import { LanguagePicker } from "./language-picker";
import { MapLink } from "./map-link";
import { postJson, primaryButton, rowInput, secondaryButton, surface } from "./ui";

type Item =
  | { kind: "message"; id: string; role: "buyer" | "assistant"; text: string }
  | { kind: "card"; id: string; card: ChatCard };

const headerAction = "flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line-strong bg-white px-3 py-1 text-center font-medium hover:border-neem hover:bg-neem-soft";
const suggestion = "min-h-11 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-neem ring-1 ring-line-strong/50 hover:ring-neem";
const assistantBubble = `w-fit max-w-[85%] ${surface} rounded-tl-md px-4 py-2.5 break-words whitespace-pre-wrap`;

let nextId = 0;
const newId = () => `local-${nextId++}`;

export function ChatScreen({
  language,
  source,
  project,
  history,
  handedOffTo,
  initialHasContact,
  initialHasVisit,
  showCodes,
}: {
  language: Language;
  source: string;
  project: { slug: string; name: string };
  history: { id: number; role: "buyer" | "assistant"; content: string }[];
  handedOffTo: { executive: string | null } | null;
  initialHasContact: boolean;
  initialHasVisit: boolean;
  showCodes: boolean;
}) {
  const t = STRINGS[language];
  const [items, setItems] = useState<Item[]>(() => [
    ...history.map((m): Item => ({ kind: "message", id: `db-${m.id}`, role: m.role, text: m.content })),
    ...(handedOffTo ? [{ kind: "card", id: "db-handoff", card: { type: "handoff", ...handedOffTo } } as Item] : []),
  ]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<{ message: string; text: string } | null>(null);
  const [hasContact, setHasContact] = useState(initialHasContact);
  const [hasVisit, setHasVisit] = useState(initialHasVisit);
  const [sheet, setSheet] = useState<{ slot?: Slot | null; contactOnly?: boolean } | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items, sending, failed]);

  const addCards = (cards: ChatCard[]) =>
    setItems((current) => [...current, ...cards.map((card): Item => ({ kind: "card", id: newId(), card }))]);

  async function send(message: string, alreadyShown = false) {
    setSending(true);
    setFailed(null);
    if (!alreadyShown) {
      setItems((current) => [...current, { kind: "message", id: newId(), role: "buyer", text: message }]);
    }
    const { ok, data } = await postJson("/api/chat", { message, language, source, project: project.slug });
    setSending(false);
    if (!ok) {
      setFailed({ message, text: requestError(t, data, t.notSent) });
      return;
    }
    setItems((current) => [...current, { kind: "message", id: newId(), role: "assistant", text: data.reply }]);
    // While the AI is down every reply carries these two, and once on screen is enough.
    const shown = new Set(items.flatMap((item) => (item.kind === "card" ? [item.card.type] : [])));
    addCards(
      (data.cards as ChatCard[]).filter(
        (card) => !((card.type === "handoff" || card.type === "booking_form") && shown.has(card.type)),
      ),
    );
    setHasContact(data.hasContact);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    setText("");
    void send(message);
  }

  const [personFailed, setPersonFailed] = useState<string | null>(null);

  async function talkToPerson() {
    setSheet(null);
    setPersonFailed(null);
    const { ok, data } = await postJson("/api/chat/handoff", { language, source, project: project.slug });
    if (!ok) return setPersonFailed(requestError(t, data, t.actionFailed));
    setHasContact(data.hasContact);
    addCards([{ type: "handoff", executive: data.executive }]);
  }

  function onBooked(booked: Booked) {
    setHasContact(true);
    setHasVisit(true);
    setItems((current) => [
      ...current,
      {
        kind: "card",
        id: newId(),
        card: { type: "booked", visitId: 0, label: booked.label, project: booked.project, reraNumber: booked.reraNumber, mapUrl: booked.mapUrl },
      },
    ]);
  }

  function renderCard(card: ChatCard) {
    switch (card.type) {
      case "slots":
        return (
          <div>
            <p className="text-sm font-medium">{t.chooseTime}</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {card.slots.map((slot) => (
                <li key={slot.id}>
                  <button
                    type="button"
                    onClick={() => setSheet({ slot })}
                    className="min-h-11 w-full rounded-full border border-line-strong bg-white px-4 py-2 tabular-nums hover:border-neem hover:bg-neem-soft"
                  >
                    {slot.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      case "contact_needed":
        return (
          <button
            type="button"
            onClick={() => setSheet({ slot: { id: card.slotId, label: card.label } })}
            className={`w-full ${primaryButton}`}
          >
            {t.confirmBooking}: {card.label}
          </button>
        );
      case "booked":
        return (
          <div className="rounded-2xl bg-neem-soft p-4 ring-1 ring-neem/30">
            <p className="flex items-center gap-2 font-serif text-xl"><Icon name="check" />{t.visitBooked}</p>
            <p className="mt-1 tabular-nums">{card.label}</p>
            <p>{card.project}</p>
            <p className="mt-1 text-sm text-muted">
              {t.rera}: {card.reraNumber}
            </p>
            <MapLink url={card.mapUrl} label={t.directions} />
            <p>
              <Link href="/visit" className="inline-flex min-h-11 items-center text-neem underline underline-offset-4">
                {t.viewVisit}
              </Link>
            </p>
          </div>
        );
      case "handoff":
        return (
          <div className={`${surface} p-4`}>
            <p>{card.executive ? `${card.executive} ${t.connectingPerson}` : t.unassigned}</p>
            {hasContact ? (
              <p className="mt-1 text-sm text-muted">
                {card.executive ? `${card.executive} ${t.personWillCall}` : t.personSoon}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setSheet({ contactOnly: true })}
                className={`mt-3 w-full ${secondaryButton}`}
              >
                {t.shareNumber}
              </button>
            )}
          </div>
        );
      case "booking_form":
        return hasVisit ? null : (
          <button type="button" onClick={() => setSheet({})} className={`w-full ${primaryButton}`}>
            {t.chooseTime}
          </button>
        );
    }
  }

  return (
    <div lang={language} className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-line bg-white px-4 py-2.5">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 items-center gap-1">
            <Link href="/" aria-label={t.back} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-paper hover:text-ink">
              <Icon name="chevronLeft" />
            </Link>
            <h1 className="truncate font-serif text-2xl">{project.name}</h1>
          </div>
          <LanguagePicker current={language} />
        </div>
        <div className="mx-auto mt-2 grid max-w-2xl grid-cols-2 gap-2 text-sm">
          <button type="button" onClick={talkToPerson} className={headerAction}>
            {t.talkToPerson}
          </button>
          {hasVisit ? (
            <Link href="/visit" className={headerAction}>
              {t.myVisit}
            </Link>
          ) : (
            <button type="button" onClick={() => setSheet({})} className={headerAction}>
              {t.bookVisit}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div role="log" aria-live="polite" className="mx-auto max-w-2xl space-y-4">
          <p className={assistantBubble}>{t.greeting}</p>

          {items.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {[t.suggestHomes, t.suggestParking].map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => send(text)}
                  className={suggestion}
                >
                  {text}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSheet({})}
                className={suggestion}
              >
                {t.suggestVisit}
              </button>
            </div>
          )}

          {items.map((item) =>
            item.kind === "card" ? (
              <div key={item.id} className="sm:max-w-[85%]">
                {renderCard(item.card)}
              </div>
            ) : item.role === "buyer" ? (
              <p key={item.id} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-md bg-neem px-4 py-2.5 break-words whitespace-pre-wrap text-white">
                {item.text}
              </p>
            ) : (
              <p key={item.id} className={assistantBubble}>
                {item.text}
              </p>
            ),
          )}

          {sending && (
            <p role="status" className="animate-pulse text-sm text-muted motion-reduce:animate-none">
              {t.thinking}
            </p>
          )}

          {failed && (
            <div role="alert" className="text-sm text-alert">
              <p>{failed.text}</p>
              <button type="button" onClick={() => send(failed.message, true)} className="min-h-11 underline underline-offset-4">
                {t.retry}
              </button>
            </div>
          )}

          {personFailed && (
            <div role="alert" className="text-sm text-alert">
              <p>{personFailed}</p>
              <button type="button" onClick={talkToPerson} className="min-h-11 underline underline-offset-4">
                {t.retry}
              </button>
            </div>
          )}

          <div ref={end} />
        </div>
      </main>

      <form onSubmit={submit} className="shrink-0 border-t border-line bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-2xl gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t.messageLabel}</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={800}
              placeholder={t.messagePlaceholder}
              autoComplete="off"
              className={`${rowInput} rounded-full px-5`}
            />
          </label>
          <button type="submit" disabled={sending || !text.trim()} aria-label={t.send} className="grid size-11 shrink-0 place-items-center rounded-full bg-neem text-white hover:bg-neem-dark disabled:opacity-60">
            <Icon name="send" />
          </button>
        </div>
      </form>

      <BookingSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        t={t}
        language={language}
        source={source}
        project={project.slug}
        hasContact={hasContact}
        showCodes={showCodes}
        startSlot={sheet?.slot}
        contactOnly={sheet?.contactOnly}
        onBooked={onBooked}
        onContactSaved={() => setHasContact(true)}
        onTalkToPerson={talkToPerson}
      />
    </div>
  );
}
