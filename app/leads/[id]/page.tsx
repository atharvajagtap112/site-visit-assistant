import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { MapLink } from "@/components/map-link";
import { primaryButton, secondaryButton, textInput } from "@/components/ui";
import { getFreeSlots } from "@/lib/booking";
import {
  flagLabel,
  formatVisitTime,
  formatWait,
  handoffLabel,
  LANGUAGE_LABELS,
  MESSAGE_KIND_LABELS,
  messageState,
  SOURCE_LABELS,
  STATUS_LABELS,
  visitLabel,
} from "@/lib/format";
import { getLeadDetail, listExecutives, listProjects } from "@/lib/leads";
import { requireUser } from "@/lib/session";
import {
  bookAction,
  cancelAction,
  correctShowUpAction,
  markContactedAction,
  reassignAction,
  recordConsentAction,
  recordOptOutAction,
  recordShowUpAction,
  rescheduleAction,
  setClosedAction,
} from "../actions";

export const metadata: Metadata = { title: "Lead | Company A Homes", robots: "noindex" };

// ponytail: about four weeks of times at seven a day, per project. Later dates need a date picker.
const SLOTS_LISTED = 200;

type FreeSlot = { id: number; startsAt: Date };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-6">
      <h2 className="font-serif text-2xl">{title}</h2>
      {children}
    </section>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function SlotPicker({ groups }: { groups: { project: string; slots: FreeSlot[] }[] }) {
  return (
    <label className="mb-3 block text-sm font-medium">
      Time
      {/* No preselected time: a stray tap must not book or move a visit. */}
      <select name="slotId" required defaultValue="" className={`${textInput} font-normal tabular-nums`}>
        <option value="" disabled>
          Choose a time
        </option>
        {groups.map((group) => (
          <optgroup key={group.project} label={group.project}>
            {group.slots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {formatVisitTime(slot.startsAt)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const leadId = Number(id);
  if (!/^\d{1,10}$/.test(id) || leadId > 2_147_483_647) notFound();
  const detail = await getLeadDetail(user, leadId);
  if (!detail) notFound();

  const { lead, project, executive, chats, visit, earlierVisits, outbox, duplicates } = detail;
  const isHead = user.role === "sales_head";
  const optedOut = Boolean(lead.optedOutAt);
  const now = new Date();

  const visitActive = visit?.status === "booked";
  const visitAhead = visitActive && visit.startsAt > now;
  const visitPast = visitActive && visit.startsAt <= now;
  const visitRecorded = visit?.status === "visited" || visit?.status === "no_show";

  // A lead with no project yet can book either one: the booking sets its project.
  const projects = await listProjects();
  const slotGroups = (
    await Promise.all(
      projects
        .filter((p) => !lead.projectId || p.id === lead.projectId)
        .map(async (p) => ({ project: p.name, slots: await getFreeSlots(p.id, SLOTS_LISTED) })),
    )
  ).filter((group) => group.slots.length);
  const executives = isHead ? await listExecutives() : [];
  const fields = { leadId: lead.id };
  const visitFields = visit ? { leadId: lead.id, visitId: visit.id } : fields;

  return (
    <main>
      <p className="mt-6 text-sm">
        <Link href="/leads" className="inline-flex min-h-11 items-center underline underline-offset-4">
          Back to leads
        </Link>
      </p>
      <h1 className="mt-4 font-serif text-4xl">{lead.name ?? "Name not given"}</h1>
      <p className="mt-2 text-muted tabular-nums">
        LD-{lead.id}, {STATUS_LABELS[lead.status]}
      </p>

      {optedOut && (
        <div role="status" className="mt-6 rounded-md bg-alert px-4 py-3 text-white">
          <p className="font-medium">This buyer has opted out. Do not contact them.</p>
          <p className="mt-1 text-sm">
            Opted out on {formatVisitTime(lead.optedOutAt!)}. Calling, booking and reminders are switched off.
          </p>
        </div>
      )}

      {duplicates.length > 0 && (
        <p className="mt-6 rounded-md bg-amber-soft px-4 py-3 text-amber">
          Same phone as{" "}
          {duplicates.map((other, i) => (
            <span key={other.id}>
              {i > 0 && ", "}
              {other.canOpen ? (
                <Link href={`/leads/${other.id}`} className="underline underline-offset-4">
                  LD-{other.id}
                </Link>
              ) : (
                `LD-${other.id}, with another executive`
              )}
            </span>
          ))}
          .{lead.duplicateOfId ? " This lead is linked as a duplicate." : ""}
        </p>
      )}

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <Detail label="Phone">
          {!lead.phone ? (
            "Not given yet"
          ) : optedOut ? (
            <span className="tabular-nums">{lead.phone}</span>
          ) : (
            <a href={`tel:${lead.phone}`} className="inline-flex min-h-11 items-center text-neem underline underline-offset-4 tabular-nums">
              {lead.phone}
            </a>
          )}
        </Detail>
        <Detail label="Source">{SOURCE_LABELS[lead.source]}</Detail>
        <Detail label="Project">{project ?? "Not stated"}</Detail>
        <Detail label="Needs">{lead.wants ?? "Not stated"}</Detail>
        <Detail label="Budget">{lead.budget ?? "Not stated"}</Detail>
        <Detail label="Language">{LANGUAGE_LABELS[lead.language]}</Detail>
        <Detail label="Assigned to">{executive ?? "Nobody yet"}</Detail>
        <Detail label="Created">
          <span className="tabular-nums">{formatVisitTime(lead.createdAt)}</span>
        </Detail>
        <Detail label="Time to first response">
          {lead.firstResponseAt ? (
            <span className="tabular-nums">{formatWait(lead.createdAt, lead.firstResponseAt)}</span>
          ) : (
            <span className="text-amber">No reply yet</span>
          )}
        </Detail>
        <Detail label="Consent to contact">
          {lead.consentAt ? (
            <span className="tabular-nums">Agreed {formatVisitTime(lead.consentAt)}</span>
          ) : (
            <span className="text-amber">Not recorded</span>
          )}
        </Detail>
        <Detail label="Opt-out">{optedOut ? <span className="font-medium text-alert">Opted out</span> : "Not opted out"}</Detail>
      </dl>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* A new key after any change clears errors from earlier attempts, which no longer apply. */}
        <div key={`${lead.status}-${lead.consentAt ? 1 : 0}-${visit?.id}-${visit?.status}-${optedOut}`} className="space-y-10 lg:order-2">
          <Section title="Visit">
            {visit ? (
              <div className="mt-3">
                <p className={visitPast ? "font-medium text-amber" : "font-medium"}>{visitLabel(visit, now).text}</p>
                {visit.status !== "cancelled" && (
                  <>
                    <p className="mt-1">
                      {visit.project}, {visit.locationLabel}
                    </p>
                    <MapLink url={visit.mapUrl} label="Open location in maps" />
                  </>
                )}
              </div>
            ) : (
              <p className="mt-3 text-muted">No visit booked yet.</p>
            )}

            {visitPast && (
              <div className="mt-4">
                <p className="text-sm text-muted">The time has passed. Did the buyer come?</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <ActionForm action={recordShowUpAction} fields={{ ...visitFields, outcome: "visited" }} label="Visited" pendingLabel="Saving" buttonClass={primaryButton} />
                  <ActionForm action={recordShowUpAction} fields={{ ...visitFields, outcome: "no_show" }} label="No-show" pendingLabel="Saving" />
                </div>
              </div>
            )}

            {visitRecorded && (
              <div className="mt-4">
                <ActionForm
                  action={correctShowUpAction}
                  fields={{ ...visitFields, outcome: visit.status === "visited" ? "no_show" : "visited" }}
                  label={visit.status === "visited" ? "Correct to no-show" : "Correct to visited"}
                  pendingLabel="Saving"
                />
              </div>
            )}

            {visitAhead && !optedOut && (
              <div className="mt-5">
                {slotGroups.length ? (
                  <ActionForm action={rescheduleAction} fields={visitFields} label="Change time" pendingLabel="Changing">
                    <SlotPicker groups={slotGroups} />
                  </ActionForm>
                ) : (
                  <p className="text-muted">No other times are free right now.</p>
                )}
              </div>
            )}

            {visitAhead && (
              <div className="mt-3">
                <ActionForm
                  action={cancelAction}
                  fields={visitFields}
                  label="Cancel visit"
                  pendingLabel="Cancelling"
                  buttonClass={`${secondaryButton} text-alert`}
                  confirm={{ question: "Cancel this visit? The time becomes free for other buyers.", yes: "Yes, cancel", no: "Keep visit" }}
                />
              </div>
            )}

            {!visitAhead && !optedOut && (
              <div className="mt-6">
                <h3 className="font-medium">Book a visit</h3>
                {visitPast && (
                  <p className="mt-1 text-sm text-muted">
                    Booking a new time records the visit above as a no-show, unless you record it first.
                  </p>
                )}
                {!lead.consentAt ? (
                  <div className="mt-2">
                    <p className="mb-3 text-sm text-muted">A visit needs the buyer&apos;s consent to be contacted.</p>
                    <ActionForm action={recordConsentAction} fields={fields} label="Record consent" pendingLabel="Saving">
                      <label className="mb-3 flex gap-3 text-sm">
                        <input type="checkbox" name="agreed" className="mt-0.5 size-5 shrink-0 accent-neem" />
                        <span>The buyer agreed to be contacted about this enquiry by phone, SMS or WhatsApp.</span>
                      </label>
                    </ActionForm>
                  </div>
                ) : slotGroups.length ? (
                  <div className="mt-3">
                    <ActionForm action={bookAction} fields={fields} label="Book visit" pendingLabel="Booking" buttonClass={primaryButton}>
                      <SlotPicker groups={slotGroups} />
                    </ActionForm>
                  </div>
                ) : (
                  <p className="mt-2 text-muted">No visit times are free right now. Ask the sales head to open more.</p>
                )}
              </div>
            )}

            {earlierVisits.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm text-muted">Earlier visits</h3>
                <ul className="mt-1 space-y-2 text-sm tabular-nums">
                  {earlierVisits.map((earlier) => (
                    <li key={earlier.id}>
                      {earlier.status === "cancelled"
                        ? `Cancelled ${formatVisitTime(earlier.startsAt)}`
                        : visitLabel(earlier, now).text}
                      {/* A new booking closes an unrecorded visit as a no-show, so this is where staff fix that. */}
                      {(earlier.status === "visited" || earlier.status === "no_show") && (
                        <ActionForm
                          key={earlier.status}
                          action={correctShowUpAction}
                          fields={{ leadId: lead.id, visitId: earlier.id, outcome: earlier.status === "visited" ? "no_show" : "visited" }}
                          label={earlier.status === "visited" ? "Correct to no-show" : "Correct to visited"}
                          pendingLabel="Saving"
                          buttonClass="min-h-11 text-left text-neem underline underline-offset-4 disabled:opacity-60"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section title="Lead">
            <div className="mt-4 space-y-3">
              {!optedOut && lead.status !== "closed" && (lead.status === "new" || !lead.firstResponseAt) && (
                <ActionForm action={markContactedAction} fields={fields} label="Mark as contacted" pendingLabel="Saving" buttonClass={primaryButton} />
              )}
              <ActionForm
                action={setClosedAction}
                fields={{ ...fields, closed: lead.status === "closed" ? "no" : "yes" }}
                label={lead.status === "closed" ? "Reopen lead" : "Close lead"}
                pendingLabel="Saving"
              />
              {isHead && (
                <ActionForm action={reassignAction} fields={fields} label="Reassign" pendingLabel="Reassigning">
                  <label className="mb-3 block text-sm font-medium">
                    Executive
                    <select name="executiveId" defaultValue={lead.assignedToId ?? undefined} className={`${textInput} font-normal`}>
                      {executives.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                    {duplicates.length > 0 && (
                      <span className="mt-1 block font-normal text-muted">Leads with the same phone move too.</span>
                    )}
                  </label>
                </ActionForm>
              )}
              {!optedOut && (
                <ActionForm
                  action={recordOptOutAction}
                  fields={fields}
                  label="Record opt-out"
                  pendingLabel="Saving"
                  buttonClass={`${secondaryButton} text-alert`}
                  confirm={{
                    question: "Did the buyer ask not to be contacted? Calling, booking and reminders stop for every enquiry from this phone, and only the buyer can turn them back on.",
                    yes: "Yes, record opt-out",
                    no: "Go back",
                  }}
                />
              )}
            </div>
          </Section>
        </div>

        <div className="space-y-10 lg:order-1">
          {chats.some((chat) => chat.handedOffAt) && (
            <Section title="Handoff">
              {chats
                .filter((chat) => chat.handedOffAt)
                .map((chat) => (
                  <div key={chat.id} className="mt-3">
                    <p className="font-medium">{handoffLabel(chat.handoffReason)}</p>
                    <p className="mt-1 text-sm text-muted tabular-nums">{formatVisitTime(chat.handedOffAt!)}</p>
                    <p className="mt-3 text-sm text-muted">{chat.summary ? "Chat summary" : "Summary built from the chat"}</p>
                    <p className="mt-1 max-w-prose">{chat.summary ?? chat.builtSummary}</p>
                  </div>
                ))}
            </Section>
          )}

          <Section title="Chat">
            {chats.every((chat) => chat.lines.length === 0) ? (
              <p className="mt-3 text-muted">This buyer has not used the chat.</p>
            ) : (
              <ol className="mt-4 space-y-4">
                {chats.flatMap((chat) =>
                  chat.lines.map((line) => (
                    <li key={line.id} className={line.role === "assistant" ? "border-l-2 border-line pl-4" : ""}>
                      <p className="text-sm text-muted tabular-nums">
                        {line.role === "buyer" ? "Buyer" : "Assistant"}, {formatVisitTime(line.createdAt)}
                      </p>
                      <p className="mt-0.5 max-w-prose whitespace-pre-wrap">{line.content}</p>
                      {line.blockedDraft && (
                        <div className="mt-2 max-w-prose rounded-md bg-amber-soft px-3 py-2">
                          <p className="text-sm font-medium text-amber">
                            Withheld from the buyer because {flagLabel(chat.flagReason)}. Staff only. The buyer saw the reply above.
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">{line.blockedDraft}</p>
                        </div>
                      )}
                    </li>
                  )),
                )}
              </ol>
            )}
          </Section>

          <Section title="Simulated messages">
            <p className="mt-1 text-sm text-muted">Recorded here only. Nothing is really sent in this demo.</p>
            {outbox.length === 0 ? (
              <p className="mt-3 text-muted">No messages are planned for this lead.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {outbox.map((message) => (
                  <li key={message.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5">
                    <span>{MESSAGE_KIND_LABELS[message.kind]}</span>
                    <span className="text-sm text-muted tabular-nums">
                      {messageState(message, now)}, {formatVisitTime(message.sendAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}
