import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Avatar, Pill } from "@/components/bits";
import { card, chip, pageTitle, secondaryButton } from "@/components/ui";
import { FLAG_FILTERS, listFlagged, parseFlagFilter, type FlagFilter } from "@/lib/admin";
import { flagLabel, formatVisitTime } from "@/lib/format";
import { requireHead } from "@/lib/session";
import { markReviewedAction } from "../actions";

export const metadata: Metadata = { title: "Flagged chats | Company A Homes", robots: "noindex" };

const EMPTY: Record<FlagFilter, string> = {
  unreviewed: "Nothing to review. A chat appears here when the safety check withholds a reply.",
  reviewed: "No chats have been marked as reviewed yet.",
  all: "No chats have been flagged. A chat appears here when the safety check withholds a reply.",
};

const href = (filter: FlagFilter, page = 1) => `/admin/flagged?filter=${filter}${page > 1 ? `&page=${page}` : ""}`;

export default async function FlaggedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireHead();
  const params = await searchParams;
  const filter = parseFlagFilter(params.filter);
  const requested = Number(params.page);
  const { rows, total, page, pageCount } = await listFlagged(user, filter, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);

  return (
    <main className="max-w-4xl">
      <h1 className={`mt-6 ${pageTitle}`}>Flagged chats</h1>
      <p className="mt-2 text-muted">The buyer never saw these drafts. They saw the reply sent instead, and the chat went to a person.</p>

      <nav aria-label="Filter flagged chats" className="mt-4 flex flex-wrap gap-2">
        {(Object.keys(FLAG_FILTERS) as FlagFilter[]).map((key) => (
          <Link
            key={key}
            href={href(key)}
            aria-current={key === filter ? "page" : undefined}
            className={chip(key === filter)}
          >
            {FLAG_FILTERS[key]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className={`mt-6 text-muted ${card}`}>{EMPTY[filter]}</p>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted tabular-nums">
            {total} {total === 1 ? "chat" : "chats"}, newest first
          </p>
          <ul className="mt-3 space-y-4">
            {rows.map((chat) => (
              <li key={chat.id} className={card}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <Link href={`/leads/${chat.leadId}`} className="inline-flex min-h-11 items-center gap-3 font-medium underline underline-offset-4">
                    <Avatar name={chat.leadName} />
                    LD-{chat.leadId}, {chat.leadName ?? "name not given"}
                  </Link>
                  {chat.flaggedAt && <span className="text-sm text-muted tabular-nums">{formatVisitTime(chat.flaggedAt)}</span>}
                </div>
                <p className="mt-1">Withheld because {flagLabel(chat.flagReason)}.</p>

                {chat.withheld.length === 0 && <p className="mt-3 text-muted">No withheld draft was stored. See the full chat on the lead.</p>}
                {chat.withheld.map((turn) => (
                  <dl key={turn.id} className="mt-3 space-y-3">
                    <div>
                      <dt className="text-sm text-muted">Buyer wrote</dt>
                      <dd className="mt-0.5 break-words whitespace-pre-wrap">{turn.buyerMessage ?? "No buyer message found."}</dd>
                    </div>
                    <div className="rounded-xl bg-amber-soft px-3 py-2">
                      <dt className="text-sm font-medium text-amber">Withheld draft, staff only</dt>
                      <dd className="mt-0.5 break-words whitespace-pre-wrap">{turn.draft}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted">Sent to the buyer instead</dt>
                      <dd className="mt-0.5 break-words whitespace-pre-wrap">{turn.sent}</dd>
                    </div>
                  </dl>
                ))}

                <div className="mt-4">
                  {chat.reviewedAt ? (
                    <Pill tone="green" icon="check">Reviewed {formatVisitTime(chat.reviewedAt)}</Pill>
                  ) : (
                    <div className="sm:w-56">
                      <ActionForm action={markReviewedAction} fields={{ conversationId: chat.id }} label="Mark as reviewed" pendingLabel="Saving" />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {pageCount > 1 && (
            <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-4">
              {page > 1 ? (
                <Link href={href(filter, page - 1)} className={secondaryButton}>
                  Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-muted tabular-nums">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link href={href(filter, page + 1)} className={secondaryButton}>
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
