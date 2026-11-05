import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Pill } from "@/components/bits";
import { Icon, type IconName } from "@/components/icons";
import { card, chip, pageTitle, sectionTitle, surface } from "@/components/ui";
import { checkTargets, COST_PER_LEAD, getDashboard, parseRange, RANGES, rangeDates, type RangeKey, type SourceFigures } from "@/lib/dashboard";
import { formatDuration, SOURCE_LABELS } from "@/lib/format";
import { requireHead } from "@/lib/session";

export const metadata: Metadata = { title: "Source dashboard | Company A Homes", robots: "noindex" };

const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;
const rupees = (amount: number) => `₹${Math.round(amount).toLocaleString("en-IN")}`;

const Small = ({ children }: { children: ReactNode }) => <span className="text-sm font-normal text-muted">{children}</span>;
const Note = ({ children }: { children: ReactNode }) => <span className="block text-sm font-normal text-muted">{children}</span>;

/** A figure that cannot be calculated: a dash and the reason, never NaN or a misleading 0. */
const Dash = ({ why }: { why: string }) => (
  <>
    — <Small>{why}</Small>
  </>
);

const COLUMNS: { label: string; cell: (row: SourceFigures) => ReactNode }[] = [
  {
    label: "Leads",
    cell: (r) => (
      <>
        {r.leads}
        {r.repeats > 0 && (
          <Note>
            {r.repeats} repeat {r.repeats === 1 ? "enquiry" : "enquiries"} left out
          </Note>
        )}
      </>
    ),
  },
  {
    label: "Median first response",
    cell: (r) =>
      r.medianResponseMs === null ? <Dash why={r.leads ? "no replies yet" : "no leads"} /> : formatDuration(r.medianResponseMs),
  },
  {
    label: "Not reached in 48h",
    cell: (r) =>
      r.notReachedRate === null ? (
        <Dash why={r.leads ? "all under 48 hours old" : "no leads"} />
      ) : (
        <>
          {percent(r.notReachedRate)}
          <Note>
            {r.notReached} of {r.judged}
            {r.awaitingReply > 0 && `, ${r.awaitingReply} still inside 48h`}
          </Note>
        </>
      ),
  },
  {
    label: "Visits",
    cell: (r) => (
      <>
        {r.attended} attended
        <Note>{r.booked} booked</Note>
      </>
    ),
  },
  {
    label: "Show-up rate",
    cell: (r) => (
      <>
        {r.showUpRate === null ? <Dash why={r.leads ? "none recorded" : "no leads"} /> : percent(r.showUpRate)}
        {r.showUpRate !== null && (
          <Note>
            {r.attended} of {r.attended + r.noShow} recorded
          </Note>
        )}
        {r.unrecorded > 0 && <Note>{r.unrecorded} not recorded</Note>}
      </>
    ),
  },
  {
    label: "Cost per visit",
    cell: (r) => (r.costPerVisit === null ? <Small>no visits yet</Small> : rupees(r.costPerVisit)),
  },
];

