"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-6" role="alert">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-muted">The page failed to load. Reload it, or restart the web app if the problem continues.</p>
      <button onClick={reset} className="mt-4 rounded-md bg-ink px-4 py-2 text-white">
        Reload page
      </button>
    </main>
  );
}
