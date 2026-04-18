import type { ClassificationField } from '../types/db'

export interface FieldGroup {
  title: string
  fields: ClassificationField[]
}

/**
 * Heuristic grouping for the capture form. Moved from AssetPage so both
 * mobile + desktop JobScreen share identical grouping behaviour.
 */
export function groupFields(
  fields: ClassificationField[],
  classificationCode: string,
): FieldGroup[] {
  if (classificationCode === 'BREAKER') {
    const nameplateKeys = [
      'amp frame', 'asset uid', 'breaker constr', 'breaker mount', 'breaker type',
      'ka rating', 'operator type', 'sensor in', 'trip model', 'trip type',
      'voltage rating',
    ]
    const tripKeys = ['ground fault', 'inst', 'long time', 'short time']
    const validationKeys = ['verified against']

    const nameplate: ClassificationField[] = []
    const trip: ClassificationField[] = []
    const validation: ClassificationField[] = []
    const other: ClassificationField[] = []

    for (const f of fields) {
      const n = f.display_name.toLowerCase()
      if (validationKeys.some(k => n.includes(k))) validation.push(f)
      else if (tripKeys.some(k => n.includes(k))) trip.push(f)
      else if (nameplateKeys.some(k => n.includes(k))) nameplate.push(f)
      else other.push(f)
    }
    const groups: FieldGroup[] = []
    if (nameplate.length) groups.push({ title: 'Nameplate', fields: nameplate })
    if (trip.length) groups.push({ title: 'Trip settings', fields: trip })
    if (validation.length) groups.push({ title: 'Validation', fields: validation })
    if (other.length) groups.push({ title: 'Other', fields: other })
    return groups
  }

  const byGroup = new Map<string, ClassificationField[]>()
  for (const f of fields) {
    const key = f.group ?? 'Fields'
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(f)
  }
  return Array.from(byGroup.entries()).map(([title, fs]) => ({ title, fields: fs }))
}
