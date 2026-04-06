import { z } from 'zod'

const CHECK_STATUSES = ['scheduled', 'in_progress', 'complete', 'overdue', 'cancelled'] as const
const CHECK_ITEM_RESULTS = ['pass', 'fail', 'na'] as const

export const CreateMaintenanceCheckSchema = z.object({
  job_plan_id: z.string().uuid('Valid job plan is required'),
  site_id: z.string().uuid('Valid site is required'),
  assigned_to: z.string().uuid().nullable().optional(),
  due_date: z.string().min(1, 'Due date is required'),
  notes: z.string().max(2000).nullable().optional(),
})

export const UpdateMaintenanceCheckSchema = z.object({
  assigned_to: z.string().uuid().nullable().optional(),
  status: z.enum(CHECK_STATUSES).optional(),
  due_date: z.string().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export const UpdateCheckItemResultSchema = z.object({
  result: z.enum(CHECK_ITEM_RESULTS).nullable(),
  notes: z.string().max(2000).nullable().optional(),
})

export type CreateMaintenanceCheckInput = z.infer<typeof CreateMaintenanceCheckSchema>
export type UpdateMaintenanceCheckInput = z.infer<typeof UpdateMaintenanceCheckSchema>
export type UpdateCheckItemResultInput = z.infer<typeof UpdateCheckItemResultSchema>
