import type { Metadata } from "next";
import { listFactSheet, placeholderFields } from "@/lib/admin";
import { card, pageTitle, sectionTitle } from "@/components/ui";
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
        <ul className="mt-2 divide-y divide-line">
          {facts.map((fact) => (
            <FactRow key={fact.id} fact={fact} changed={formatVisitTime(fact.updatedAt)} />
          ))}
        </ul>
      )}
      <details className="mt-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-neem underline underline-offset-4">Add a fact</summary>
        <FactForm projectId={projectId} label="Add fact" />
      </details>
    </>
  );
}

export default async function FactsPage() {
  const user = await requireHead();
  const { projects, facts } = await listFactSheet(user);

  return (
    <main className="max-w-4xl">
      <h1 className={`mt-6 ${pageTitle}`}>Fact sheet</h1>
      <p className="mt-2 text-muted">The assistant can only quote amounts written on this page. It withholds any other amount and hands the chat to a person.</p>

      <section className={`mt-6 ${card}`}>
        <h2 className={sectionTitle}>All projects</h2>
        <FactGroup facts={facts.filter((f) => f.projectId === null)} projectId={null} />
      </section>

      {projects.map((project) => {
        const placeholders = placeholderFields(project);
        return (
          <section key={project.id} className={`mt-6 ${card}`}>
            <h2 className={sectionTitle}>{project.name}</h2>
            {placeholders.length > 0 && (
              <p role="alert" className="mt-3 rounded-xl bg-amber-soft px-3 py-2 text-amber">
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
