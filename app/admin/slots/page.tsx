import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Pill } from "@/components/bits";
import { card, pageTitle, secondaryButton, sectionTitle, textInput } from "@/components/ui";
import { addDays, indiaInstant, listSlots, parseSlotFilters } from "@/lib/admin";
import { indiaDate } from "@/lib/format";
import { listProjects } from "@/lib/leads";
import { requireHead } from "@/lib/session";
import { setSlotOpenAction } from "../actions";
import { AddSlotsForm } from "./add-slots-form";

export const metadata: Metadata = { title: "Slots | Company A Homes", robots: "noindex" };

const TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const DAY_TITLE = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
const compactButton = "min-h-11 rounded-full border border-line-strong bg-white px-4 text-sm font-medium hover:border-neem hover:bg-neem-soft disabled:opacity-60";

const VISIT_WORDS = { booked: "Booked by", visited: "Visited,", no_show: "No-show," } as const;

export default async function SlotsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireHead();
  const projects = await listProjects();
  const now = new Date();
  const { project, from, to, shortened } = parseSlotFilters(await searchParams, projects.map((p) => p.id), now);
  const rows = project ? await listSlots(user, project, from, to) : [];
  const days = [...new Set(rows.map((r) => indiaDate(r.startsAt)))];
  const length = Math.round((indiaInstant(to).getTime() - indiaInstant(from).getTime()) / 86_400_000) + 1;
  const shifted = (start: number, end: number) => `/admin/slots?project=${project}&from=${addDays(from, start)}&to=${addDays(from, end)}`;
  const projectName = projects.find((p) => p.id === project)?.name ?? "";

  return (
    <main className="max-w-4xl">
      <h1 className={`mt-6 ${pageTitle}`}>Slots</h1>
      <p className="mt-2 text-muted">All times are India time. Buyers can only pick open, future times with nobody booked.</p>

      {/* The key resets the inputs when Earlier or Later changes the URL under them. */}
      <Form key={`${project}${from}${to}`} action="/admin/slots" className={`mt-5 grid grid-cols-2 items-end gap-3 sm:grid-cols-4 ${card}`}>
        <label className="col-span-2 block text-sm font-medium sm:col-span-1">
          Project
          <select name="project" defaultValue={project} className={`${textInput} font-normal`}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          From
          <input type="date" name="from" defaultValue={from} className={`${textInput} font-normal`} />
        </label>
        <label className="block text-sm font-medium">
          To
          <input type="date" name="to" defaultValue={to} className={`${textInput} font-normal`} />
        </label>
        <button className={`col-span-2 sm:col-span-1 ${secondaryButton}`}>Show</button>
      </Form>
      {shortened && (
        <p role="status" className="mt-3 rounded-xl bg-amber-soft px-3 py-2 text-amber">
          One view holds 14 days at most, so this shows the first 14. Use Later for the rest.
        </p>
      )}

      {rows.length === 0 ? (
        <p className={`mt-6 text-muted ${card}`}>No slots in this range for {projectName}. Add some below, or choose other dates.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {days.map((day) => (
            <section key={day} className={card}>
              <h2 className={sectionTitle}>{DAY_TITLE.format(indiaInstant(day))}</h2>
              <ul className="mt-2 divide-y divide-line">
                {rows
                  .filter((slot) => indiaDate(slot.startsAt) === day)
                  .map((slot) => {
                    const past = slot.startsAt <= now;
                    return (
                      <li key={slot.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-4">
                          <span className="w-20 tabular-nums">{TIME.format(slot.startsAt)}</span>
                          {slot.visitStatus && slot.leadId ? (
                            <span>
                              {VISIT_WORDS[slot.visitStatus as keyof typeof VISIT_WORDS]}{" "}
                              <Link href={`/leads/${slot.leadId}`} className="underline underline-offset-4">
                                LD-{slot.leadId}
                              </Link>
                            </span>
                          ) : !slot.isOpen ? (
                            <Pill tone="amber">Closed</Pill>
                          ) : (
                            past ? <span className="text-muted">Open, passed with no booking</span> : <Pill tone="green">Open</Pill>
                          )}
                        </div>
                        {!past && (
                          <ActionForm
                            action={setSlotOpenAction}
                            fields={{ slotId: slot.id, open: slot.isOpen ? "no" : "yes" }}
                            label={slot.isOpen ? "Close" : "Open"}
                            pendingLabel="Saving"
                            buttonClass={compactButton}
                          />
                        )}
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <nav aria-label="Dates" className="mt-6 flex justify-between gap-4">
        <Link href={shifted(-length, -1)} className={secondaryButton}>
          Earlier
        </Link>
        <Link href={shifted(length, 2 * length - 1)} className={secondaryButton}>
          Later
        </Link>
      </nav>

      {project && <AddSlotsForm projectId={project} projectName={projectName} date={from} />}
    </main>
  );
}
