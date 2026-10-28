export default function Home() {
  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground sm:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex items-center justify-between rounded-3xl bg-surface px-6 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_8px_24px_rgba(0,0,0,0.28)]">
          <div>
            <p className="text-sm text-muted">CS3227 project</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Developer workspace</h1>
          </div>
          <span className="rounded-full bg-surface-elevated px-4 py-2 text-sm text-muted">
            Setup preview
          </span>
        </header>

        <section className="rounded-3xl bg-surface px-6 py-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_8px_24px_rgba(0,0,0,0.28)] sm:px-8">
          <p className="text-sm font-medium text-accent">Next.js · Tailwind CSS</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">The app shell is ready.</h2>
          <p className="mt-3 max-w-2xl leading-7 text-muted">
            This starter page confirms the App Router and Tailwind utility styles are connected.
            Developer workspace features can now be built into this shell.
          </p>
        </section>
      </div>
    </main>
  );
}
