import type { EmailSendDocument } from '../../types/mongo.js'
import { addDays, pacificDay, pacificStart } from '../../utils/pacific.js'

// Emails sent between two days (both included), by the Pacific day they went
// out, like the rest of Admin → Analytics: per day, per kind and in total.
// "Opened" and "clicked" count emails, not events; opens include Apple Mail's
// automatic ones.

// The Pacific-day helpers live in utils/pacific (Analytics uses them too).
export { addDays, pacificDay, pacificStart }

type Send = Pick<EmailSendDocument, 'kind' | 'sentAt' | 'opens' | 'firstOpenAt' | 'clicks'>

export type EmailCounts = { sent: number; opened: number; clicked: number; clicks: number }

const empty = (): EmailCounts => ({ sent: 0, opened: 0, clicked: 0, clicks: 0 })

function add(row: EmailCounts, send: Send) {
  row.sent += 1
  row.opened += send.opens > 0 || send.firstOpenAt ? 1 : 0
  row.clicked += send.clicks > 0 ? 1 : 0
  row.clicks += send.clicks
}

// Every day of the range shows, with zeros on quiet days. Kinds follow
// `order`, then any kind it doesn't list.
export function emailActivity(sends: Send[], from: string, to: string, order: readonly string[]) {
  const totals = empty()
  const days = new Map<string, EmailCounts>()
  const kinds = new Map<string, EmailCounts>()

  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.set(day, empty())
  }

  for (const send of sends) {
    const bucket = days.get(pacificDay(send.sentAt))

    if (!bucket) {
      continue
    }

    add(totals, send)
    add(bucket, send)
    const row = kinds.get(send.kind) ?? empty()
    add(row, send)
    kinds.set(send.kind, row)
  }

  const rank = (kind: string) => (order.includes(kind) ? order.indexOf(kind) : order.length)

  return {
    from,
    to,
    totals,
    daily: [...days].map(([day, counts]) => ({ day, ...counts })),
    kinds: [...kinds].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([kind, counts]) => ({ kind, ...counts })),
  }
}
