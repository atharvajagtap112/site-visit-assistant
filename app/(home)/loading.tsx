export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-8" aria-busy="true">
      <div className="h-24 max-w-2xl animate-pulse rounded-2xl bg-line motion-reduce:animate-none" />
      <div className="mt-10 h-96 animate-pulse rounded-2xl bg-line/60 motion-reduce:animate-none" />
    </div>
  );
}
