-- Add access_key_hash column to profiles table for secure authentication
ALTER TABLE public.profiles ADD COLUMN access_key_hash VARCHAR(255);

-- Update the RPC to insert the password hash into access_key_hash
CREATE OR REPLACE FUNCTION public.execute_secure_registration(
    p_token_hash VARCHAR(64),
    p_username VARCHAR(50),
    p_password_hash TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_inviter_id UUID;
    v_new_user_id UUID;
    v_profile_data JSONB;
BEGIN
    -- Check token validity and acquire a row-level lock
    SELECT inviter_id INTO v_inviter_id
    FROM public.invite_tokens
    WHERE token_hash = p_token_hash
      AND is_used = FALSE
      AND expires_at > now()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'message', 'Token invalid, already used, or expired.');
    END IF;

    -- Mark token as used to prevent double-redemption
    UPDATE public.invite_tokens
    SET is_used = TRUE
    WHERE token_hash = p_token_hash;

    -- Generate user profile linked to the inviter
    INSERT INTO public.profiles (username, invited_by, reputation_score, access_key_hash)
    VALUES (p_username, v_inviter_id, 1.0000, p_password_hash)
    RETURNING id, username, reputation_score INTO v_new_user_id, p_username, v_profile_data;

    RETURN jsonb_build_object(
        'success', TRUE,
        'profile', jsonb_build_object(
            'id', v_new_user_id,
            'username', p_username,
            'reputation_score', 1.0000
        )
    );
EXCEPTION WHEN OTHERS THEN
    -- Any exception triggers an automatic rollback of the transaction
    RETURN jsonb_build_object('success', FALSE, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

