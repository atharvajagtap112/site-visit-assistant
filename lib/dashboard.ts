import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { leadSourceEnum } from "../db/schema";
import { assertHead, type SessionUser } from "./auth";

/** ASSUMPTION from the brief: every source costs the same per lead. Replace with real spend per source when known. */
export const COST_PER_LEAD = 1000;

const DAY = 24 * 60 * 60 * 1000;

export const RANGES = {
  "7": { days: 7, label: "Last 7 days" },
  "30": { days: 30, label: "Last 30 days" },
  "90": { days: 90, label: "Last 90 days" },
  all: { days: null, label: "All time" },
} as const;
export type RangeKey = keyof typeof RANGES;

/** A hand-edited URL falls back to the default rather than an error. */
export const parseRange = (value: unknown): RangeKey =>
  z.enum(Object.keys(RANGES) as [RangeKey]).catch("30").parse(value);

export function rangeDates(key: RangeKey, now: Date) {
  const { days } = RANGES[key];
  return { from: days === null ? null : new Date(now.getTime() - days * DAY), to: now };
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

type Row = {
  source: string | null;
  leads: number;
  median_ms: number | null;
  not_reached: number;
  awaiting_reply: number;
  attended: number;
  no_show: number;
  upcoming: number;
  unrecorded: number;
  people_attended: number;
};

function figures(row: Row, repeats: number) {
  // Answered at any age, or unanswered and past the 48 hours: the ones that can be called reached or not.
  const judged = row.leads - row.awaiting_reply;
  return {
    /** People, not enquiries: a repeat enquiry from a phone already seen is not a new lead. */
    leads: row.leads,
    /** Enquiries in this period that were left out as repeats, under the source they came through. */
    repeats,
    /** Median of first reply minus first enquiry, over those answered. Unanswered leads show in notReached instead. */
    medianResponseMs: row.median_ms,
    /** No reply by 48 hours (an exact 48 hours old counts), or the first reply came later than 48 hours. */
    notReached: row.not_reached,
    /** No reply yet and under 48 hours old: left out of the percentage, since it can still be met. */
    awaitingReply: row.awaiting_reply,
    judged,
    notReachedRate: ratio(row.not_reached, judged),
    /** Every visit except cancelled ones. A cancelled or rescheduled-away visit never counts anywhere. */
    booked: row.attended + row.no_show + row.upcoming + row.unrecorded,
    attended: row.attended,
    noShow: row.no_show,
    upcoming: row.upcoming,
    /** Time has passed and staff recorded nothing. Not in show-up rate, which it could move either way. */
    unrecorded: row.unrecorded,
    /** visited / (visited + no_show). Unrecorded past visits auto-close as no_show on rebooking, so this can read low. */
    showUpRate: ratio(row.attended, row.attended + row.no_show),
    cost: row.leads * COST_PER_LEAD,
    /** Cost of the source's leads / attended visits. Null, not infinity, when nobody has attended. */
    costPerVisit: ratio(row.leads * COST_PER_LEAD, row.attended),
    /** People with at least one attended visit / people. Attended rather than booked, the stricter reading of the target. */
    leadToVisitRate: ratio(row.people_attended, row.leads),
  };
}

export type SourceFigures = ReturnType<typeof figures>;

/**
 * The source dashboard, for the people whose FIRST enquiry falls in [from, to]. `to` is also "now" for
 * ageing leads and telling future visits from past, so tests can pass fixed dates. Visits are counted
 * with their person whenever they happen, so a recent range under-counts visits still to come.
 *
 * Duplicates: same phone = same person, whether or not duplicateOfId was stored, since imports may
 * leave it empty. The person belongs to the source of their first enquiry, is costed once, and is
 * reached when any of their enquiries got a reply. Visits booked through a repeat enquiry count for
 * that person. If a source does bill for repeats the true cost is higher, so repeats are shown beside
 * the figures. A lead with no phone yet (a chat before the buyer gives details) counts as its own person.
 */
export async function getDashboard(user: SessionUser, { from, to }: { from: Date | null; to: Date }) {
  assertHead(user);
  const asOf = sql`${to.toISOString()}::timestamptz`;
  const notReachedLine = sql`${asOf} - interval '48 hours'`;
  const inRange = (column: SQL) =>
    sql`${column} <= ${asOf} ${from ? sql`AND ${column} >= ${from.toISOString()}::timestamptz` : sql``}`;

  const enquiries = sql`enquiries AS (
    SELECT id, source, created_at, first_response_at,
           coalesce(phone, 'lead-' || id) AS person,
           row_number() OVER (PARTITION BY coalesce(phone, 'lead-' || id) ORDER BY created_at, id) AS nth
    FROM leads
  )`;

  // ponytail: scans all leads per page load, fine for years at 3,000 a month. Add a daily rollup if it ever drags.
  const { rows } = await db.execute<Row>(sql`
    WITH ${enquiries},
    people AS (
      SELECT person,
             (array_agg(source ORDER BY nth))[1]::text AS source,
             min(created_at) AS enquired_at,
             min(first_response_at) AS replied_at
      FROM enquiries GROUP BY person
    ),
    person_visits AS (
      SELECT e.person,
             count(*) FILTER (WHERE v.status = 'visited') AS attended,
             count(*) FILTER (WHERE v.status = 'no_show') AS no_show,
             count(*) FILTER (WHERE v.status = 'booked' AND s.starts_at > ${asOf}) AS upcoming,
             count(*) FILTER (WHERE v.status = 'booked' AND s.starts_at <= ${asOf}) AS unrecorded
      FROM enquiries e
      JOIN visits v ON v.lead_id = e.id
      JOIN slots s ON s.id = v.slot_id
      GROUP BY e.person
    )
    SELECT p.source,
           count(*)::int AS leads,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM p.replied_at - p.enquired_at) * 1000))::float8 AS median_ms,
           (count(*) FILTER (WHERE
             p.replied_at - p.enquired_at > interval '48 hours'
             OR (p.replied_at IS NULL AND p.enquired_at <= ${notReachedLine})
           ))::int AS not_reached,
           (count(*) FILTER (WHERE p.replied_at IS NULL AND p.enquired_at > ${notReachedLine}))::int AS awaiting_reply,
           coalesce(sum(pv.attended), 0)::int AS attended,
           coalesce(sum(pv.no_show), 0)::int AS no_show,
           coalesce(sum(pv.upcoming), 0)::int AS upcoming,
           coalesce(sum(pv.unrecorded), 0)::int AS unrecorded,
           (count(*) FILTER (WHERE pv.attended > 0))::int AS people_attended
    FROM people p
    LEFT JOIN person_visits pv USING (person)
    WHERE ${inRange(sql`p.enquired_at`)}
    GROUP BY GROUPING SETS ((p.source), ())
  `);

  const { rows: repeatRows } = await db.execute<{ source: string; repeats: number }>(sql`
    WITH ${enquiries}
    SELECT source::text AS source, count(*)::int AS repeats
    FROM enquiries
    WHERE nth > 1 AND ${inRange(sql`created_at`)}
    GROUP BY source
  `);
  const repeatsFor = (source: string) => repeatRows.find((r) => r.source === source)?.repeats ?? 0;

  const empty: Row = { source: null, leads: 0, median_ms: null, not_reached: 0, awaiting_reply: 0, attended: 0, no_show: 0, upcoming: 0, unrecorded: 0, people_attended: 0 };
  return {
    sources: leadSourceEnum.enumValues.map((source) => ({
      source,
      ...figures(rows.find((r) => r.source === source) ?? empty, repeatsFor(source)),
    })),
    total: figures(rows.find((r) => r.source === null) ?? empty, repeatRows.reduce((sum, r) => sum + r.repeats, 0)),
  };
}

/** The brief's three success targets against the total row. Null when there is nothing to judge yet. */
export function checkTargets(total: SourceFigures) {
  const compare = (value: number | null, passes: (v: number) => boolean) => (value === null ? null : passes(value));
  return {
    medianResponse: compare(total.medianResponseMs, (ms) => ms < 5 * 60_000),
    notReached: compare(total.notReachedRate, (rate) => rate < 0.05),
    leadToVisit: compare(total.leadToVisitRate, (rate) => rate >= 0.08),
  };
}
