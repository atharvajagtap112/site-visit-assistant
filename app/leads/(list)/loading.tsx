export default function Loading() {
  return (
    <div role="status" aria-label="Loading leads" className="py-10">
      <div className="h-10 w-48 animate-pulse rounded-2xl bg-line motion-reduce:animate-none" />
      <div className="mt-10 space-y-5">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-2xl bg-line/60 motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
