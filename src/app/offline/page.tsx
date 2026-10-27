export const metadata = { title: "Offline" };

export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <div className="mb-6 h-px w-16 bg-emerald" aria-hidden />
      <h1 className="h-page">You&apos;re offline</h1>
      <p className="serif mt-3 text-lg text-ivory-dim">
        Nothing was lost. Reminders are sent by the server, so they still arrive once your phone reconnects.
        Anything you were saving when the connection dropped needs to be submitted again.
      </p>
      <a href="/today" className="btn btn-quiet mt-8 self-start">Try again</a>
    </main>
  );
}
