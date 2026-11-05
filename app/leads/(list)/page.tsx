import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { secondaryButton, textInput } from "@/components/ui";
import { leadSourceEnum, leadStatusEnum } from "@/db/schema";
import { formatWait, SOURCE_LABELS, STATUS_LABELS, visitLabel } from "@/lib/format";
import {
  listExecutives,
  listLeadsFor,
  listProjects,
  PAGE_SIZE,
  parseLeadFilters,
  VISIT_STATES,
  type LeadFilters,
  type LeadRow,
} from "@/lib/leads";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Leads | Company A Homes", robots: "noindex" };

const leadLink = "font-medium underline-offset-4 hover:underline";

function Visit({ lead }: { lead: LeadRow }) {
  const { text, needsAction } = visitLabel(lead.visit);
  return needsAction ? (
    <span className="rounded bg-amber-soft px-2 py-1 text-amber">{text}</span>
  ) : (
    <span>{text}</span>
  );
}

function FirstResponse({ lead }: { lead: LeadRow }) {
  return lead.firstResponseAt ? (
    <span>{formatWait(lead.createdAt, lead.firstResponseAt)}</span>
  ) : (
    <span className="text-amber">No reply yet</span>
  );
}

/** What to look out for on this lead: nothing shows for most of them. */
function Warnings({ lead }: { lead: LeadRow }) {
  if (!lead.optedOutAt && !lead.duplicate) return null;
  return (
    <span className="mt-1 block space-y-0.5 text-sm">
      {lead.optedOutAt && <span className="block font-medium text-alert">Opted out, do not contact</span>}
      {lead.duplicate && (
        <span className="block text-amber">
          Same phone as{" "}
          {lead.duplicate.canOpen ? (
            <Link href={`/leads/${lead.duplicate.id}`} className="underline underline-offset-4">
              LD-{lead.duplicate.id}
            </Link>
          ) : (
            `LD-${lead.duplicate.id}, with another executive`
          )}
        </span>
      )}
    </span>
  );
}

