'use client'

import { useState, useTransition, useRef } from 'react'
import { addCheckCommentAction, deleteCheckCommentAction } from '../actions'

export type CheckComment = {
  id: string
  body: string
  created_by: string
  created_at: string
  author_name: string
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

type Props = {
  checkId: string
  comments: CheckComment[]
  currentUserId: string | null
  canComment: boolean
}

export function CheckCommentsPanel({ checkId, comments: initial, currentUserId, canComment }: Props) {
  const [comments, setComments] = useState(initial)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handlePost() {
    const trimmed = body.trim()
    if (!trimmed) return
    setError(null)
    startTransition(async () => {
      const result = await addCheckCommentAction(checkId, trimmed)
      if (!result.success) {
        setError(result.error ?? 'Failed to post comment.')
        return
      }
      // Optimistic: append with a placeholder id until the page revalidates
      setComments((prev) => [
        ...prev,
        {
          id: `pending-${Date.now()}`,
          body: trimmed,
          created_by: currentUserId ?? '',
          created_at: new Date().toISOString(),
          author_name: 'You',
        },
      ])
      setBody('')
      textareaRef.current?.focus()
    })
  }

  function handleDelete(commentId: string) {
    startTransition(async () => {
      const result = await deleteCheckCommentAction(commentId, checkId)
      if (!result.success) {
        setError(result.error ?? 'Failed to delete comment.')
        return
      }
      setComments((prev) => prev.filter((c) => c.id !== commentId))
    })
  }

  return (
    <section aria-label="Comments">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <span className="text-sm font-medium text-eq-ink">Comments</span>
          {comments.length > 0 && (
            <span className="text-xs text-eq-grey bg-gray-100 rounded-full px-2 py-0.5">
              {comments.length}
            </span>
          )}
        </div>

        {comments.length === 0 && !canComment ? (
          <p className="px-4 py-6 text-sm text-eq-grey text-center">No comments yet.</p>
        ) : null}

        {comments.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {comments.map((c) => (
              <li key={c.id} className="px-4 py-3 flex gap-3">
                <div
                  className="flex-shrink-0 w-8 h-8 rounded-full bg-eq-ice text-eq-deep flex items-center justify-center text-xs font-semibold"
                  aria-hidden
                >
                  {initials(c.author_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-eq-ink">{c.author_name}</span>
                    <span className="text-xs text-eq-grey">{relativeTime(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
                </div>
                {c.created_by === currentUserId && (
                  <button
                    onClick={() => handleDelete(c.id)}
                    disabled={isPending}
                    className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors text-xs mt-0.5 disabled:opacity-40"
                    aria-label="Delete comment"
                    title="Delete comment"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canComment && (
          <div className="px-4 py-3 border-t border-gray-100 space-y-2">
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePost()
              }}
              placeholder="Add a comment… (⌘↵ to post)"
              rows={2}
              maxLength={2000}
              disabled={isPending}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-eq-sky/50 focus:border-eq-sky disabled:opacity-50 placeholder:text-gray-400"
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-between items-center">
              <span className="text-xs text-eq-grey">{body.length}/2000</span>
              <button
                onClick={handlePost}
                disabled={isPending || !body.trim()}
                className="text-sm font-medium px-3 py-1.5 rounded-lg bg-eq-sky text-white hover:bg-eq-deep transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPending ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
