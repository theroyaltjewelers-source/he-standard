import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/today";
  const linkError = sp.error === "link";
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-12">
        <div className="mb-6 h-px w-16 bg-emerald" aria-hidden />
        <h1 className="serif text-[3.25rem] leading-[1.02] font-light tracking-tight">The Standard</h1>
        <p className="serif mt-5 text-lg text-ivory-dim italic">
          Your standard is not what you say. It is what you consistently do.
        </p>
      </div>
      {linkError && (
        <p className="mb-6 rounded-[10px] border border-brass-deep bg-brass-deep/40 px-4 py-3 text-sm text-ivory">
          That link has expired or was already used. Sign in below or request a new one.
        </p>
      )}
      <LoginForm next={next} />
    </main>
  );
}
