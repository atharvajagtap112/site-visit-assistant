import Link from "next/link";
import { primaryButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/session";

export default async function NotFound() {
  const user = await getCurrentUser();
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="font-serif text-4xl">Page not found</h1>
      <p className="mt-3 text-muted">There is nothing at this address that you can open. Check the link, or start again from here.</p>
      <Link href={user ? "/leads" : "/"} className={`mt-6 inline-block ${primaryButton}`}>
        {user ? "Back to leads" : "Go to the home page"}
      </Link>
    </main>
  );
}
