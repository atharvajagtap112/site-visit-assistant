import Link from "next/link";
import { primaryButton } from "@/components/ui";

export default function LeadNotFound() {
  return (
    <main className="max-w-md py-16">
      <h1 className="font-serif text-4xl">Lead not found</h1>
      <p className="mt-3 text-muted">
        There is no lead at this address that you can open. Check the lead ID, or find the lead in your list.
      </p>
      <Link href="/leads" className={`mt-6 inline-block ${primaryButton}`}>
        Back to leads
      </Link>
    </main>
  );
}
