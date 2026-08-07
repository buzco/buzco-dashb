export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    // Translucent so the starfield mosaic behind it stays visible.
    <div className="flex min-h-screen flex-1 items-center justify-center bg-paper/50 px-4 text-ink">
      {children}
    </div>
  );
}
