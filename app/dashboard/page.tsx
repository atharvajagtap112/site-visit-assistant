import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
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

function Target({ name, current, target, met }: { name: string; current: string; target: string; met: boolean | null }) {
  return (
    <li className="grid gap-x-6 gap-y-0.5 py-4 sm:grid-cols-[1.5fr_1fr_1.5fr_0.7fr] sm:items-baseline">
      <span className="font-medium">{name}</span>
      <span className="font-serif text-2xl tabular-nums">{current}</span>
      <span className="text-muted">{target}</span>
      <span className={`font-medium ${met === null ? "text-muted" : met ? "text-neem" : "text-alert"}`}>
        {met === null ? "Cannot tell yet" : met ? "Met" : "Not met"}
      </span>
    </li>
  );
}

/** One series, so one colour. The value sits at the tip of the bar in ink, and the table holds the rest. */
function CostChart({ rows }: { rows: { label: string; cost: number | null; attended: number }[] }) {
  const costs = rows.map((r) => r.cost).filter((c) => c !== null);
  if (costs.length < 2) return null; // One bar says nothing the table does not.
  const largest = Math.max(...costs);
  const sorted = rows.toSorted((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity));
  return (
    <figure className="mt-12">
      <figcaption className="font-serif text-2xl">Cost per attended visit, lowest first</figcaption>
      <ul className="mt-4 max-w-3xl space-y-4">
        {sorted.map((row) => (
          <li key={row.label} className="grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr] sm:items-center">
            <span>{row.label}</span>
            {row.cost === null ? (
              <Small>no visits yet</Small>
            ) : (
              <span className="flex items-center gap-2">
                <span aria-hidden className="h-5 rounded-r bg-neem" style={{ width: `calc((100% - 10rem) * ${row.cost / largest})` }} />
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
      <h1 className="mt-10 font-serif text-4xl">Source dashboard</h1>
      <p className="mt-2 text-muted">Leads whose first enquiry falls in the period. Demo data: every figure comes from made-up sample leads.</p>

      <nav aria-label="Date range" className="mt-6 flex flex-wrap gap-x-5 gap-y-1">
        {(Object.keys(RANGES) as RangeKey[]).map((key) => (
          <Link
            key={key}
            href={`/dashboard?range=${key}`}
            aria-current={key === range ? "page" : undefined}
            className={`py-2 underline-offset-4 hover:underline ${key === range ? "font-medium underline" : "text-muted"}`}
          >
            {RANGES[key].label}
          </Link>
        ))}
      </nav>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Success targets</h2>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          <Target
            name="Median first response"
            current={total.medianResponseMs === null ? "—" : formatDuration(total.medianResponseMs)}
            target="Target: under 5 minutes"
            met={targets.medianResponse}
          />
          <Target
            name="Leads not reached within 48 hours"
            current={total.notReachedRate === null ? "—" : percent(total.notReachedRate)}
            target="Target: from 35% to under 5%"
            met={targets.notReached}
          />
          <Target
            name="Lead to attended visit"
            current={total.leadToVisitRate === null ? "—" : percent(total.leadToVisitRate)}
            target="Target: from 6% to 8%"
            met={targets.leadToVisit}
          />
        </ul>
      </section>

      {total.leads === 0 ? (
        <div className="mt-12 max-w-md">
          <p className="font-serif text-2xl">No leads in this period</p>
          <p className="mt-2 text-muted">The targets and the table fill in once a first enquiry falls in the period. Try a longer one.</p>
          <Link href="/dashboard?range=all" className="mt-4 inline-block py-2 underline underline-offset-4">
            Show all time
          </Link>
        </div>
      ) : (
        <>
          <section className="mt-12">
            <h2 className="font-serif text-2xl">By source</h2>
            <p className="mt-1 text-sm text-muted">Assumes {rupees(COST_PER_LEAD)} per lead for every source. Real spend per source is not recorded.</p>

            <ul className="mt-4 divide-y divide-line border-y border-line md:hidden">
              {rows.map((row) => (
                <li key={row.key} className="py-4">
                  <h3 className="font-medium">{row.label}</h3>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 tabular-nums">
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

            <table className="mt-4 hidden w-full border-collapse text-left text-[15px] md:table">
              <thead>
                <tr className="border-b border-ink text-sm text-muted">
                  <th scope="col" className="py-3 pr-4 font-medium">
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
                  <tr key={row.key} className={`align-top ${row.key === "total" ? "border-t-2 border-ink font-medium" : ""}`}>
                    <th scope="row" className="py-3.5 pr-4 text-left font-medium">
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
          </section>

          <CostChart rows={sources.map((s) => ({ label: SOURCE_LABELS[s.source], cost: s.costPerVisit, attended: s.attended }))} />

          <section className="mt-12 max-w-3xl">
            <h2 className="font-serif text-2xl">How to read these figures</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
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
