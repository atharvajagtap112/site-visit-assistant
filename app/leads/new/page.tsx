import type { Metadata } from "next";
import { listProjects } from "@/lib/leads";
import { requireUser } from "@/lib/session";
import { NewLeadForm } from "./new-lead-form";

export const metadata: Metadata = { title: "Add lead | Company A Homes", robots: "noindex" };

export default async function NewLeadPage() {
  const user = await requireUser();
  const projects = await listProjects();

  return (
    <main className="max-w-xl">
      <h1 className="mt-10 font-serif text-4xl">Add lead</h1>
      <p className="mt-2 text-muted">
        {user.role === "sales_head"
          ? "It goes to the executive with the fewest leads."
          : "It is assigned to you."}{" "}
        A repeat phone number stays with the executive who already handles that buyer.
      </p>
      <NewLeadForm projects={projects} />
    </main>
  );
}
