-- Migration 02: Zero-Trust Security RPCs
-- Secure the vouch/dispute endpoint by calculating the allocated weight server-side

CREATE OR REPLACE FUNCTION public.submit_secure_vouch(
    p_review_id UUID,
    p_user_id UUID,
    p_type VARCHAR(10)
)
RETURNS JSONB AS $$
DECLARE
    v_author_id UUID;
    v_voter_reputation NUMERIC(12, 4);
    v_final_weight NUMERIC(12, 4);
    v_is_collusion BOOLEAN := FALSE;
    v_existing_id UUID;
BEGIN
    -- 1. Lock the voter's profile and retrieve reputation
    SELECT reputation_score INTO v_voter_reputation
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_voter_reputation IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'message', 'Voter profile not found.');
    END IF;

    -- 2. Retrieve the author of the review
    SELECT author_id INTO v_author_id
    FROM public.reviews
    WHERE id = p_review_id;

    IF v_author_id IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'message', 'Review not found.');
    END IF;

    -- 3. Check for Lineage Collusion (up to 5 generations)
    IF v_author_id = p_user_id THEN
        RETURN jsonb_build_object('success', FALSE, 'message', 'Cannot vote on your own review.');
    END IF;

    WITH RECURSIVE lineage_up AS (
        -- Base case: start at author
        SELECT id, invited_by, 1 as depth
        FROM public.profiles
        WHERE id = v_author_id
        
        UNION
        
        -- Recursive step: go up the invite chain
        SELECT p.id, p.invited_by, lu.depth + 1
        FROM public.profiles p
        INNER JOIN lineage_up lu ON p.id = lu.invited_by
        WHERE lu.depth < 5
    ),
    lineage_down AS (
        -- Base case: start at voter
        SELECT id, invited_by, 1 as depth
        FROM public.profiles
        WHERE id = p_user_id
        
        UNION
        
        -- Recursive step: go up the invite chain from voter to see if author invited them
        SELECT p.id, p.invited_by, ld.depth + 1
        FROM public.profiles p
        INNER JOIN lineage_down ld ON p.id = ld.invited_by
        WHERE ld.depth < 5
    )
    SELECT EXISTS (
        SELECT 1 FROM lineage_up WHERE id = p_user_id
        UNION
        SELECT 1 FROM lineage_down WHERE id = v_author_id
    ) INTO v_is_collusion;

    -- 4. Calculate Final Weight
    IF v_is_collusion THEN
        v_final_weight := v_voter_reputation * 0.5;
    ELSE
        v_final_weight := v_voter_reputation;
    END IF;

    -- 5. Upsert the Vote
    SELECT id INTO v_existing_id
    FROM public.vouches_disputes
    WHERE review_id = p_review_id AND user_id = p_user_id;

    IF v_existing_id IS NOT NULL THEN
        UPDATE public.vouches_disputes
        SET type = p_type,
            allocated_weight = v_final_weight
        WHERE id = v_existing_id;
    ELSE
        INSERT INTO public.vouches_disputes (review_id, user_id, type, allocated_weight)
        VALUES (p_review_id, p_user_id, p_type, v_final_weight);
    END IF;

    RETURN jsonb_build_object('success', TRUE, 'weight', v_final_weight, 'is_collusion', v_is_collusion);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
