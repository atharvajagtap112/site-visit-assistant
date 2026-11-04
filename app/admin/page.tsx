import { redirect } from "next/navigation";
import { requireHead } from "@/lib/session";

/** The daily review comes first. */
export default async function AdminPage() {
  await requireHead();
  redirect("/admin/flagged");
}
