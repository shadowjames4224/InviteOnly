-- Migration: Add Role column to profiles and seed initial roles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('key_root_moderator', 'moderator', 'user'));

-- Initialize key_root_moderator role for root_moderator
UPDATE public.profiles SET role = 'key_root_moderator' WHERE id = '00000000-0000-0000-0000-000000000001';

-- Initialize moderator role for users invited by root moderator who are active and not released
UPDATE public.profiles SET role = 'moderator' WHERE invited_by = '00000000-0000-0000-0000-000000000001' AND released_by IS NULL;
