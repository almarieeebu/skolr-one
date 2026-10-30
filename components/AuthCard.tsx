// The small centered card of /login, /forgot-password and /reset-password.

export default function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-rail text-sm font-bold text-on-rail" aria-hidden>
            E
          </span>
          <div>
            <p className="text-base font-semibold leading-tight">School enrollment</p>
            <p className="text-xs text-muted">Registrar, cashier, teachers and families</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
