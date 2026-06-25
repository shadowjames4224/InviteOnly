-- Migration: Taxonomic Refinement (Aliases & Node Merging)
-- Add aliases field to nodes, support path regeneration on parent_id updates, and add a merge routine.

-- 1. Add aliases text array column if it doesn't exist
ALTER TABLE public.nodes ADD COLUMN IF NOT EXISTS aliases TEXT[] DEFAULT '{}';

-- 2. Update trg_populate_node_path() to handle parent_id updates
CREATE OR REPLACE FUNCTION public.trg_populate_node_path()
RETURNS TRIGGER AS $$
DECLARE
    parent_path ltree;
BEGIN
    IF TG_OP = 'INSERT' OR OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
        IF NEW.parent_id IS NULL THEN
            NEW.path := text2ltree(NEW.id::text);
        ELSE
            SELECT path INTO parent_path FROM public.nodes WHERE id = NEW.parent_id;
            IF parent_path IS NULL THEN
                RAISE EXCEPTION 'Parent node with ID % does not exist.', NEW.parent_id;
            END IF;
            NEW.path := parent_path || text2ltree(NEW.id::text);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Re-bind trigger to fire on INSERT and UPDATE of parent_id
DROP TRIGGER IF EXISTS trigger_nodes_before_insert ON public.nodes;

CREATE TRIGGER trigger_nodes_before_insert
    BEFORE INSERT OR UPDATE OF parent_id ON public.nodes
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_populate_node_path();

-- 4. Create taxonomic merge procedure
CREATE OR REPLACE FUNCTION public.merge_taxonomy_nodes(
    p_source_id BIGINT,
    p_target_id BIGINT
)
RETURNS VOID AS $$
BEGIN
    IF p_source_id = p_target_id THEN
        RAISE EXCEPTION 'Cannot merge a node into itself.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.nodes WHERE id = p_source_id) THEN
        RAISE EXCEPTION 'Source node % does not exist.', p_source_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.nodes WHERE id = p_target_id) THEN
        RAISE EXCEPTION 'Target node % does not exist.', p_target_id;
    END IF;

    -- 1. Reparent children
    UPDATE public.nodes
    SET parent_id = p_target_id
    WHERE parent_id = p_source_id;

    -- 2. Move reviews
    UPDATE public.reviews
    SET node_id = p_target_id
    WHERE node_id = p_source_id;

    -- 3. Delete source node
    DELETE FROM public.nodes
    WHERE id = p_source_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
