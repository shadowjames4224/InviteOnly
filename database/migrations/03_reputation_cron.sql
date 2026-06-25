-- Migration 03: Reputation Decay CRON Job
-- Moves the lineage reputation decay logic from the client to the server

CREATE OR REPLACE FUNCTION public.calculate_consensus_theta(p_review_id UUID)
RETURNS NUMERIC AS $$
DECLARE
    v_vouches NUMERIC(12, 4) := 0;
    v_disputes NUMERIC(12, 4) := 0;
BEGIN
    SELECT COALESCE(SUM(allocated_weight), 0) INTO v_vouches
    FROM public.vouches_disputes
    WHERE review_id = p_review_id AND type = 'vouch';

    SELECT COALESCE(SUM(allocated_weight), 0) INTO v_disputes
    FROM public.vouches_disputes
    WHERE review_id = p_review_id AND type = 'dispute';

    IF (v_vouches + v_disputes) = 0 THEN
        RETURN 1.0; -- Default innocent
    END IF;

    RETURN v_vouches / (v_vouches + v_disputes);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.cron_compute_reputation_decay()
RETURNS void AS $$
DECLARE
    v_lineage_alpha NUMERIC := 0.25; -- Default alpha
    v_changed BOOLEAN := TRUE;
    v_iterations INTEGER := 0;
    v_profile RECORD;
    v_children RECORD;
    v_product NUMERIC;
    v_child_reviews RECORD;
    v_total_theta NUMERIC;
    v_review_count INTEGER;
    v_child_avg_theta NUMERIC;
    v_term NUMERIC;
    v_new_rep NUMERIC(12, 4);
    
    -- We need a temporary table or array to hold "base" reputation 
    -- since the frontend previously relied on an in-memory base_reputation.
    -- To replicate exactly: we reset everyone to 1.0000 first (if active), 
    -- then apply the product.
BEGIN
    -- 1. Reset all active profiles to base reputation 1.0000
    UPDATE public.profiles
    SET reputation_score = 1.0000
    WHERE is_active = TRUE;

    UPDATE public.profiles
    SET reputation_score = 0.0000
    WHERE is_active = FALSE;

    -- 2. Iteratively calculate decay
    WHILE v_changed AND v_iterations < 10 LOOP
        v_changed := FALSE;
        v_iterations := v_iterations + 1;

        FOR v_profile IN SELECT * FROM public.profiles WHERE is_active = TRUE AND reputation_score > 0 LOOP
            v_product := 1.0;
            
            FOR v_children IN SELECT id FROM public.profiles WHERE invited_by = v_profile.id LOOP
                
                SELECT COUNT(*), COALESCE(SUM(public.calculate_consensus_theta(id)), 0)
                INTO v_review_count, v_total_theta
                FROM public.reviews
                WHERE author_id = v_children.id;

                IF v_review_count > 0 THEN
                    v_child_avg_theta := v_total_theta / v_review_count;
                    v_term := 1.0 - (v_lineage_alpha * (1.0 - v_child_avg_theta));
                    
                    -- Clamp between 0 and 1
                    IF v_term > 1.0 THEN v_term := 1.0; END IF;
                    IF v_term < 0.0 THEN v_term := 0.0; END IF;
                    
                    v_product := v_product * v_term;
                END IF;

            END LOOP;

            v_new_rep := ROUND((1.0000 * v_product)::numeric, 4);
            
            IF ABS(v_profile.reputation_score - v_new_rep) > 0.0001 THEN
                UPDATE public.profiles
                SET reputation_score = v_new_rep
                WHERE id = v_profile.id;
                
                v_changed := TRUE;
            END IF;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Ensure pg_cron extension exists
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the job to run every 5 minutes
SELECT cron.schedule('reputation-decay-job', '*/5 * * * *', 'SELECT public.cron_compute_reputation_decay();');
