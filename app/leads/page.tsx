import type { Metadata } from "next";
import { formatWait, SOURCE_LABELS, visitLabel } from "@/lib/format";
import { listLeadsFor, type LeadRow } from "@/lib/leads";
import { requireUser } from "@/lib/session";
import { signOut } from "../sign-in/actions";

export const metadata: Metadata = { title: "Leads | Company A Homes", robots: "noindex" };

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

const describe = (lead: LeadRow) => [lead.project, lead.wants].filter(Boolean).join(", ");

export default async function LeadsPage() {
  const user = await requireUser();
  const leads = await listLeadsFor(user);
  const isHead = user.role === "sales_head";

  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
      <header className="flex items-center justify-between border-b border-line py-5">
        <p className="font-serif text-xl">Company A Homes</p>
        <form action={signOut} className="flex items-center gap-4">
          <span className="hidden text-muted sm:inline">{user.name}</span>
          <button className="rounded px-1 py-2 font-medium underline-offset-4 hover:underline">
            Sign out
          </button>
        </form>
      </header>

      <main>
        <h1 className="mt-10 font-serif text-4xl">{isHead ? "All leads" : "Your leads"}</h1>
        <p className="mt-2 text-muted tabular-nums">
          {leads.length} {leads.length === 1 ? "lead" : "leads"}
        </p>

        {leads.length === 0 ? (
          <p className="mt-12 max-w-md text-muted">
            No leads are assigned to you yet. New enquiries appear here as soon as they reach you.
          </p>
        ) : (
          <>
            <ul className="mt-8 divide-y divide-line border-y border-line md:hidden">
              {leads.map((lead) => (
                <li key={lead.id} className="py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">{lead.name ?? "Name not given"}</p>
                    <p className="text-sm text-muted tabular-nums">LD-{lead.id}</p>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {SOURCE_LABELS[lead.source]}, {describe(lead)}
                  </p>
                  <p className="mt-2 text-sm">
                    <Visit lead={lead} />
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    First reply: <FirstResponse lead={lead} />
                  </p>
                </li>
              ))}
            </ul>

            <table className="mt-8 hidden w-full border-collapse text-left text-[15px] md:table">
              <thead>
                <tr className="border-b border-ink text-sm text-muted">
                  <th className="py-3 pr-4 font-medium">Lead</th>
                  <th className="py-3 pr-4 font-medium">Source</th>
                  <th className="py-3 pr-4 font-medium">Interested in</th>
                  <th className="py-3 pr-4 font-medium">Visit</th>
                  {isHead && <th className="py-3 pr-4 font-medium">Assigned to</th>}
                  <th className="py-3 text-right font-medium">First reply</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td className="py-3.5 pr-4">
                      <span className="block font-medium">{lead.name ?? "Name not given"}</span>
                      <span className="text-sm text-muted tabular-nums">LD-{lead.id}</span>
                    </td>
                    <td className="py-3.5 pr-4">{SOURCE_LABELS[lead.source]}</td>
                    <td className="py-3.5 pr-4">{describe(lead)}</td>
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
          </>
        )}
      </main>
    </div>
  );
}
