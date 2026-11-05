export default function Loading() {
  return (
    <div role="status" aria-label="Loading the form" className="max-w-xl py-10">
      <div className="h-10 w-48 animate-pulse rounded-2xl bg-line motion-reduce:animate-none" />
      <div className="mt-10 space-y-6">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-2xl bg-line/60 motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
