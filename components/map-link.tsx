export function MapLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-2 text-neem underline underline-offset-4"
    >
      <svg aria-hidden viewBox="0 0 16 20" className="h-5 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 19s7-6.2 7-11A7 7 0 0 0 1 8c0 4.8 7 11 7 11Z" />
        <circle cx="8" cy="8" r="2.5" />
      </svg>
      {label}
    </a>
  );
}
