export const primaryButton =
  "rounded-md bg-neem px-5 py-3 text-center font-medium text-white hover:bg-neem-dark disabled:opacity-60";
export const secondaryButton =
  "rounded-md border border-line bg-white px-5 py-3 text-center font-medium hover:border-neem disabled:opacity-60";
export const textInput = "mt-1 w-full rounded-md border border-line bg-white px-3 py-3 text-base";

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
