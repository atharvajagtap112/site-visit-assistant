export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-20 sm:px-8" aria-busy="true">
      <div className="h-10 w-48 animate-pulse rounded-2xl bg-line motion-reduce:animate-none" />
      <div className="mt-8 h-24 animate-pulse rounded-2xl bg-line/60 motion-reduce:animate-none" />
    </div>
  );
}
