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
})

export const UpdateSiteSchema = CreateSiteSchema.partial().extend({
  is_active: z.boolean().optional(),
})

export type CreateSiteInput = z.infer<typeof CreateSiteSchema>
export type UpdateSiteInput = z.infer<typeof UpdateSiteSchema>
