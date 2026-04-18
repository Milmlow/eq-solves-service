import { useEffect, useState } from 'react'

const STORAGE_KEY = 'eq-capturer-name'
const LISTENERS = new Set<(v: string | null) => void>()

function read(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v && v.trim() ? v : null
  } catch {
    return null
  }
}

function write(name: string | null) {
  if (name && name.trim()) localStorage.setItem(STORAGE_KEY, name.trim())
  else localStorage.removeItem(STORAGE_KEY)
  LISTENERS.forEach(fn => fn(name))
}

/**
 * Who is currently capturing. Persists across reloads. First run
 * returns null → caller shows the NameModal.
 */
export function useCapturer() {
  const [name, setNameState] = useState<string | null>(() => read())

  useEffect(() => {
    const fn = (v: string | null) => setNameState(v)
    LISTENERS.add(fn)
    return () => {
      LISTENERS.delete(fn)
    }
  }, [])

  const setName = (v: string | null) => {
    write(v)
    setNameState(v)
  }

  const initials = name
    ? name
        .split(/\s+/)
        .map(n => n[0] || '')
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : null

  return { name, setName, initials }
}
