import type { Metadata } from "next";
import { listFactSheet, placeholderFields } from "@/lib/admin";
import { formatVisitTime } from "@/lib/format";
import { requireHead } from "@/lib/session";
import { FactForm, FactRow, ProjectForm } from "./forms";

export const metadata: Metadata = { title: "Fact sheet | Company A Homes", robots: "noindex" };

type Fact = Awaited<ReturnType<typeof listFactSheet>>["facts"][number];

function FactGroup({ facts, projectId }: { facts: Fact[]; projectId: number | null }) {
  return (
    <>
      {facts.length === 0 ? (
        <p className="mt-3 text-muted">No facts here yet, so the assistant hands questions on this to a person.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {facts.map((fact) => (
            <FactRow key={fact.id} fact={fact} changed={formatVisitTime(fact.updatedAt)} />
          ))}
        </ul>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer py-2 font-medium underline underline-offset-4">Add a fact</summary>
        <FactForm projectId={projectId} label="Add fact" />
      </details>
    </>
  );
}

export default async function FactsPage() {
  const user = await requireHead();
  const { projects, facts } = await listFactSheet(user);

  return (
    <main className="max-w-3xl">
      <h1 className="mt-6 font-serif text-4xl">Fact sheet</h1>
      <p className="mt-2 text-muted">The assistant can only quote amounts written on this page. It withholds any other amount and hands the chat to a person.</p>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="font-serif text-2xl">All projects</h2>
        <FactGroup facts={facts.filter((f) => f.projectId === null)} projectId={null} />
      </section>

      {projects.map((project) => {
        const placeholders = placeholderFields(project);
        return (
          <section key={project.id} className="mt-12 border-t border-line pt-6">
            <h2 className="font-serif text-2xl">{project.name}</h2>
            {placeholders.length > 0 && (
              <p role="alert" className="mt-3 rounded-md bg-amber-soft px-3 py-2 text-amber">
                Still sample text: {placeholders.join(", ")}. Buyers can see this, so replace it with the real details before going live.
              </p>
            )}
            <ProjectForm project={project} />
            <h3 className="mt-8 font-medium">Facts for {project.name}</h3>
            <FactGroup facts={facts.filter((f) => f.projectId === project.id)} projectId={project.id} />
          </section>
        );
      })}
    </main>
  );
}
