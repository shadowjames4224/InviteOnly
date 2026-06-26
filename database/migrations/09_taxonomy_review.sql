-- Migration: Add taxonomy review flag to nodes and auto-flag trigger for cities
ALTER TABLE public.nodes 
ADD COLUMN IF NOT EXISTS needs_taxonomy_review BOOLEAN NOT NULL DEFAULT FALSE;

-- Change default to TRUE for future inserts so missing cities default to needing review
ALTER TABLE public.nodes 
ALTER COLUMN needs_taxonomy_review SET DEFAULT TRUE;

-- Trigger function to ensure only cities can have needs_taxonomy_review = TRUE
CREATE OR REPLACE FUNCTION public.trg_populate_city_taxonomy_review()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.node_type IS DISTINCT FROM 'city' THEN
        NEW.needs_taxonomy_review := FALSE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_nodes_taxonomy_review ON public.nodes;
CREATE TRIGGER trigger_nodes_taxonomy_review
    BEFORE INSERT ON public.nodes
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_populate_city_taxonomy_review();
