export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8" aria-busy="true">
      <div className="h-24 max-w-2xl animate-pulse rounded bg-line motion-reduce:animate-none" />
      <div className="mt-10 h-56 animate-pulse rounded bg-line/60 motion-reduce:animate-none" />
    </div>
  );
}
