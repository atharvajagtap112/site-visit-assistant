import type { ReactNode } from "react";

const PATHS = {
  alert: <path d="M12 8v5m0 3.5v.01M10.3 3.9 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  building: <path d="M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16m0-11h3a1 1 0 0 1 1 1v10M3 21h18M9 8h2m-2 4h2m-2 4h2" />,
  calendar: <path d="M7 3v4m10-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />,
  chart: <path d="M4 20h16M7 16v-5m5 5V6m5 10V8" />,
  chat: <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  clock: <path d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  cross: <path d="m6 6 12 12M18 6 6 18" />,
  flag: <path d="M5 21V4m0 1h12l-2.5 4 2.5 4H5" />,
  mail: <path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm-1 1 9 6 9-6" />,
  person: <path d="M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4.5 20.5a7.5 7.5 0 0 1 15 0" />,
  phone: <path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a3 3 0 0 1-3 3A15 15 0 0 1 3 6a3 3 0 0 1 3-3Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <path d="m20 20-4.2-4.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />,
  send: <path d="M12 19V5m-6 6 6-6 6 6" />,
  settings: <path d="M4 7h9m4 0h3M4 17h3m4 0h9M15 5v4M9 15v4" />,
  signOut: <path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4m5-12 4 4-4 4m4-4H10" />,
  users: <path d="M15 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM4 20a7.5 7.5 0 0 1 15 0M17 4.8a3.5 3.5 0 0 1 0 6.4M20 15.5a7.5 7.5 0 0 1 1 4.5" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      {PATHS[name]}
    </svg>
  );
}
