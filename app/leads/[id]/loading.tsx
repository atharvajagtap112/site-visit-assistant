export default function Loading() {
  return (
    <div role="status" aria-label="Loading this lead" className="py-10">
      <div className="h-10 w-64 animate-pulse rounded-2xl bg-line motion-reduce:animate-none" />
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-line/60 motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
