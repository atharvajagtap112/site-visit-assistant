import type { ReactNode } from "react";

const WINDOW_W = 22;
const WINDOW_H = 30;
const GAP = 14;

export function Tower({
  x,
  floors,
  cols,
  lit,
}: {
  x: number;
  floors: number;
  cols: number;
  lit?: [number, number];
}) {
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

/** Line drawings of buildings with one home lit, standing in for photography. */
export function Elevation({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 800 900"
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-0 h-full w-full text-white/25"
    >
      {children}
    </svg>
  );
}
