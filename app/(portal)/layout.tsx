import '@/app/globals.css'

/**
 * Portal layout — separate from the main app layout.
 * No sidebar, no app-level auth, no tenant theming.
 * Customers access this via magic-link email.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Minimal header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-eq-sky flex items-center justify-center">
              <span className="text-white font-bold text-sm">EQ</span>
            </div>
            <span className="text-sm font-bold text-eq-ink">Customer Portal</span>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  )
}
