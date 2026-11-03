"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="font-serif text-3xl">This page could not load</h1>
      <p className="mt-3 text-muted">
        The server did not respond as expected. Your data has not changed.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-md bg-neem px-5 py-3 font-medium text-white hover:bg-neem-dark"
      >
        Try again
      </button>
    </main>
  );
}
