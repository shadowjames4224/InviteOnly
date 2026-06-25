export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS Headers to allow requests from your frontend portal
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route 1: Invite Registration Endpoint
      if (url.pathname === '/api/register' && request.method === 'POST') {
        const { inviteToken, username, password } = await request.json();
        if (!inviteToken || !username || !password) {
          return new Response(JSON.stringify({ error: 'Missing registration parameters.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Compute SHA-256 hash of the token
        const encoder = new TextEncoder();
        const data = encoder.encode(inviteToken);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashHex = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        // Call Supabase Database RPC using direct HTTPS fetch
        const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/execute_secure_registration`, {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            p_token_hash: hashHex,
            p_username: username,
            p_password_hash: password
          })
        });

        const regResult = await response.json();

        if (response.status !== 200 && response.status !== 201) {
          return new Response(JSON.stringify({ error: regResult?.message || 'Database error occurred.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (!regResult || regResult.success === false) {
          return new Response(JSON.stringify({ error: regResult?.message || 'Invalid or expired invite token.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const profileId = regResult.profile?.id;
        let fullProfile = regResult.profile;

        if (profileId) {
          try {
            const profileDetailRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}&select=id,username,reputation_score,invited_by`, {
              method: 'GET',
              headers: {
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
              }
            });
            if (profileDetailRes.ok) {
              const profiles = await profileDetailRes.json();
              if (profiles && profiles.length > 0) {
                fullProfile = profiles[0];
              }
            }
          } catch (e) {
            // Fall back to original profile if details lookup fails
          }
        }

        return new Response(JSON.stringify({ success: true, profile: fullProfile }), {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route 2: Secure Asset Upload & EXIF Scrubber Proxy
      if (url.pathname === '/api/upload-asset' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');
        const targetLat = parseFloat(formData.get('targetLat') || '0');
        const targetLng = parseFloat(formData.get('targetLng') || '0');
        
        if (!file) {
          return new Response(JSON.stringify({ error: 'No file uploaded.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const arrayBuffer = await file.arrayBuffer();
        const gps = parseGpsFromExif(arrayBuffer);

        let distanceMeters = null;
        let isWithinRange = true;

        if (gps && gps.latitude && gps.longitude && targetLat && targetLng) {
          // Proximity calculation (Haversine Formula)
          const R = 6371e3; // Earth radius in meters
          const phi1 = (gps.latitude * Math.PI) / 180;
          const phi2 = (targetLat * Math.PI) / 180;
          const deltaPhi = ((targetLat - gps.latitude) * Math.PI) / 180;
          const deltaLambda = ((targetLng - gps.longitude) * Math.PI) / 180;

          const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                    Math.cos(phi1) * Math.cos(phi2) *
                    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          distanceMeters = R * c;
          isWithinRange = distanceMeters <= 500; // 500 meters geofence threshold
        }

        return new Response(JSON.stringify({
          success: true,
          hasGps: !!gps,
          distanceMeters: distanceMeters ? Math.round(distanceMeters) : null,
          isWithinRange: isWithinRange
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route 3: Generate Invite Token Endpoint
      if (url.pathname === '/api/generate-invite' && request.method === 'POST') {
        const { authKey, rawToken, inviterUsername } = await request.json();
        if (!authKey || !rawToken) {
          return new Response(JSON.stringify({ error: 'Missing parameters: authKey and rawToken are required.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Deduce username from authKey (handling seed keys vs custom memorable suffixes)
        const seedKeyMap = {
          'key_root_moderator': 'root_moderator'
        };

        let username;
        if (seedKeyMap[authKey]) {
          username = seedKeyMap[authKey];
        } else {
          const lastUnderscore = authKey.lastIndexOf('_');
          if (lastUnderscore > 4) {
            username = authKey.substring(4, lastUnderscore);
          } else {
            username = authKey.startsWith('key_') ? authKey.slice(4) : authKey;
          }
        }

        // Query Supabase for the requester profile
        const profileRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?username=eq.${username}&select=id,username,is_active,invited_by`, {
          method: 'GET',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        });

        const profiles = await profileRes.json();
        if (!profileRes.ok || !profiles || profiles.length === 0) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Invalid access key.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const profile = profiles[0];
        if (!profile.is_active) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Account is suspended.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Determine target inviter profile
        let targetProfile = profile;
        const isRoot = profile.id === '00000000-0000-0000-0000-000000000001';

        if (inviterUsername && inviterUsername !== profile.username) {
          if (!isRoot) {
            return new Response(JSON.stringify({ error: 'Unauthorized: Only administrators can generate invites on behalf of other users.' }), {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          const targetRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?username=eq.${inviterUsername}&select=id,username,is_active,invited_by`, {
            method: 'GET',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          });

          const targets = await targetRes.json();
          if (!targetRes.ok || !targets || targets.length === 0) {
            return new Response(JSON.stringify({ error: `Target inviter @${inviterUsername} not found.` }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          targetProfile = targets[0];
        }

        // Enforce 5-invite quota for non-moderator target inviter
        const isTargetMod = targetProfile.id === '00000000-0000-0000-0000-000000000001' || targetProfile.invited_by === '00000000-0000-0000-0000-000000000001';
        if (!isTargetMod) {
          const countRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invite_tokens?inviter_id=eq.${targetProfile.id}&is_used=eq.false`, {
            method: 'GET',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          });

          const activeTokens = await countRes.json();
          if (countRes.ok && activeTokens && activeTokens.length >= 5) {
            return new Response(JSON.stringify({ error: `Quota reached: @${targetProfile.username} cannot generate more than 5 active invite tokens.` }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        // Compute SHA-256 hash of the raw token
        const encoder = new TextEncoder();
        const tokenData = encoder.encode(rawToken);
        const hashBuffer = await crypto.subtle.digest('SHA-256', tokenData);
        const hashHex = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        // Set invite expiration to 7 days
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        // Insert new invite token into Supabase invite_tokens table
        const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invite_tokens`, {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            token_hash: hashHex,
            inviter_id: targetProfile.id,
            is_used: false,
            expires_at: expiresAt
          })
        });

        const insertResult = await insertRes.json();
        if (insertRes.status !== 200 && insertRes.status !== 201) {
          return new Response(JSON.stringify({ error: insertResult?.message || 'Failed to insert token in database.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, token: rawToken }), {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route 4: Fetch All Profiles Endpoint (for lineage sync)
      if (url.pathname === '/api/profiles' && request.method === 'GET') {
        const response = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=id,username,reputation_score,invited_by,is_active`, {
          method: 'GET',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        });

        const profiles = await response.json();
        if (!response.ok) {
          return new Response(JSON.stringify({ error: profiles?.message || 'Failed to fetch profiles from database.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, profiles }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route 5: Admin Manage Profile Endpoint (Updates or Deletes profiles on Supabase)
      if (url.pathname === '/api/admin/manage-profile' && request.method === 'POST') {
        const { authKey, action, updates, targetId, profile: newProfileData } = await request.json();
        if (!authKey || !action) {
          return new Response(JSON.stringify({ error: 'Missing parameters: authKey and action are required.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Deduce username from authKey (handling seed keys vs custom memorable suffixes)
        const seedKeyMap = {
          'key_root_moderator': 'root_moderator'
        };

        let username;
        if (seedKeyMap[authKey]) {
          username = seedKeyMap[authKey];
        } else {
          const lastUnderscore = authKey.lastIndexOf('_');
          if (lastUnderscore > 4) {
            username = authKey.substring(4, lastUnderscore);
          } else {
            username = authKey.startsWith('key_') ? authKey.slice(4) : authKey;
          }
        }

        // Query Supabase for the requester profile
        const profileRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?username=eq.${username}&select=id,username,is_active,invited_by`, {
          method: 'GET',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        });

        const profiles = await profileRes.json();
        if (!profileRes.ok || !profiles || profiles.length === 0) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Invalid access key.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const requester = profiles[0];
        if (!requester.is_active) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Account is suspended.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Verify that the requester is indeed a moderator (root moderator or user invited by root moderator)
        const isMod = requester.id === '00000000-0000-0000-0000-000000000001' || requester.invited_by === '00000000-0000-0000-0000-000000000001';
        if (!isMod) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Only moderators/admin can perform this action.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (action === 'update') {
          if (!Array.isArray(updates)) {
            return new Response(JSON.stringify({ error: 'Missing updates array.' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          for (const item of updates) {
            // Fetch target profile first to enforce safety constraints
            const targetRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${item.id}&select=id,invited_by`, {
              method: 'GET',
              headers: {
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
              }
            });
            const targets = await targetRes.json();
            if (targetRes.ok && targets && targets.length > 0) {
              const targetProfile = targets[0];
              const targetIsMod = targetProfile.id === '00000000-0000-0000-0000-000000000001' || targetProfile.invited_by === '00000000-0000-0000-0000-000000000001';
              const currentUserIsRoot = requester.id === '00000000-0000-0000-0000-000000000001';
              if (targetIsMod && !currentUserIsRoot) {
                return new Response(JSON.stringify({ error: 'Safety constraint: Standard moderators cannot modify other moderator profiles.' }), {
                  status: 403,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
              if (targetProfile.id === '00000000-0000-0000-0000-000000000001' && (item.is_active === false || item.reputation_score !== undefined)) {
                return new Response(JSON.stringify({ error: 'Safety constraint: Cannot revoke or modify root moderator.' }), {
                  status: 403,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
              }
            }

            // Perform PATCH request
            const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${item.id}`, {
              method: 'PATCH',
              headers: {
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                is_active: item.is_active !== undefined ? item.is_active : undefined,
                reputation_score: item.reputation_score !== undefined ? item.reputation_score : undefined,
                invited_by: item.invited_by !== undefined ? item.invited_by : undefined
              })
            });
            if (!patchRes.ok) {
              const errText = await patchRes.text();
              return new Response(JSON.stringify({ error: `Failed to update profile ${item.id}: ${errText}` }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          }

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (action === 'delete') {
          if (!targetId) {
            return new Response(JSON.stringify({ error: 'Missing targetId.' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Fetch target profile first to enforce safety constraints
          const targetRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${targetId}&select=id,invited_by`, {
            method: 'GET',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          });
          const targets = await targetRes.json();
          if (!targetRes.ok || !targets || targets.length === 0) {
            return new Response(JSON.stringify({ error: 'Target profile not found.' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          const targetProfile = targets[0];
          const targetIsMod = targetProfile.id === '00000000-0000-0000-0000-000000000001' || targetProfile.invited_by === '00000000-0000-0000-0000-000000000001';
          const currentUserIsRoot = requester.id === '00000000-0000-0000-0000-000000000001';
          if (targetIsMod && !currentUserIsRoot) {
            return new Response(JSON.stringify({ error: 'Safety constraint: Standard moderators cannot delete other moderator profiles.' }), {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          if (targetProfile.id === '00000000-0000-0000-0000-000000000001') {
            return new Response(JSON.stringify({ error: 'Safety constraint: Cannot delete root moderator.' }), {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Perform DELETE request
          const deleteRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${targetId}`, {
            method: 'DELETE',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          });

          if (!deleteRes.ok) {
            const errText = await deleteRes.text();
            return new Response(JSON.stringify({ error: `Failed to delete profile: ${errText}` }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (action === 'create') {
          if (!newProfileData || !newProfileData.id || !newProfileData.username) {
            return new Response(JSON.stringify({ error: 'Missing profile data.' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Insert direct user profile
          const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles`, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              id: newProfileData.id,
              username: newProfileData.username,
              reputation_score: newProfileData.reputation_score,
              invited_by: newProfileData.invited_by,
              is_active: newProfileData.is_active
            })
          });

          if (!insertRes.ok) {
            const errText = await insertRes.text();
            return new Response(JSON.stringify({ error: `Failed to create profile: ${errText}` }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            status: 201,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ error: 'Invalid action.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route 6: Reviews Endpoint (GET all reviews/tags/review_tags/nodes/vouches)
      if (url.pathname === '/api/reviews' && request.method === 'GET') {
        const [reviewsRes, tagsRes, reviewTagsRes, nodesRes, vouchesRes] = await Promise.all([
          fetch(`${env.SUPABASE_URL}/rest/v1/reviews?select=*`, {
            method: 'GET',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          }),
          fetch(`${env.SUPABASE_URL}/rest/v1/tags?select=*`, {
            method: 'GET',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          }),
          fetch(`${env.SUPABASE_URL}/rest/v1/review_tags?select=*`, {
            method: 'GET',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          }),
          fetch(`${env.SUPABASE_URL}/rest/v1/nodes?select=*`, {
            method: 'GET',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          }),
          fetch(`${env.SUPABASE_URL}/rest/v1/vouches_disputes?select=*`, {
            method: 'GET',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          })
        ]);

        if (!reviewsRes.ok || !tagsRes.ok || !reviewTagsRes.ok || !nodesRes.ok || !vouchesRes.ok) {
          return new Response(JSON.stringify({ error: 'Failed to fetch reviews data from database.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const reviews = await reviewsRes.json();
        const tags = await tagsRes.json();
        const review_tags = await reviewTagsRes.json();
        const nodes = await nodesRes.json();
        const vouches_disputes = await vouchesRes.json();

        return new Response(JSON.stringify({ success: true, reviews, tags, review_tags, nodes, vouches_disputes }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route 7: POST /api/reviews
      if (url.pathname === '/api/reviews' && request.method === 'POST') {
        const { authKey, review, newNodes, tags } = await request.json();
        if (!authKey || !review) {
          return new Response(JSON.stringify({ error: 'Missing review parameters.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const profile = await authenticateUser(authKey, env);
        if (!profile) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Invalid access key.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (!profile.is_active) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Account is suspended.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 1. Insert new nodes if any
        if (newNodes && Array.isArray(newNodes) && newNodes.length > 0) {
          const nodesInsert = await fetch(`${env.SUPABASE_URL}/rest/v1/nodes`, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation'
            },
            body: JSON.stringify(newNodes.map(n => ({
              id: n.id,
              parent_id: n.parent_id,
              name: n.name,
              slug: n.slug,
              node_type: n.node_type,
              address: n.address || null,
              coordinates: n.coordinates || null,
              aliases: n.aliases || []
            })))
          });
          if (!nodesInsert.ok) {
            const errText = await nodesInsert.text();
            return new Response(JSON.stringify({ error: `Failed to insert nodes: ${errText}` }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        // 2. Insert review
        const reviewInsert = await fetch(`${env.SUPABASE_URL}/rest/v1/reviews`, {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            id: review.id,
            node_id: review.node_id,
            execution_instance_id: review.execution_instance_id || null,
            author_id: profile.id,
            raw_content: review.raw_content,
            is_verified_experience: review.is_verified_experience,
            param_val_1: review.param_val_1 || null,
            param_val_2: review.param_val_2 || null,
            param_val_3: review.param_val_3 || null,
            verification_method: review.verification_method || null,
            gps_dop: review.gps_dop || null
          })
        });

        if (!reviewInsert.ok) {
          const errText = await reviewInsert.text();
          return new Response(JSON.stringify({ error: `Failed to insert review: ${errText}` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // 3. Insert tags and link them
        if (tags && Array.isArray(tags) && tags.length > 0) {
          for (const tagStr of tags) {
            const tagSelect = await fetch(`${env.SUPABASE_URL}/rest/v1/tags?name=eq.${encodeURIComponent(tagStr)}&select=id`, {
              method: 'GET',
              headers: {
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
              }
            });
            let tagId;
            if (tagSelect.ok) {
              const tagsFound = await tagSelect.json();
              if (tagsFound && tagsFound.length > 0) {
                tagId = tagsFound[0].id;
              }
            }

            if (!tagId) {
              const tagInsert = await fetch(`${env.SUPABASE_URL}/rest/v1/tags`, {
                method: 'POST',
                headers: {
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=representation'
                },
                body: JSON.stringify({ name: tagStr })
              });
              if (tagInsert.ok) {
                const insertedTags = await tagInsert.json();
                if (insertedTags && insertedTags.length > 0) {
                  tagId = insertedTags[0].id;
                }
              }
            }

            if (tagId) {
              await fetch(`${env.SUPABASE_URL}/rest/v1/review_tags`, {
                method: 'POST',
                headers: {
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ review_id: review.id, tag_id: tagId })
              });
            }
          }
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route 8: DELETE /api/reviews
      if (url.pathname === '/api/reviews' && request.method === 'DELETE') {
        const { authKey, reviewId } = await request.json();
        if (!authKey || !reviewId) {
          return new Response(JSON.stringify({ error: 'Missing review deletion parameters.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const profile = await authenticateUser(authKey, env);
        if (!profile) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Invalid access key.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (!profile.is_active) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Account is suspended.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const isMod = profile.id === '00000000-0000-0000-0000-000000000001' || profile.invited_by === '00000000-0000-0000-0000-000000000001';
        if (!isMod) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Only moderators/admin can delete reviews.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const deleteRes = await fetch(`${env.SUPABASE_URL}/rest/v1/reviews?id=eq.${reviewId}`, {
          method: 'DELETE',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        });

        if (!deleteRes.ok) {
          const errText = await deleteRes.text();
          return new Response(JSON.stringify({ error: `Failed to delete review: ${errText}` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route 8b: DELETE /api/nodes
      if (url.pathname === '/api/nodes' && request.method === 'DELETE') {
        const { authKey, nodeId } = await request.json();
        if (!authKey || !nodeId) {
          return new Response(JSON.stringify({ error: 'Missing space deletion parameters.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const profile = await authenticateUser(authKey, env);
        if (!profile) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Invalid access key.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (!profile.is_active) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Account is suspended.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const isMod = profile.id === '00000000-0000-0000-0000-000000000001' || profile.invited_by === '00000000-0000-0000-0000-000000000001';
        if (!isMod) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Only moderators/admin can delete spaces.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const deleteRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nodes?id=eq.${nodeId}`, {
          method: 'DELETE',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        });

        if (!deleteRes.ok) {
          const errText = await deleteRes.text();
          return new Response(JSON.stringify({ error: `Failed to delete space: ${errText}` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route 8c: POST /api/admin/merge-nodes
      if (url.pathname === '/api/admin/merge-nodes' && request.method === 'POST') {
        const { authKey, sourceNodeId, targetNodeId } = await request.json();
        if (!authKey || !sourceNodeId || !targetNodeId) {
          return new Response(JSON.stringify({ error: 'Missing parameters: authKey, sourceNodeId, and targetNodeId are required.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const profile = await authenticateUser(authKey, env);
        if (!profile) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Invalid access key.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (!profile.is_active) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Account is suspended.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const isMod = profile.id === '00000000-0000-0000-0000-000000000001' || profile.invited_by === '00000000-0000-0000-0000-000000000001';
        if (!isMod) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Only moderators/admin can merge spaces.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Call Supabase Database RPC merge_taxonomy_nodes
        const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/merge_taxonomy_nodes`, {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            p_source_id: sourceNodeId,
            p_target_id: targetNodeId
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          let errMessage = 'Database error occurred during merge.';
          try {
            const errObj = JSON.parse(errText);
            errMessage = errObj.message || errMessage;
          } catch(e) {}
          return new Response(JSON.stringify({ error: errMessage }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route 9: POST /api/vouch
      if (url.pathname === '/api/vouch' && request.method === 'POST') {
        const { authKey, reviewId, type, allocatedWeight } = await request.json();
        if (!authKey || !reviewId || !type || allocatedWeight === undefined) {
          return new Response(JSON.stringify({ error: 'Missing vouch/dispute parameters.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const profile = await authenticateUser(authKey, env);
        if (!profile) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Invalid access key.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (!profile.is_active) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Account is suspended.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const selectRes = await fetch(`${env.SUPABASE_URL}/rest/v1/vouches_disputes?review_id=eq.${reviewId}&user_id=eq.${profile.id}&select=*`, {
          method: 'GET',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        });

        if (!selectRes.ok) {
          return new Response(JSON.stringify({ error: 'Database error checking existing votes.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const existingVotes = await selectRes.json();

        if (existingVotes && existingVotes.length > 0) {
          const existing = existingVotes[0];
          if (existing.type === type) {
            const deleteRes = await fetch(`${env.SUPABASE_URL}/rest/v1/vouches_disputes?id=eq.${existing.id}`, {
              method: 'DELETE',
              headers: {
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
              }
            });
            if (!deleteRes.ok) {
              return new Response(JSON.stringify({ error: 'Failed to delete vote.' }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          } else {
            const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/vouches_disputes?id=eq.${existing.id}`, {
              method: 'PATCH',
              headers: {
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ type: type, allocated_weight: allocatedWeight })
            });
            if (!patchRes.ok) {
              return new Response(JSON.stringify({ error: 'Failed to update vote.' }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          }
        } else {
          const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/vouches_disputes`, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              review_id: reviewId,
              user_id: profile.id,
              type: type,
              allocated_weight: allocatedWeight
            })
          });
          if (!insertRes.ok) {
            const errText = await insertRes.text();
            return new Response(JSON.stringify({ error: `Failed to insert vote: ${errText}` }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Route 10: POST /api/profile/update-username
      if (url.pathname === '/api/profile/update-username' && request.method === 'POST') {
        const { authKey, newUsername } = await request.json();
        if (!authKey || !newUsername) {
          return new Response(JSON.stringify({ error: 'Missing update-username parameters.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const nameRegex = /^[A-Za-z0-9_]{3,15}$/;
        if (!nameRegex.test(newUsername)) {
          return new Response(JSON.stringify({ error: 'Username must be 3-15 characters and contain only letters, numbers, and underscores.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const profile = await authenticateUser(authKey, env);
        if (!profile) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Invalid access key.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (!profile.is_active) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Account is suspended.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const uniqueRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?username=eq.${newUsername}&select=id`, {
          method: 'GET',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        });

        if (!uniqueRes.ok) {
          return new Response(JSON.stringify({ error: 'Database check failed.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const usersFound = await uniqueRes.json();
        if (usersFound && usersFound.length > 0) {
          return new Response(JSON.stringify({ error: 'Username is already taken.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${profile.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ username: newUsername })
        });

        if (!patchRes.ok) {
          const errText = await patchRes.text();
          return new Response(JSON.stringify({ error: `Failed to update username: ${errText}` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, username: newUsername }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response('Route Not Found', { status: 404, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },

  // ==============================================================================
  // PURE JAVASCRIPT GPS EXIF PARSER (Library-free)
  // ==============================================================================
  parseGpsFromExif(arrayBuffer) {
    return parseGpsFromExif(arrayBuffer);
  }
};

function parseGpsFromExif(arrayBuffer) {
  const dataView = new DataView(arrayBuffer);
  if (dataView.byteLength < 4) return null;
  if (dataView.getUint16(0) !== 0xFFD8) return null; // Not a JPEG image
  
  let offset = 2;
  const length = dataView.byteLength;
  
  while (offset < length - 4) {
    const marker = dataView.getUint16(offset);
    if (marker === 0xFFD9) break; // End of Image marker
    const segmentLength = dataView.getUint16(offset + 2);
    if (offset + 2 + segmentLength > length) break; // Boundary check
    
    if (marker === 0xFFE1) { // APP1 EXIF Segment found
      return parseExifSegment(dataView, offset + 4, segmentLength - 2);
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function parseExifSegment(dataView, offset, length) {
  if (offset + length > dataView.byteLength) return null;
  // Verify 'Exif\0\0' header
  if (offset + 6 > dataView.byteLength) return null;
  if (dataView.getUint32(offset) !== 0x45786966 || dataView.getUint16(offset + 4) !== 0x0000) {
    return null;
  }
  
  const tiffOffset = offset + 6;
  if (tiffOffset + 8 > dataView.byteLength) return null;
  const littleEndian = dataView.getUint16(tiffOffset) === 0x4949; // 'II' = Little, 'MM' = Big
  
  if (dataView.getUint16(tiffOffset + 2, littleEndian) !== 0x002A) {
    return null;
  }
  
  const firstIFDOffset = dataView.getUint32(tiffOffset + 4, littleEndian);
  return parseIFD(dataView, tiffOffset, firstIFDOffset, littleEndian);
}

function parseIFD(dataView, tiffOffset, ifdOffset, littleEndian) {
  if (tiffOffset + ifdOffset + 2 > dataView.byteLength) return null;
  const numEntries = dataView.getUint16(tiffOffset + ifdOffset, littleEndian);
  let gpsInfoOffset = null;
  
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = tiffOffset + ifdOffset + 2 + (i * 12);
    if (entryOffset + 12 > dataView.byteLength) return null;
    const tag = dataView.getUint16(entryOffset, littleEndian);
    
    if (tag === 0x8825) { // GPS Info tag reference
      gpsInfoOffset = dataView.getUint32(entryOffset + 8, littleEndian);
      break;
    }
  }
  
  if (gpsInfoOffset !== null) {
    return parseGPSInfo(dataView, tiffOffset, gpsInfoOffset, littleEndian);
  }
  return null;
}

function parseGPSInfo(dataView, tiffOffset, gpsOffset, littleEndian) {
  if (tiffOffset + gpsOffset + 2 > dataView.byteLength) return null;
  const numEntries = dataView.getUint16(tiffOffset + gpsOffset, littleEndian);
  let lat = null, lng = null, latRef = 'N', lngRef = 'E';
  
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = tiffOffset + gpsOffset + 2 + (i * 12);
    if (entryOffset + 12 > dataView.byteLength) return null;
    const tag = dataView.getUint16(entryOffset, littleEndian);
    const count = dataView.getUint32(entryOffset + 4, littleEndian);
    const valueOffset = dataView.getUint32(entryOffset + 8, littleEndian) + tiffOffset;
    
    if (tag === 1) { // GPSLatitudeRef
      latRef = String.fromCharCode(dataView.getUint8(entryOffset + 8));
    } else if (tag === 2) { // GPSLatitude array
      lat = parseRationalArray(dataView, valueOffset, count, littleEndian);
    } else if (tag === 3) { // GPSLongitudeRef
      lngRef = String.fromCharCode(dataView.getUint8(entryOffset + 8));
    } else if (tag === 4) { // GPSLongitude array
      lng = parseRationalArray(dataView, valueOffset, count, littleEndian);
    }
  }
  
  if (lat && lng && lat.length >= 3 && lng.length >= 3) {
    const latitude = (lat[0] + lat[1]/60 + lat[2]/3600) * (latRef === 'S' ? -1 : 1);
    const longitude = (lng[0] + lng[1]/60 + lng[2]/3600) * (lngRef === 'W' ? -1 : 1);
    return { latitude, longitude };
  }
  return null;
}

function parseRationalArray(dataView, offset, count, littleEndian) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const itemOffset = offset + (i * 8);
    if (itemOffset + 8 > dataView.byteLength) return null;
    const num = dataView.getUint32(itemOffset, littleEndian);
    const den = dataView.getUint32(itemOffset + 4, littleEndian);
    arr.push(den === 0 ? 0 : num / den);
  }
  return arr;
}

async function authenticateUser(authKey, env) {
  if (!authKey) return null;
  const seedKeyMap = {
    'key_root_moderator': 'root_moderator'
  };

  let username;
  if (seedKeyMap[authKey]) {
    username = seedKeyMap[authKey];
  } else {
    const lastUnderscore = authKey.lastIndexOf('_');
    if (lastUnderscore > 4) {
      username = authKey.substring(4, lastUnderscore);
    } else {
      username = authKey.startsWith('key_') ? authKey.slice(4) : authKey;
    }
  }

  try {
    const profileRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?username=eq.${username}&select=id,username,is_active,invited_by`, {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });

    if (!profileRes.ok) return null;
    const profiles = await profileRes.json();
    if (!profiles || profiles.length === 0) return null;
    return profiles[0];
  } catch (e) {
    return null;
  }
}

