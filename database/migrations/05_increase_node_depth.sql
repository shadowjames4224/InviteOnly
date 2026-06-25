-- Migration: Increase Node Depth Limit
-- Drop the check constraint that limits node depth to 10, and increase it to 25 to allow rich hierarchies.

ALTER TABLE public.nodes 
DROP CONSTRAINT IF EXISTS chk_node_depth;

ALTER TABLE public.nodes 
ADD CONSTRAINT chk_node_depth CHECK (nlevel(path) <= 25);