/** A bullet meter: the bar is where we are, the tick is the target. The ceiling only sets the scale. */
function Target({
  name,
  icon,
  current,
  value,
  goal,
  ceiling,
  goalLabel,
  target,
  met,
}: {
  name: string;
  icon: IconName;
  current: string;
  value: number | null;
  goal: number;
  ceiling: number;
  goalLabel: string;
  target: string;
  met: boolean | null;
}) {
  const scale = Math.max(ceiling, value ?? 0);
  return (
    <li className={`${card} flex flex-col`}>
      <p className="flex items-center gap-2 font-medium md:min-h-12">
        <Icon name={icon} className="size-5 text-neem" />
        {name}
      </p>
      <p className="mt-4 text-4xl font-semibold tracking-tight">{current}</p>
      <div role="img" aria-label={`Now ${current}. ${target}.`} className="mt-5 mb-8">
        <div className="relative h-2.5 rounded-full bg-neem-soft">
          {value !== null && (
            <div className={`h-full rounded-full ${met ? "bg-leaf" : "bg-amber"}`} style={{ width: `${(value / scale) * 100}%` }} />
          )}
          <div className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${(goal / scale) * 100}%` }}>
            <span className="absolute top-full left-1/2 mt-0.5 -translate-x-1/2 text-xs whitespace-nowrap text-muted tabular-nums">{goalLabel}</span>
          </div>
        </div>
      </div>
      <p className="mt-auto text-sm text-muted">{target}</p>
      <p className="mt-2">
        {met === null ? (
          <Pill icon="clock">Cannot tell yet</Pill>
        ) : met ? (
          <Pill tone="green" icon="check">
            Met
          </Pill>
        ) : (
          <Pill tone="amber" icon="alert">
            Not met
          </Pill>
        )}
      </p>
    </li>
  );
}

const SERIES = [
  { key: "leads", label: "Leads", colour: "#86b89c" },
  { key: "booked", label: "Booked", colour: "#3f8a66" },
  { key: "attended", label: "Attended", colour: "#1e4a38" },
] as const;

/** Ordered stages on one count axis, so one hue from light to dark. Values at the caps of the first and last; the table holds the rest. */
function SourceChart({ rows }: { rows: { label: string; figures: SourceFigures }[] }) {
  const largest = Math.max(1, ...rows.map((r) => r.figures.leads));
  const summary = rows.map((r) => `${r.label}: ${r.figures.leads} leads, ${r.figures.booked} booked, ${r.figures.attended} attended`).join(". ");
  return (
    <figure className={card}>
      <figcaption className={sectionTitle}>Leads to visits, by source</figcaption>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-sm" style={{ background: s.colour }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div role="img" aria-label={`${summary}.`}>
        <div aria-hidden className="mt-8 grid h-44 grid-cols-4 gap-2 border-b border-line">
          {rows.map((row) => (
            <div key={row.label} className="flex items-end justify-center gap-0.5">
              {SERIES.map((s) => {
                const value = row.figures[s.key];
                return (
                  <div
                    key={s.key}
                    title={`${row.label}, ${s.label.toLowerCase()}: ${value}`}
                    className="relative w-1/4 max-w-6 rounded-t"
                    style={{ height: `${(value / largest) * 100}%`, background: s.colour }}
                  >
                    {s.key !== "booked" && (
                      <span className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 text-xs text-ink tabular-nums">{value}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div aria-hidden className="mt-2 grid grid-cols-4 gap-2 text-center text-sm text-muted">
          {rows.map((row) => (
            <span key={row.label}>{row.label}</span>
          ))}
        </div>
      </div>
    </figure>
  );
}

/** One series, so one colour. The value sits at the tip of the bar in ink, and the table holds the rest. */
function CostChart({ rows }: { rows: { label: string; cost: number | null; attended: number }[] }) {
  const costs = rows.map((r) => r.cost).filter((c) => c !== null);
  if (costs.length < 2) return null; // One bar says nothing the table does not.
  const largest = Math.max(...costs);
  const sorted = rows.toSorted((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity));
  return (
    <figure className={card}>
      <figcaption className={sectionTitle}>Cost per attended visit, lowest first</figcaption>
      <ul className="mt-5 space-y-5">
        {sorted.map((row) => (
          <li key={row.label}>
            <span className="text-sm">{row.label}</span>
            {row.cost === null ? (
              <Small> no visits yet</Small>
            ) : (
              <span className="mt-1 flex items-center gap-2">
                <span aria-hidden className="h-3 rounded-r bg-neem" style={{ width: `calc((100% - 9rem) * ${row.cost / largest})` }} />
                <span className="whitespace-nowrap tabular-nums">
                  {rupees(row.cost)}{" "}
                  <Small>
                    from {row.attended} {row.attended === 1 ? "visit" : "visits"}
                  </Small>
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireHead();
  const range = parseRange((await searchParams).range);
  const { sources, total } = await getDashboard(user, rangeDates(range, new Date()));
  const targets = checkTargets(total);
  const rows: { key: string; label: string; figures: SourceFigures }[] = [
    ...sources.map((s) => ({ key: s.source, label: SOURCE_LABELS[s.source], figures: s })),
    { key: "total", label: "Total", figures: total },
  ];

  return (
    <main>
      <h1 className={`mt-8 ${pageTitle}`}>Source dashboard</h1>
      <p className="mt-2 text-muted">Leads whose first enquiry falls in the period. Demo data: every figure comes from made-up sample leads.</p>

      <nav aria-label="Date range" className="mt-5 flex flex-wrap gap-2">
        {(Object.keys(RANGES) as RangeKey[]).map((key) => (
          <Link key={key} href={`/dashboard?range=${key}`} aria-current={key === range ? "page" : undefined} className={chip(key === range)}>
            {RANGES[key].label}
          </Link>
        ))}
      </nav>

      <section className="mt-8">
        <h2 className={sectionTitle}>Success targets</h2>
        <ul className="mt-3 grid gap-4 md:grid-cols-3">
          <Target
            name="Median first response"
            icon="clock"
            current={total.medianResponseMs === null ? "—" : formatDuration(total.medianResponseMs)}
            value={total.medianResponseMs}
            goal={5 * 60_000}
            ceiling={10 * 60_000}
            goalLabel="5 min"
            target="Target: under 5 minutes"
            met={targets.medianResponse}
          />
          <Target
            name="Leads not reached within 48 hours"
            icon="phone"
            current={total.notReachedRate === null ? "—" : percent(total.notReachedRate)}
            value={total.notReachedRate}
            goal={0.05}
            ceiling={0.35}
            goalLabel="5%"
            target="Target: from 35% to under 5%"
            met={targets.notReached}
          />
          <Target
            name="Lead to attended visit"
            icon="calendar"
            current={total.leadToVisitRate === null ? "—" : percent(total.leadToVisitRate)}
            value={total.leadToVisitRate}
            goal={0.08}
            ceiling={0.12}
            goalLabel="8%"
            target="Target: from 6% to 8%"
            met={targets.leadToVisit}
          />
        </ul>
      </section>

      {total.leads === 0 ? (
        <div className={`mt-8 max-w-md ${card}`}>
          <p className={sectionTitle}>No leads in this period</p>
          <p className="mt-2 text-muted">The targets and the table fill in once a first enquiry falls in the period. Try a longer one.</p>
          <Link href="/dashboard?range=all" className="mt-3 inline-flex min-h-11 items-center underline underline-offset-4">
            Show all time
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 xl:grid-cols-[3fr_2fr]">
            <SourceChart rows={sources.map((s) => ({ label: SOURCE_LABELS[s.source], figures: s }))} />
            <CostChart rows={sources.map((s) => ({ label: SOURCE_LABELS[s.source], cost: s.costPerVisit, attended: s.attended }))} />
          </div>

          <section className="mt-8">
            <h2 className={sectionTitle}>By source</h2>
            <p className="mt-1 text-sm text-muted">Assumes {rupees(COST_PER_LEAD)} per lead for every source. Real spend per source is not recorded.</p>

            <ul className="mt-3 space-y-3 md:hidden">
              {rows.map((row) => (
                <li key={row.key} className={card}>
                  <h3 className="font-semibold">{row.label}</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 tabular-nums">
                    {COLUMNS.map((column) => (
                      <div key={column.label}>
                        <dt className="text-sm text-muted">{column.label}</dt>
                        <dd>{column.cell(row.figures)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>

            <div className={`mt-3 hidden overflow-x-auto md:block ${surface}`}>
              <table className="w-full border-collapse text-left text-[15px]">
                <thead>
                  <tr className="border-b border-line text-sm text-muted">
                    <th scope="col" className="px-5 py-3 font-medium">
                      Source
                    </th>
                    {COLUMNS.map((column) => (
                      <th key={column.label} scope="col" className="py-3 pr-4 font-medium">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                  {rows.map((row) => (
                    <tr key={row.key} className={`align-top ${row.key === "total" ? "bg-neem-soft/50 font-medium" : ""}`}>
                      <th scope="row" className="px-5 py-3.5 text-left font-medium">
                        {row.label}
                      </th>
                      {COLUMNS.map((column) => (
                        <td key={column.label} className="py-3.5 pr-4">
                          {column.cell(row.figures)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`mt-8 ${card}`}>
            <h2 className={sectionTitle}>How to read these figures</h2>
            <ul className="mt-3 max-w-3xl list-disc space-y-2 pl-5 text-muted">
              <li>
                A repeat enquiry from a phone already seen is not a new paid lead. The person stays with the source of their first
                enquiry and is costed once.
                {total.repeats > 0 &&
                  ` ${total.repeats} left out here. If a source bills for repeats, the true cost is up to ${rupees(total.repeats * COST_PER_LEAD)} higher.`}
              </li>
              <li>
                First response is measured from the first enquiry, and leads with no reply are not in the median. A lead with no reply
                counts as not reached once it is 48 hours old, and until then it is left out of that percentage.
              </li>
              <li>
                Booked counts every visit except cancelled ones, which count nowhere. Attended counts only visits recorded as visited, so
                a recent period can still gain visits ({total.upcoming} still ahead here).
              </li>
              <li>
                Show-up rate is visited out of visited plus no-show. {total.unrecorded} past {total.unrecorded === 1 ? "visit has" : "visits have"} nothing
                recorded and {total.unrecorded === 1 ? "is" : "are"} left out. An unrecorded visit closes as a no-show on its own when the
                buyer rebooks, so this rate can read low.
              </li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
