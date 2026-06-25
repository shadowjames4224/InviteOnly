-- Migration: Moderator Standalone Release Feature
-- Add released_by and originally_invited_by columns to profiles.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS originally_invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_released_by ON public.profiles(released_by);
CREATE INDEX IF NOT EXISTS idx_profiles_originally_invited_by ON public.profiles(originally_invited_by);
