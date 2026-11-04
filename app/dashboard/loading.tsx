export default function Loading() {
  return (
    <div role="status" aria-label="Loading dashboard" className="py-10">
      <div className="h-10 w-64 animate-pulse rounded bg-line motion-reduce:animate-none" />
      <div className="mt-10 space-y-5">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-line/60 motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
