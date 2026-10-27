import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="h-page">Not found</h1>
      <p className="mt-2 text-ivory-dim">That page doesn&apos;t exist, or it belongs to a record that was deleted.</p>
      <Link href="/today" className="btn btn-quiet mt-6 self-start">Back to today</Link>
    </main>
  );
}
