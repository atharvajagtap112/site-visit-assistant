export default function Loading() {
  return (
    <div className="flex h-dvh flex-col" aria-busy="true">
      <div className="h-28 shrink-0 border-b border-line bg-white" />
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-6">
        <div className="h-6 w-2/3 animate-pulse rounded-2xl bg-line motion-reduce:animate-none" />
        <div className="h-6 w-1/2 animate-pulse rounded-2xl bg-line motion-reduce:animate-none" />
      </div>
    </div>
  );
}
