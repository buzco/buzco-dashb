export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`border border-line bg-surface ${className}`}>{children}</div>;
}