const describe = (lead: LeadRow) => [lead.project, lead.wants].filter(Boolean).join(", ") || "Not stated yet";

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string | number;
  options: { value: string | number; label: string }[];
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <select name={name} defaultValue={value ?? ""} className={`${textInput} font-normal`}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function pageHref(filters: LeadFilters, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page })) {
    if (value !== undefined && !(key === "page" && value === 1)) query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `/leads?${text}` : "/leads";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isHead = user.role === "sales_head";
  const params = await searchParams;
  const filters = parseLeadFilters(params);
  if (!isHead) delete filters.executive; // Never honoured for an executive, so it should not look active.
  // The filter form sends every field, so an "All" comes through empty. Keeps links short and shareable.
  if (Object.values(params).includes("")) redirect(pageHref(filters, 1));
  const [{ rows, total, page, pageCount }, projects, executives] = await Promise.all([
    listLeadsFor(user, filters),
    listProjects(),
    isHead ? listExecutives() : [],
  ]);
  const { page: _page, ...active } = filters;
  const filtering = Object.values(active).some((value) => value !== undefined);
  const first = (page - 1) * PAGE_SIZE + 1;

  return (
    <main>
      <h1 className="mt-10 font-serif text-4xl">{isHead ? "All leads" : "Your leads"}</h1>
      <p className="mt-2 text-muted tabular-nums">
        {total === 0
          ? "No leads to show"
          : total <= PAGE_SIZE
            ? `${total} ${total === 1 ? "lead" : "leads"}`
            : `Showing ${first} to ${first + rows.length - 1} of ${total} leads, newest first`}
      </p>

      {/* The key resets the inputs when "Clear filters" changes the URL under them. */}
      <Form key={JSON.stringify(active)} action="/leads" className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <label className="col-span-2 block text-sm font-medium md:col-span-3 lg:col-span-6">
          Search by name, phone or lead ID
          <input type="search" name="q" defaultValue={filters.q} maxLength={100} className={`${textInput} font-normal`} />
        </label>
        <Select name="source" label="Source" value={filters.source} options={leadSourceEnum.enumValues.map((v) => ({ value: v, label: SOURCE_LABELS[v] }))} />
        <Select name="project" label="Project" value={filters.project} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <Select name="status" label="Status" value={filters.status} options={leadStatusEnum.enumValues.map((v) => ({ value: v, label: STATUS_LABELS[v] }))} />
        <Select name="visit" label="Visit" value={filters.visit} options={Object.entries(VISIT_STATES).map(([value, label]) => ({ value, label }))} />
        {isHead && <Select name="executive" label="Executive" value={filters.executive} options={executives.map((e) => ({ value: e.id, label: e.name }))} />}
        <div className="col-span-2 flex items-end gap-2 md:col-span-1">
          <button className={`flex-1 ${secondaryButton}`}>Apply</button>
          {filtering && (
            <Link href="/leads" className="px-2 py-3 whitespace-nowrap underline underline-offset-4">
              Clear
            </Link>
          )}
        </div>
      </Form>

      {rows.length === 0 ? (
        filtering ? (
          <div className="mt-12 max-w-md">
            <p className="font-serif text-2xl">No leads match these filters</p>
            <p className="mt-2 text-muted">Try a shorter search or fewer filters.</p>
            <Link href="/leads" className={`mt-5 inline-block ${secondaryButton}`}>
              Clear filters
            </Link>
          </div>
        ) : (
          <p className="mt-12 max-w-md text-muted">
            {isHead ? "There are no leads yet." : "No leads are assigned to you yet."} New enquiries appear here as soon as they
            arrive, or you can{" "}
            <Link href="/leads/new" className="underline underline-offset-4">
              add one yourself
            </Link>
            .
          </p>
        )
      ) : (
        <>
          <ul className="mt-8 divide-y divide-line border-y border-line md:hidden">
            {rows.map((lead) => (
              <li key={lead.id} className="py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/leads/${lead.id}`} className={`inline-flex min-h-11 items-center underline ${leadLink}`}>
                    {lead.name ?? "Name not given"}
                  </Link>
                  <p className="text-sm text-muted tabular-nums">LD-{lead.id}</p>
                </div>
                <Warnings lead={lead} />
                <p className="mt-1 text-sm text-muted">
                  {SOURCE_LABELS[lead.source]}, {describe(lead)}
                </p>
                <p className="mt-2 text-sm">
                  <Visit lead={lead} />
                </p>
                <p className="mt-2 text-sm text-muted">
                  {STATUS_LABELS[lead.status]}. First reply: <FirstResponse lead={lead} />
                </p>
                {isHead && <p className="mt-1 text-sm text-muted">Assigned to {lead.assignedTo ?? "nobody yet"}</p>}
              </li>
            ))}
          </ul>

          <table className="mt-8 hidden w-full border-collapse text-left text-[15px] md:table">
            <thead>
              <tr className="border-b border-ink text-sm text-muted">
                <th className="py-3 pr-4 font-medium">Lead</th>
                <th className="py-3 pr-4 font-medium">Source</th>
                <th className="py-3 pr-4 font-medium">Interested in</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                <th className="py-3 pr-4 font-medium">Visit</th>
                {isHead && <th className="py-3 pr-4 font-medium">Assigned to</th>}
                <th className="py-3 text-right font-medium">First reply</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((lead) => (
                <tr key={lead.id} className="align-top">
                  <td className="py-3.5 pr-4">
                    <Link href={`/leads/${lead.id}`} className={`block ${leadLink}`}>
                      {lead.name ?? "Name not given"}
                    </Link>
                    <span className="text-sm text-muted tabular-nums">LD-{lead.id}</span>
                    <Warnings lead={lead} />
                  </td>
                  <td className="py-3.5 pr-4">{SOURCE_LABELS[lead.source]}</td>
                  <td className="py-3.5 pr-4">{describe(lead)}</td>
                  <td className="py-3.5 pr-4">{STATUS_LABELS[lead.status]}</td>
                  <td className="py-3.5 pr-4 tabular-nums">
                    <Visit lead={lead} />
                  </td>
                  {isHead && <td className="py-3.5 pr-4">{lead.assignedTo ?? "Unassigned"}</td>}
                  <td className="py-3.5 text-right tabular-nums">
                    <FirstResponse lead={lead} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pageCount > 1 && (
            <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-4">
              {page > 1 ? (
                <Link href={pageHref(filters, page - 1)} className={secondaryButton}>
                  Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-muted tabular-nums">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link href={pageHref(filters, page + 1)} className={secondaryButton}>
                  Older
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
