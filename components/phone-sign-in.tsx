"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { requestError, STRINGS, type Language } from "@/lib/i18n";
import { postJson, primaryButton, textInput } from "./ui";

/** Lets a buyer reach their visit from a new phone or browser, after proving the number is theirs. */
export function PhoneSignIn({ language, showCodes }: { language: Language; showCodes: boolean }) {
  const t = STRINGS[language];
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    if (!demoCode) {
      const { ok, data } = await postJson("/api/buyer/code", { phone });
      setBusy(false);
      if (ok) setDemoCode(data.demoCode);
      else setError(requestError(t, data, t.actionFailed));
      return;
    }
    const { ok, data } = await postJson("/api/buyer/sign-in", { phone, code });
    setBusy(false);
    if (ok) return router.refresh();
    setError(requestError(t, data, t.actionFailed));
  }

  if (!showCodes) return <p className="mt-6 max-w-sm rounded-md bg-amber-soft px-3 py-2 text-sm text-amber">{t.codesUnavailable}</p>;

  return (
    <form onSubmit={submit} className="mt-6 max-w-sm space-y-4" noValidate>
      <p className="text-muted">{t.findVisitHelp}</p>
      <label className="block text-sm font-medium">
        {t.phone}
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={20}
          disabled={Boolean(demoCode)}
          className={`${textInput} font-normal`}
        />
      </label>
      {!demoCode && <p className="text-sm text-muted">{t.demoCodeNote}</p>}
      {demoCode && (
        <>
          <p className="rounded-md bg-neem-soft px-3 py-2 text-sm">
            {t.demoCode} <strong className="tabular-nums">{demoCode}</strong>
          </p>
          <label className="block text-sm font-medium">
            {t.enterCode}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              className={`${textInput} font-normal tabular-nums`}
            />
          </label>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={`w-full ${primaryButton}`}>
        {demoCode ? t.confirmDetails : t.sendCode}
      </button>
      {demoCode && (
        <button
          type="button"
          onClick={() => {
            setDemoCode(null);
            setCode("");
            setError(null);
          }}
          className="min-h-11 w-full text-sm text-muted underline underline-offset-4"
        >
          {t.newCode}
        </button>
      )}
    </form>
  );
}
