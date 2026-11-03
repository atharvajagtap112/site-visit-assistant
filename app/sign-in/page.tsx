import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in | Company A Homes", robots: "noindex" };

const WINDOW_W = 22;
const WINDOW_H = 30;
const GAP = 14;

function Tower({ x, floors, cols, lit }: { x: number; floors: number; cols: number; lit?: [number, number] }) {
  const width = cols * (WINDOW_W + GAP) + GAP;
  const height = floors * (WINDOW_H + GAP) + GAP;
  const top = 900 - height;
  return (
    <g>
      <rect x={x} y={top} width={width} height={height} fill="none" stroke="currentColor" />
      {Array.from({ length: floors * cols }, (_, i) => {
        const floor = Math.floor(i / cols);
        const col = i % cols;
        const isLit = lit?.[0] === floor && lit?.[1] === col;
        return (
          <rect
            key={i}
            x={x + GAP + col * (WINDOW_W + GAP)}
            y={top + GAP + floor * (WINDOW_H + GAP)}
            width={WINDOW_W}
            height={WINDOW_H}
            fill={isLit ? "#fff" : "none"}
            stroke={isLit ? "#fff" : "currentColor"}
          />
        );
      })}
    </g>
  );
}

/** The client's two projects drawn as elevations, with one home lit. */
function Elevation() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 640 900"
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-0 h-full w-full text-white/25"
    >
      <Tower x={70} floors={17} cols={6} lit={[6, 3]} />
      <Tower x={330} floors={12} cols={6} />
    </svg>
  );
}

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/leads");

  return (
    <div className="grid min-h-dvh md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col justify-center px-6 py-14 sm:px-16">
        <div className="mx-auto w-full max-w-sm">
          <p className="font-serif text-xl">Company A Homes</p>
          <h1 className="mt-10 font-serif text-4xl">Sign in</h1>
          <p className="mt-3 text-muted">For the sales team. See your leads and site visits.</p>
          <SignInForm />
        </div>
      </main>
      <div className="relative order-first h-32 overflow-hidden bg-neem md:order-0 md:h-auto">
        <Elevation />
      </div>
    </div>
  );
}
