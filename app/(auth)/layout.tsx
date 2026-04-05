export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-eq-ice flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="text-2xl font-bold text-eq-ink tracking-tight">
            EQ <span className="text-eq-sky">Solves</span>
          </div>
          <div className="text-xs text-eq-grey uppercase tracking-wide mt-1">
            Service Platform
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-8">
          {children}
        </div>
      </div>
    </div>
  )
}
