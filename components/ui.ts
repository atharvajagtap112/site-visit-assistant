const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-center font-medium transition-colors disabled:opacity-60";
export const primaryButton = `${button} bg-neem text-white hover:bg-neem-dark`;
export const secondaryButton = `${button} border border-line-strong bg-white hover:border-neem hover:bg-neem-soft`;
export const rowInput = "min-h-11 w-full rounded-xl border border-line-strong bg-white px-3.5 py-2.5 text-base placeholder:text-muted";
export const textInput = `mt-1 ${rowInput}`;
export const surface = "rounded-2xl bg-white shadow-soft ring-1 ring-line/70";
export const card = `${surface} p-5 sm:p-6`;
export const pageTitle = "text-3xl font-semibold tracking-tight";
export const sectionTitle = "text-lg font-semibold";

export const chip = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium ${active ? "bg-neem text-white" : "bg-white text-muted ring-1 ring-line-strong/50 hover:text-ink hover:ring-neem"}`;

/** Never throws: a dropped connection comes back as ok false, so every caller can show an error. */
export async function postJson(url: string, body: unknown) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, data: await response.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: {} };
  }
}
