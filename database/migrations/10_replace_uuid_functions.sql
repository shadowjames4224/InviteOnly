-- Migration 10: Replace lingering uuid_generate_v4() defaults and stored procedure dependencies
-- with gen_random_uuid() to eliminate the uuid-ossp extension dependency.

-- Alter table defaults
ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.global_entities ALTER COLUMN entity_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.parameterized_archetypes ALTER COLUMN archetype_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.execution_instances ALTER COLUMN instance_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.invite_tokens ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.reviews ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.vouches_disputes ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Alter optional/other tables found in Supabase schema catalog
ALTER TABLE public.review_history ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.comments ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Recreate submit_review_transaction function to use gen_random_uuid()
CREATE OR REPLACE FUNCTION public.submit_review_transaction(
    p_review_id uuid,
    p_author_id uuid,
    p_node_id bigint,
    p_parent_node_id bigint,
    p_new_nodes jsonb,
    p_raw_content text,
    p_is_verified boolean,
    p_verification_method character varying,
    p_param_1 numeric,
    p_param_2 numeric,
    p_param_3 numeric,
    p_gps_dop numeric,
    p_tags text[]
)
RETURNS jsonb AS $$
DECLARE
    v_final_node_id BIGINT := p_node_id;
    v_tag_name TEXT;
    v_tag_id INT;
BEGIN
    -- 1. Handle dynamic node creation
    IF p_new_nodes IS NOT NULL AND jsonb_array_length(p_new_nodes) > 0 THEN
        v_final_node_id := public.get_or_create_nested_nodes(p_parent_node_id, p_new_nodes);
    END IF;

    IF v_final_node_id IS NULL THEN
        RAISE EXCEPTION 'Target node ID cannot be null.';
    END IF;

    -- 1b. Verify target node exists in the database
    IF NOT EXISTS (SELECT 1 FROM public.nodes WHERE id = v_final_node_id) THEN
        RAISE EXCEPTION 'Invalid Location: The selected node ID % does not exist in the database.', v_final_node_id;
    END IF;

    -- 2. Insert Review
    INSERT INTO public.reviews (
        id, node_id, author_id, raw_content, is_verified_experience,
        verification_method, param_val_1, param_val_2, param_val_3, gps_dop
    ) VALUES (
        COALESCE(p_review_id, gen_random_uuid()), v_final_node_id, p_author_id, p_raw_content, p_is_verified,
        p_verification_method, p_param_1, p_param_2, p_param_3, p_gps_dop
    ) RETURNING id INTO p_review_id;

    -- 3. Process Tags safely
    IF p_tags IS NOT NULL AND array_length(p_tags, 1) > 0 THEN
        FOREACH v_tag_name IN ARRAY p_tags LOOP
            -- Insert tag if it doesn't exist
            INSERT INTO public.tags (name)
            VALUES (v_tag_name)
            ON CONFLICT (name) DO NOTHING;

            -- Get tag ID
            SELECT id INTO v_tag_id FROM public.tags WHERE name = v_tag_name;

            -- Link to review
            INSERT INTO public.review_tags (review_id, tag_id)
            VALUES (p_review_id, v_tag_id)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;

    RETURN jsonb_build_object('success', TRUE, 'review_id', p_review_id, 'node_id', v_final_node_id);
EXCEPTION WHEN OTHERS THEN
    -- Rollback everything and return the error
    RETURN jsonb_build_object('success', FALSE, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
