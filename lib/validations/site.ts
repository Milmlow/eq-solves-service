import { z } from 'zod'

export const CreateSiteSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1, 'Name is required').max(200),
  code: z.string().max(20).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(50).nullable().optional(),
  postcode: z.string().max(10).nullable().optional(),
  country: z.string().max(100).optional().default('Australia'),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  // Migration 0105 — site access fields. Each surfaces on the
  // Site Context Card on /maintenance/[id]. Generous max length on
  // the textareas because real-world site access notes can be a
  // paragraph (alarm code, after-hours doorbell, where to find
  // the spare key, etc.).
  gate_code: z.string().max(2000).nullable().optional(),
  parking_notes: z.string().max(2000).nullable().optional(),
  after_hours_phone: z.string().max(50).nullable().optional(),
  safety_notes: z.string().max(4000).nullable().optional(),
})

export const UpdateSiteSchema = CreateSiteSchema.partial().extend({
  is_active: z.boolean().optional(),
})

export type CreateSiteInput = z.infer<typeof CreateSiteSchema>
export type UpdateSiteInput = z.infer<typeof UpdateSiteSchema>
