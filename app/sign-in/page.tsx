import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Elevation, Tower } from "@/components/elevation";
import { getCurrentUser } from "@/lib/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in | Company A Homes", robots: "noindex" };

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/leads");

  return (
    <div className="grid min-h-dvh md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col justify-center px-6 py-14 sm:px-16">
        <div className="mx-auto w-full max-w-sm">
          <p className="font-serif text-xl">Company A Homes</p>
          <h1 className="mt-10 font-serif text-4xl">Sign in</h1>
          <p className="mt-3 text-muted">For the sales team. See your leads and site visits.</p>
          <SignInForm />
        </div>
      </main>
      <div className="relative order-first h-32 overflow-hidden bg-neem md:order-0 md:h-auto">
        <Elevation>
          <Tower x={70} floors={17} cols={6} lit={[6, 3]} />
          <Tower x={330} floors={12} cols={6} />
        </Elevation>
      </div>
    </div>
  );
}
