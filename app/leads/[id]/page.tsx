import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { Avatar, Pill } from "@/components/bits";
import { Icon, type IconName } from "@/components/icons";
import { MapLink } from "@/components/map-link";
import { card, pageTitle, primaryButton, secondaryButton, sectionTitle, textInput } from "@/components/ui";
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
type Activity = { key: string; at: Date; icon: IconName; title: string; pill?: ReactNode; body?: ReactNode };

function Detail({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
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

function visitPill(visit: { status: string; startsAt: Date }, now: Date) {
  if (visit.status === "visited") return <Pill tone="green" icon="check">Visited</Pill>;
  if (visit.status === "no_show") return <Pill tone="alert" icon="cross">No-show</Pill>;
  if (visit.status === "cancelled") return <Pill>Cancelled</Pill>;
  return visit.startsAt > now ? <Pill tone="green" icon="clock">Upcoming</Pill> : <Pill tone="amber" icon="alert">Needs show-up record</Pill>;
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
  // A new key after any change clears errors from earlier attempts, which no longer apply.
  const actionsKey = `${lead.status}-${lead.consentAt ? 1 : 0}-${visit?.id}-${visit?.status}-${optedOut}`;

  // Only moments the record holds. A status change or a booking has no stored time, so neither appears.
  const activity: Activity[] = [
    { key: "enquiry", at: lead.createdAt, icon: "flag", title: "Enquiry received", body: `From ${SOURCE_LABELS[lead.source]}` },
    ...(lead.consentAt ? [{ key: "consent", at: lead.consentAt, icon: "check" as const, title: "Consent to contact recorded" }] : []),
    ...(lead.firstResponseAt
      ? [{ key: "reply", at: lead.firstResponseAt, icon: "phone" as const, title: "First response", body: `After ${formatWait(lead.createdAt, lead.firstResponseAt)}` }]
      : []),
    ...chats.flatMap((chat) => [
      ...(chat.lines.length
        ? [{
            key: `chat-${chat.id}`,
            at: chat.lines[0].createdAt,
            icon: "chat" as const,
            title: "Chat started",
            body: (
              <a href="#chat" className="inline-flex min-h-11 items-center underline underline-offset-4">
                Read {chat.lines.length} {chat.lines.length === 1 ? "message" : "messages"}
              </a>
            ),
          }]
        : []),
      ...(chat.handedOffAt
        ? [{
            key: `handoff-${chat.id}`,
            at: chat.handedOffAt,
            icon: "person" as const,
            title: "Handed to a person",
            body: (
              <>
                <p>{handoffLabel(chat.handoffReason)}</p>
                <p className="mt-2 text-sm text-muted">{chat.summary ? "Chat summary" : "Summary built from the chat"}</p>
                <p className="mt-0.5 max-w-prose">{chat.summary ?? chat.builtSummary}</p>
              </>
            ),
          }]
        : []),
    ]),
    ...[...(visit ? [visit] : []), ...earlierVisits].map((v) => ({
      key: `visit-${v.id}`,
      at: v.startsAt,
      icon: "calendar" as const,
      title: "Site visit",
      pill: visitPill(v, now),
      body: v.project,
    })),
    ...outbox.map((message) => ({
      key: `message-${message.id}`,
      at: message.sendAt,
      icon: "mail" as const,
      title: MESSAGE_KIND_LABELS[message.kind],
      pill: <Pill>{messageState(message, now)}</Pill>,
    })),
    ...(lead.optedOutAt ? [{ key: "opt-out", at: lead.optedOutAt, icon: "alert" as const, title: "Buyer opted out" }] : []),
  ];
  activity.sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <main>
      <p className="mt-4 text-sm">
        <Link href="/leads" className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4">
          <Icon name="chevronLeft" className="size-4" />
          Back to leads
        </Link>
      </p>
      <div className="mt-2 flex items-center gap-4">
        <Avatar name={lead.name} large />
        <div className="min-w-0">
          <h1 className={`break-words ${pageTitle}`}>{lead.name ?? "Name not given"}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted tabular-nums">
            LD-{lead.id}
            <Pill tone={lead.status === "new" ? "green" : "neutral"}>{STATUS_LABELS[lead.status]}</Pill>
          </p>
        </div>
      </div>

      {optedOut && (
        <div role="status" className="mt-6 rounded-2xl bg-alert px-5 py-4 text-white">
          <p className="font-medium">This buyer has opted out. Do not contact them.</p>
          <p className="mt-1 text-sm">
            Opted out on {formatVisitTime(lead.optedOutAt!)}. Calling, booking and reminders are switched off.
          </p>
        </div>
      )}

      {duplicates.length > 0 && (
        <p className="mt-6 rounded-2xl bg-amber-soft px-5 py-3 text-amber">
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

      {/* Phone order is what staff need next: visit, details, actions, then the history. */}
      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_auto_1fr]">
        <section key={`visit-${actionsKey}`} className={`${card} lg:col-start-1`}>
          <h2 className={sectionTitle}>Visit</h2>
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
        </section>

        <aside className="space-y-5 lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <section className={card}>
            <h2 className={sectionTitle}>Details</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
              <Detail label="Phone" wide>
                {!lead.phone ? (
                  "Not given yet"
                ) : optedOut ? (
                  <span className="tabular-nums">{lead.phone}</span>
                ) : (
                  <a href={`tel:${lead.phone}`} className="inline-flex min-h-11 items-center gap-2 text-neem underline underline-offset-4 tabular-nums">
                    <Icon name="phone" />
                    {lead.phone}
                  </a>
                )}
              </Detail>
              <Detail label="Source">{SOURCE_LABELS[lead.source]}</Detail>
              <Detail label="Project">{project ?? "Not stated"}</Detail>
              <Detail label="Needs">{lead.wants ?? "Not stated"}</Detail>
              <Detail label="Budget">{lead.budget ?? "Not stated"}</Detail>
              <Detail label="Language">{LANGUAGE_LABELS[lead.language]}</Detail>
              <Detail label="Created">
                <span className="tabular-nums">{formatVisitTime(lead.createdAt)}</span>
              </Detail>
              <Detail label="Assigned to" wide>
                <span className="flex items-center gap-2">
                  {executive && <Avatar name={executive} />}
                  {executive ?? "Nobody yet"}
                </span>
              </Detail>
              <Detail label="Time to first response">
                {lead.firstResponseAt ? (
                  <span className="tabular-nums">{formatWait(lead.createdAt, lead.firstResponseAt)}</span>
                ) : (
                  <span className="text-amber">No reply yet</span>
                )}
              </Detail>
              <Detail label="Opt-out">{optedOut ? <span className="font-medium text-alert">Opted out</span> : "Not opted out"}</Detail>
              <Detail label="Consent to contact" wide>
                {lead.consentAt ? (
                  <span className="tabular-nums">Agreed {formatVisitTime(lead.consentAt)}</span>
                ) : (
                  <span className="text-amber">Not recorded</span>
                )}
              </Detail>
            </dl>
          </section>

          <section key={`lead-${actionsKey}`} className={card}>
            <h2 className={sectionTitle}>Lead</h2>
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
          </section>
        </aside>

        <section className="lg:col-start-1">
          <h2 className={sectionTitle}>Activity</h2>
          <p className="mt-1 text-sm text-muted">
            Messages are recorded here only. Nothing is really sent in this demo.
            {outbox.length === 0 && " No messages are planned for this lead."}
          </p>
          <ol className="mt-4">
            {activity.map((item, i) => (
              <li key={item.key} className="relative flex gap-3 pb-3">
                {i < activity.length - 1 && <span aria-hidden className="absolute top-10 bottom-0 left-5 w-px bg-line-strong/50" />}
                <span className={`grid size-10 shrink-0 place-items-center rounded-full ring-1 ${item.at > now ? "bg-neem text-white ring-neem" : "bg-white text-neem ring-line"}`}>
                  <Icon name={item.icon} />
                </span>
                <div className={`min-w-0 flex-1 ${card} sm:p-4 p-4`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-medium">{item.title}</p>
                    {item.pill}
                  </div>
                  <p className="mt-0.5 text-sm text-muted tabular-nums">{formatVisitTime(item.at)}</p>
                  {item.body && <div className="mt-1 break-words">{item.body}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="chat" className={`scroll-mt-4 ${card} lg:col-start-1`}>
          <h2 className={sectionTitle}>Chat</h2>
          {chats.every((chat) => chat.lines.length === 0) ? (
            <p className="mt-3 text-muted">This buyer has not used the chat.</p>
          ) : (
            <ol className="mt-4 space-y-3">
              {chats.flatMap((chat) =>
                chat.lines.map((line) => (
                  <li key={line.id} className={`max-w-[90%] rounded-2xl px-4 py-2.5 ${line.role === "buyer" ? "ml-auto bg-neem-soft" : "bg-paper"}`}>
                    <p className="text-sm text-muted tabular-nums">
                      {line.role === "buyer" ? "Buyer" : "Assistant"}, {formatVisitTime(line.createdAt)}
                    </p>
                    <p className="mt-0.5 break-words whitespace-pre-wrap">{line.content}</p>
                    {line.blockedDraft && (
                      <div className="mt-2 rounded-xl bg-amber-soft px-3 py-2">
                        <p className="text-sm font-medium text-amber">
                          Withheld from the buyer because {flagLabel(chat.flagReason)}. Staff only. The buyer saw the reply above.
                        </p>
                        <p className="mt-1 break-words whitespace-pre-wrap">{line.blockedDraft}</p>
                      </div>
                    )}
                  </li>
                )),
              )}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
