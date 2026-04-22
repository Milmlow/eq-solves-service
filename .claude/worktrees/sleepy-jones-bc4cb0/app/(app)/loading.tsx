export default function AppLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="flex gap-1.5" aria-label="Loading" role="status">
        <span className="h-2 w-2 rounded-full bg-eq-sky animate-bounce [animation-delay:-0.3s]" />
        <span className="h-2 w-2 rounded-full bg-eq-sky animate-bounce [animation-delay:-0.15s]" />
        <span className="h-2 w-2 rounded-full bg-eq-sky animate-bounce" />
      </div>
    </div>
  )
}
