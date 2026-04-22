-- ============================================================
-- Migration 0030: Drop Job Plan Reference Images
--
-- Reverses migration 0029 — removes the per-item reference
-- image feature. The generic image components (ImageUpload,
-- ImageThumbnail, ImageLightbox) are retained for future use.
-- ============================================================

-- 1. Drop columns from maintenance_check_items (snapshot side)
ALTER TABLE public.maintenance_check_items
  DROP COLUMN IF EXISTS reference_image_url,
  DROP COLUMN IF EXISTS reference_image_caption;

-- 2. Drop columns from job_plan_items (master side)
ALTER TABLE public.job_plan_items
  DROP COLUMN IF EXISTS reference_image_url,
  DROP COLUMN IF EXISTS reference_image_caption;

-- 3. Remove the storage bucket and its contents.
-- Objects must be deleted before the bucket can be dropped.
DELETE FROM storage.objects WHERE bucket_id = 'job-plan-references';
DELETE FROM storage.buckets WHERE id = 'job-plan-references';
