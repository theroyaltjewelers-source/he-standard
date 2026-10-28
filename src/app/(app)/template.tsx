/** Re-mounts on navigation so each page settles in (180–320 ms, reduced-motion aware). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="settle page-flow">{children}</div>;
}
