"use client";

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <h1 className="text-lg font-semibold text-slate-900">That did not work</h1>
      <p className="muted mt-2">{error.message || "Something went wrong on our side. Nothing was changed."}</p>
      <button onClick={reset} className="btn btn-primary mt-4">Try again</button>
    </div>
  );
}
