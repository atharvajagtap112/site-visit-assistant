import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/bits";
import { SamplePhoto } from "@/components/sample-photo";
import { STRINGS } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in | Company A Homes", robots: "noindex" };

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/leads");

  return (
    <div lang="en" className="grid min-h-dvh gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col justify-center rounded-3xl bg-white px-6 py-10 shadow-soft sm:px-14">
        <div className="mx-auto w-full max-w-sm">
          <Logo />
          <h1 className="mt-8 text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-muted">For the sales team. See your leads and site visits.</p>
          <SignInForm />
        </div>
      </main>
      <div className="relative hidden overflow-hidden rounded-3xl bg-line md:block">
        <SamplePhoto index={1} alt={STRINGS.en.illustration} caption={STRINGS.en.samplePhoto} />
      </div>
    </div>
  );
}
