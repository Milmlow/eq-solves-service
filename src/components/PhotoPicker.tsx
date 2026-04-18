import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Photo {
  id: string
  asset_id: string
  storage_path: string
  caption: string | null
  captured_at: string
}

interface Props {
  assetId: string
  jobId: string
}

const BUCKET = 'capture-photos'

export function PhotoPicker({ assetId, jobId }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [justUploaded, setJustUploaded] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<Photo | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    const { data, error: e } = await supabase
      .from('capture_photos')
      .select('*')
      .eq('asset_id', assetId)
      .order('captured_at', { ascending: false })
    if (!e && data) setPhotos(data as Photo[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [assetId])

  // Auto-dismiss the "uploaded" toast after a few seconds
  useEffect(() => {
    if (!justUploaded) return
    const id = setTimeout(() => setJustUploaded(0), 3000)
    return () => clearTimeout(id)
  }, [justUploaded])

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return
    setError(null)
    setUploading(true)
    setProgress({ done: 0, total: files.length })
    let uploaded = 0
    try {
      for (const f of Array.from(files)) {
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
        const ts = Date.now()
        const rand = Math.random().toString(36).slice(2, 8)
        const path = `${jobId}/${assetId}/${ts}-${rand}.${ext}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, {
          cacheControl: '3600',
          upsert: false,
          contentType: f.type || 'image/jpeg',
        })
        if (upErr) throw upErr
        const { error: insErr } = await supabase.from('capture_photos').insert({
          asset_id: assetId,
          storage_path: path,
          captured_at: new Date().toISOString(),
        } as never)
        if (insErr) throw insErr
        uploaded++
        setProgress({ done: uploaded, total: files.length })
      }
      setJustUploaded(uploaded)
      await load()
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setUploading(false)
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async (p: Photo) => {
    if (!confirm('Remove this photo?')) return
    await supabase.storage.from(BUCKET).remove([p.storage_path])
    await supabase.from('capture_photos').delete().eq('id', p.id)
    setLightbox(null)
    await load()
  }

  const publicUrl = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

  return (
    <section className="px-4 pb-24">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted px-1 mb-2 flex items-center gap-2">
        <span>Photos</span>
        <span className="font-normal normal-case tracking-normal">· {photos.length}</span>
        {justUploaded > 0 ? (
          <span className="ml-auto pill bg-ok/10 text-ok border border-ok/20 normal-case tracking-normal">
            ✓ {justUploaded} uploaded
          </span>
        ) : null}
      </h2>
      <div className="card p-4 space-y-3">
        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : photos.length === 0 && !uploading ? (
          <div className="text-sm text-muted">
            No photos yet. Snap nameplates, trip unit displays, or anything worth a second look.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <button
                key={p.id}
                onClick={() => setLightbox(p)}
                className="relative rounded-lg overflow-hidden border border-border bg-sky-soft aspect-square active:scale-[0.98] transition"
              >
                <img
                  src={publicUrl(p.storage_path)}
                  alt="capture"
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-1 left-1 text-[9px] text-white bg-ink/60 px-1.5 py-0.5 rounded mono">
                  {new Date(p.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </button>
            ))}
          </div>
        )}

        {uploading && progress ? (
          <div className="text-xs text-muted">
            Uploading {progress.done}/{progress.total}…
            <div className="h-1.5 rounded-full bg-border/60 overflow-hidden mt-1">
              <div
                className="h-full bg-sky transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex gap-2">
          <label className="btn btn-primary btn-md flex-1 justify-center cursor-pointer">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
              disabled={uploading}
            />
            {uploading ? 'Uploading…' : '📷  Take / choose photo'}
          </label>
        </div>

        {error ? (
          <div className="text-xs text-bad bg-bad/5 border border-bad/30 rounded-lg p-2">
            Upload failed: {error}
          </div>
        ) : null}
      </div>

      {/* Lightbox */}
      {lightbox ? (
        <div
          className="fixed inset-0 z-50 bg-ink/90 backdrop-blur flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="max-w-3xl w-full">
            <img
              src={publicUrl(lightbox.storage_path)}
              alt="capture"
              className="w-full max-h-[80vh] object-contain rounded-xl"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setLightbox(null)}
                className="btn btn-ghost btn-md flex-1"
              >
                Close
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void remove(lightbox)
                }}
                className="btn btn-danger btn-md"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
