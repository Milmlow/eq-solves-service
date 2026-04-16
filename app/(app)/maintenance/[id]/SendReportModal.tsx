'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Send, X } from 'lucide-react'
import { issueMaintenanceReportAction } from '@/app/(app)/reports/actions'

interface SendReportModalProps {
  checkId: string
  customerEmail?: string | null
  onClose: () => void
}

export function SendReportModal({ checkId, customerEmail, onClose }: SendReportModalProps) {
  const [emails, setEmails] = useState(customerEmail ?? '')
  const [ccEmails, setCcEmails] = useState('')
  const [message, setMessage] = useState('')
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ success: boolean; error?: string; revision?: number } | null>(null)

  function handleSend() {
    const toList = emails.split(/[,;\n]/).map(e => e.trim().toLowerCase()).filter(Boolean)
    if (toList.length === 0) return

    const ccList = ccEmails.split(/[,;\n]/).map(e => e.trim().toLowerCase()).filter(Boolean)

    startTransition(async () => {
      const res = await issueMaintenanceReportAction({
        maintenance_check_id: checkId,
        recipient_emails: toList,
        cc_emails: ccList.length > 0 ? ccList : undefined,
        message: message.trim() || undefined,
      })
      setResult(res)
    })
  }

  if (result?.success) {
    return (
      <div className="border border-green-200 rounded-lg bg-green-50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-green-600" />
          <h4 className="text-sm font-bold text-green-800">Report Sent</h4>
        </div>
        <p className="text-sm text-green-700">
          Revision {result.revision} has been generated and emailed to the recipients. They&apos;ll receive a download link valid for 30 days.
        </p>
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </div>
    )
  }

  return (
    <div className="border border-eq-sky/30 rounded-lg bg-eq-ice/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-eq-grey uppercase">Send Report to Customer</h4>
        <button onClick={onClose} className="text-eq-grey hover:text-eq-ink">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        <label className="block">
          <span className="text-xs font-medium text-eq-grey">Recipient emails *</span>
          <input
            type="text"
            value={emails}
            onChange={e => setEmails(e.target.value)}
            placeholder="customer@example.com, another@example.com"
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
          />
          <span className="text-xs text-gray-400">Separate multiple emails with commas</span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-eq-grey">CC (optional)</span>
          <input
            type="text"
            value={ccEmails}
            onChange={e => setCcEmails(e.target.value)}
            placeholder="manager@example.com"
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-eq-grey">Message (optional)</span>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            placeholder="Please find attached your maintenance report..."
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
          />
        </label>
      </div>

      {result?.error && (
        <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded">{result.error}</p>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSend} disabled={isPending || !emails.trim()}>
          <Send className="w-4 h-4 mr-1" />
          {isPending ? 'Sending...' : 'Send Report'}
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )
}
