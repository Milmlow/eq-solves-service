import { z } from 'zod'

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

// Base tenant columns shared by create and update. Keep this limited to actual
// `tenants` columns so UpdateTenantSchema can be spread straight into an update.
const TenantBaseSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
})

export const CreateTenantSchema = TenantBaseSchema.extend({
  // Optional provisioning-time identity seed. When a Service tenant is created
  // to mirror an existing EQ tenant canonical (shell_control.tenants), the
  // provisioner passes the canonical company name (via `name`) and branding here
  // so the workspace arrives already personalised. Values are supplied by the
  // caller — there is no cross-tenant read from Service, so no new always-on
  // data path is introduced. These fields are NOT tenant columns; the route
  // applies them to tenant_settings / setup_completed_at explicitly.
  primary_colour: z.string().regex(HEX_COLOUR, 'primary_colour must be a #RRGGBB hex').optional(),
  deep_colour: z.string().regex(HEX_COLOUR, 'deep_colour must be a #RRGGBB hex').optional(),
  logo_url: z.string().url().max(1000).optional(),

  // Skip the first-run onboarding wizard for this tenant. Set true for
  // canonical-provisioned tenants whose identity is already established;
  // leave false/absent for self-serve signups so they still get the wizard.
  skip_onboarding: z.boolean().optional(),
})

export const UpdateTenantSchema = TenantBaseSchema.partial().extend({
  is_active: z.boolean().optional(),
})

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>
export type UpdateTenantInput = z.infer<typeof UpdateTenantSchema>
