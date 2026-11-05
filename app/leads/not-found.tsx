import Link from "next/link";
import { primaryButton } from "@/components/ui";

export default function LeadNotFound() {
  return (
    <main className="mt-10 max-w-md rounded-3xl bg-white p-8 shadow-soft">
      <h1 className="text-3xl font-semibold tracking-tight">Lead not found</h1>
      <p className="mt-3 text-muted">
        There is no lead at this address that you can open. Check the lead ID, or find the lead in your list.
      </p>
      <Link href="/leads" className={`mt-6 ${primaryButton}`}>
        Back to leads
      </Link>
    </main>
  );
}
