// services.js - Shared database, state management, security helpers, and Edge API synchronization logic

// ----------------------------------------------------
// Global State Declarations (Bound to Window for page-wide global sharing)
// ----------------------------------------------------
window.db = undefined;
window.currentUser = null;

// ----------------------------------------------------
// 1. Security: HTML Sanitization (Prevents XSS Injection)
// ----------------------------------------------------
window.sanitizeHTML = function(str) {
  if (str === null || str === undefined) return '';
  const temp = document.createElement('div');
  temp.textContent = String(str);
  return temp.innerHTML;
};

// ----------------------------------------------------
// 2. UX: Reusable Toast & Custom Confirmation Dialogs
// ----------------------------------------------------
window.showToast = function(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast-notification ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'warning') icon = '⚠️';
  
  toast.innerHTML = `<span>${icon}</span><span style="flex-grow:1; text-align: left;">${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
};

// Override native alert to show custom non-blocking toasts
window.alert = function(message) {
  let type = 'info';
  const lowerMsg = String(message).toLowerCase();
  if (lowerMsg.includes('error') || lowerMsg.includes('failed') || lowerMsg.includes('invalid') || lowerMsg.includes('denied') || lowerMsg.includes('lost') || lowerMsg.includes('reached') || lowerMsg.includes('must be')) {
    type = 'error';
  } else if (lowerMsg.includes('success') || lowerMsg.includes('copied') || lowerMsg.includes('posted') || lowerMsg.includes('verified') || lowerMsg.includes('completed') || lowerMsg.includes('✓')) {
    type = 'success';
  } else if (lowerMsg.includes('warning') || lowerMsg.includes('attention') || lowerMsg.includes('caution')) {
    type = 'warning';
  }
  window.showToast(message, type);
};

// Custom non-blocking confirmation dialog using Promises
window.showConfirm = function(message, title = 'Confirm Action') {
  return new Promise((resolve) => {
    let overlay = document.getElementById('custom-confirm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'custom-confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-modal card" style="border: 1px solid var(--border-color); background: var(--color-bg-light); border-radius: var(--radius-md); padding: 1.5rem; max-width: 400px; width: 90%; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          <div class="confirm-modal-title" id="confirm-title" style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--color-text); display: flex; align-items: center; gap: 0.5rem;">Confirm Action</div>
          <div class="confirm-modal-body" id="confirm-body" style="font-size: 0.9rem; color: var(--color-text-dim); margin-bottom: 1.5rem; line-height: 1.4; text-align: left;">Are you sure?</div>
          <div class="confirm-modal-buttons" style="display: flex; justify-content: flex-end; gap: 0.75rem;">
            <button class="btn btn-secondary btn-sm" id="confirm-btn-cancel" style="padding: 0.5rem 1rem; cursor: pointer; background: transparent; border: 1px solid var(--border-color); color: var(--color-text); border-radius: var(--radius-sm);">Cancel</button>
            <button class="btn btn-primary btn-sm" id="confirm-btn-ok" style="padding: 0.5rem 1rem; cursor: pointer; color: white; border-radius: var(--radius-sm);">Confirm</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-body').innerText = message;
    
    const cancelBtn = document.getElementById('confirm-btn-cancel');
    const okBtn = document.getElementById('confirm-btn-ok');
    
    // Custom button style based on severity of operation
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('delete') || lowerTitle.includes('revoke') || lowerTitle.includes('suspend') || lowerTitle.includes('purge') || lowerTitle.includes('cancel')) {
      okBtn.style.background = '#f43f5e';
      okBtn.style.borderColor = '#f43f5e';
    } else {
      okBtn.style.background = 'var(--color-primary, #a855f7)';
      okBtn.style.borderColor = 'var(--color-primary, #a855f7)';
    }

    const cleanUp = () => {
      overlay.classList.remove('show');
      cancelBtn.onclick = null;
      okBtn.onclick = null;
    };

    cancelBtn.onclick = () => {
      cleanUp();
      resolve(false);
    };

    okBtn.onclick = () => {
      cleanUp();
      resolve(true);
    };

    overlay.offsetHeight; // Force reflow
    overlay.classList.add('show');
  });
};

// ----------------------------------------------------
// 3. Centralized Mock Seed Data & local storage logic
// ----------------------------------------------------
window.getSeedData = function() {
  return {
    version: 2,
    profiles: [
      { id: '00000000-0000-0000-0000-000000000001', username: 'root_moderator', reputation_score: 1.0000, base_reputation: 1.0000, invited_by: null, is_active: true, access_key: 'key_root_moderator', demographic_group: 'urban_affluent', role: 'key_root_moderator' }
    ],
    global_entities: [
      { id: 'ge_macchiato', name: 'Iced Caramel Macchiato', category: 'Commercial Service', reference_specification_uri: 'https://specs.inviteonly.network/macchiato' },
      { id: 'ge_gpu_x', name: 'Silicon Core GPU-X', category: 'Physical Consumer Good', reference_specification_uri: 'https://specs.inviteonly.network/gpu_x' },
      { id: 'ge_fishing_pool', name: 'Silver Creek Fly Fishing Pool', category: 'Recreational Outdoor Asset', reference_specification_uri: 'https://specs.inviteonly.network/fishing_pool' }
    ],
    parameterized_archetypes: [
      { id: 'pa_macchiato_layered', parent_entity_id: 'ge_macchiato', archetype_name: 'Layered Espresso-Milk (Traditional)' },
      { id: 'pa_macchiato_blended', parent_entity_id: 'ge_macchiato', archetype_name: 'Blended/Mixed (Modern)' },
      { id: 'pa_gpu_x_low_volt', parent_entity_id: 'ge_gpu_x', archetype_name: 'Sub-1.2V Stable Clock Profile' },
      { id: 'pa_fishing_pool_autumn', parent_entity_id: 'ge_fishing_pool', archetype_name: 'Seasonal Autumn Dry-Fly Runoff' }
    ],
    execution_instances: [
      { id: 'ei_macchiato_402', global_entity_id: 'ge_macchiato', current_archetype_id: 'pa_macchiato_layered', location_name: 'Franchise Location #402 (SF)', address: '402 Market St, San Francisco, CA', coordinates: '37.7915° N, 122.3995° W', gps_dop: 1.2 },
      { id: 'ei_macchiato_705', global_entity_id: 'ge_macchiato', current_archetype_id: 'pa_macchiato_layered', location_name: 'Franchise Location #705 (Portland)', address: '705 Morrison St, Portland, OR', coordinates: '45.5190° N, 122.6792° W', gps_dop: 1.4 },
      { id: 'ei_gpu_x_12', global_entity_id: 'ge_gpu_x', current_archetype_id: 'pa_gpu_x_low_volt', location_name: 'Foundry Fab #12 (Phoenix, AZ)', address: 'Foundry Fab 12, Phoenix, AZ', coordinates: '33.4484° N, 112.0740° W', gps_dop: 1.0 },
      { id: 'ei_fishing_pool_idaho', global_entity_id: 'ge_fishing_pool', current_archetype_id: 'pa_fishing_pool_autumn', location_name: 'Silver Creek Pool (Idaho BLM)', address: 'Silver Creek Road, Picabo, ID', coordinates: '43.3275° N, 114.1685° W', gps_dop: 1.1 }
    ],
    nodes: [
      { id: 1, parent_id: null, name: 'Earth', slug: 'earth', node_type: 'planet', path: '1' },
      { id: 2, parent_id: 1, name: 'United States', slug: 'united_states', node_type: 'country', path: '1.2' },
      { id: 3, parent_id: 2, name: 'Texas', slug: 'texas', node_type: 'state', path: '1.2.3' },
      { id: 4, parent_id: 3, name: 'Austin', slug: 'austin', node_type: 'city', path: '1.2.3.4' },
      { id: 5, parent_id: 4, name: 'Coffee Shops', slug: 'coffee_shops', node_type: 'category', path: '1.2.3.4.5' },
      { id: 6, parent_id: 5, name: 'Classic Coffee', slug: 'classic_coffee', node_type: 'merchant', path: '1.2.3.4.5.6', address: "221 North Loop Blvd, Austin, TX", coordinates: "30.3184° N, 97.7245° W" },
      { id: 7, parent_id: 5, name: 'Downtown Cafe', slug: 'downtown_cafe', node_type: 'merchant', path: '1.2.3.4.5.7', address: "3504 Menchaca Rd, Austin, TX", coordinates: "30.2335° N, 97.7858° W" },
      { id: 8, parent_id: 6, name: 'Cold Brew Coffee', slug: 'cold_brew_coffee', node_type: 'item', path: '1.2.3.4.5.6.8' },
      { id: 9, parent_id: 2, name: 'California', slug: 'california', node_type: 'state', path: '1.2.9' },
      { id: 10, parent_id: 9, name: 'San Francisco', slug: 'san_francisco', node_type: 'city', path: '1.2.9.10' },
      { id: 11, parent_id: 10, name: 'Franchise Location #402', slug: 'franchise_402', node_type: 'execution_instance', path: '1.2.9.10.11', execution_instance_id: 'ei_macchiato_402' },
      { id: 12, parent_id: 2, name: 'Oregon', slug: 'oregon', node_type: 'state', path: '1.2.12' },
      { id: 13, parent_id: 12, name: 'Portland', slug: 'portland', node_type: 'city', path: '1.2.12.13' },
      { id: 14, parent_id: 13, name: 'Franchise Location #705', slug: 'franchise_705', node_type: 'execution_instance', path: '1.2.12.13.14', execution_instance_id: 'ei_macchiato_705' },
      { id: 15, parent_id: 2, name: 'Arizona', slug: 'arizona', node_type: 'state', path: '1.2.15' },
      { id: 16, parent_id: 15, name: 'Phoenix', slug: 'phoenix', node_type: 'city', path: '1.2.15.16' },
      { id: 17, parent_id: 16, name: 'Foundry Fab #12', slug: 'foundry_12', node_type: 'execution_instance', path: '1.2.15.16.17', execution_instance_id: 'ei_gpu_x_12' },
      { id: 18, parent_id: 2, name: 'Idaho', slug: 'idaho', node_type: 'state', path: '1.2.18' },
      { id: 19, parent_id: 18, name: 'Picabo', slug: 'picabo', node_type: 'city', path: '1.2.18.19' },
      { id: 20, parent_id: 19, name: 'Silver Creek Fishing Pool', slug: 'silver_creek_pool', node_type: 'execution_instance', path: '1.2.18.19.20', execution_instance_id: 'ei_fishing_pool_idaho' }
    ],
    invite_tokens: [],
    reviews: [],
    vouches_disputes: [],
    tags: [
      { id: 1, name: 'third wave coffee shop' },
      { id: 2, name: 'fishing' },
      { id: 3, name: 'EDC gear' },
      { id: 4, name: 'outdoor recreation' }
    ],
    review_tags: []
  };
};

window.loadDb = function() {
  const storedDb = localStorage.getItem('review_network_db');
  let parsed = null;
  if (storedDb) {
    try {
      parsed = JSON.parse(storedDb);
    } catch (e) {
      parsed = null;
    }
  }

  // Force-wipe check if version is not 2
  if (parsed && parsed.version !== 2) {
    parsed = null;
    localStorage.removeItem('review_network_db');
  }

  const seed = window.getSeedData();
  if (!parsed || !parsed.profiles || !parsed.nodes || !parsed.invite_tokens || !parsed.reviews || !parsed.vouches_disputes) {
    window.db = seed;
    localStorage.setItem('review_network_db', JSON.stringify(window.db));
  } else {
    window.db = parsed;
    
    // Migrate tags and review_tags collections if missing
    if (!window.db.tags) window.db.tags = seed.tags || [];
    if (!window.db.review_tags) window.db.review_tags = seed.review_tags || [];
    if (!window.db.global_entities) window.db.global_entities = seed.global_entities || [];
    if (!window.db.parameterized_archetypes) window.db.parameterized_archetypes = seed.parameterized_archetypes || [];
    if (!window.db.execution_instances) window.db.execution_instances = seed.execution_instances || [];
    
    // Add missing access keys or system tokens (migration)
    let migrated = false;
    window.db.profiles.forEach(p => {
      if (!p.access_key) {
        p.access_key = 'key_' + p.username;
        migrated = true;
      }
      if (!p.demographic_group) {
        p.demographic_group = p.username.includes('bob') || p.username.includes('charlie') ? 'remote_rural' : 'urban_affluent';
        migrated = true;
      }
    });

    // Add pre-seeded system tokens if missing
    seed.invite_tokens.forEach(st => {
      if (!st.inviter_id && !window.db.invite_tokens.some(t => t.rawToken === st.rawToken)) {
        window.db.invite_tokens.push(st);
        migrated = true;
      }
    });

    if (migrated) {
      window.saveDbState();
    }
  }
  
  const wasChanged = window.checkSuspensions();
  if (wasChanged) {
    window.saveDbState();
  }

  // Update current user references
  const userKey = sessionStorage.getItem('current_user_key');
  if (userKey) {
    window.currentUser = window.db.profiles.find(p => p.access_key === userKey && p.is_active);
  } else {
    window.currentUser = null;
  }
};

window.saveDbState = function() {
  localStorage.setItem('review_network_db', JSON.stringify(window.db));
};

window.checkSuspensions = function() {
  if (!window.db || !window.db.profiles) return false;
  let changed = false;
  const now = Date.now();
  window.db.profiles.forEach(p => {
    if (!p.is_active && p.suspended_until && p.suspended_until <= now) {
      p.is_active = true;
      p.suspended_until = null;
      changed = true;
    }
  });
  return changed;
};

// ----------------------------------------------------
// 4. Shared API Synchronization and Cloudflare Edge wrappers
// ----------------------------------------------------
window.syncLiveReviews = async function() {
  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/reviews');
    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        // Merge reviews
        if (result.reviews) {
          result.reviews.forEach(liveR => {
            let localR = window.db.reviews.find(r => r.id === liveR.id);
            if (localR) {
              localR.node_id = liveR.node_id;
              localR.execution_instance_id = liveR.execution_instance_id;
              localR.author_id = liveR.author_id;
              localR.raw_content = liveR.raw_content;
              localR.is_verified_experience = liveR.is_verified_experience;
              localR.param_val_1 = liveR.param_val_1 ? parseFloat(liveR.param_val_1) : null;
              localR.param_val_2 = liveR.param_val_2 ? parseFloat(liveR.param_val_2) : null;
              localR.param_val_3 = liveR.param_val_3 ? parseFloat(liveR.param_val_3) : null;
              localR.verification_method = liveR.verification_method;
              localR.gps_dop = liveR.gps_dop ? parseFloat(liveR.gps_dop) : null;
              localR.created_at = typeof liveR.created_at === 'string' ? new Date(liveR.created_at).getTime() : liveR.created_at;
            } else {
              window.db.reviews.push({
                id: liveR.id,
                node_id: liveR.node_id,
                execution_instance_id: liveR.execution_instance_id,
                author_id: liveR.author_id,
                raw_content: liveR.raw_content,
                is_verified_experience: liveR.is_verified_experience,
                param_val_1: liveR.param_val_1 ? parseFloat(liveR.param_val_1) : null,
                param_val_2: liveR.param_val_2 ? parseFloat(liveR.param_val_2) : null,
                param_val_3: liveR.param_val_3 ? parseFloat(liveR.param_val_3) : null,
                verification_method: liveR.verification_method,
                gps_dop: liveR.gps_dop ? parseFloat(liveR.gps_dop) : null,
                created_at: typeof liveR.created_at === 'string' ? new Date(liveR.created_at).getTime() : liveR.created_at
              });
            }
          });
          const liveIds = result.reviews.map(r => r.id);
          window.db.reviews = window.db.reviews.filter(r => r.id.startsWith('local_') || liveIds.includes(r.id));
        }

        // Merge tags
        if (result.tags) {
          result.tags.forEach(liveT => {
            let localT = window.db.tags.find(t => t.id === liveT.id);
            if (localT) {
              localT.name = liveT.name;
            } else {
              window.db.tags.push({
                id: liveT.id,
                name: liveT.name
              });
            }
          });
          const liveTagIds = result.tags.map(t => t.id);
          window.db.tags = window.db.tags.filter(t => liveTagIds.includes(t.id));
        }

        // Merge review_tags
        if (result.review_tags) {
          window.db.review_tags = result.review_tags;
        }

        // Merge nodes
        if (result.nodes) {
          result.nodes.forEach(liveN => {
            let localN = window.db.nodes.find(n => n.id === liveN.id);
            if (localN) {
              localN.parent_id = liveN.parent_id;
              localN.name = liveN.name;
              localN.slug = liveN.slug;
              localN.node_type = liveN.node_type;
              localN.path = liveN.path;
              localN.address = liveN.address;
              localN.coordinates = liveN.coordinates;
            } else {
              window.db.nodes.push({
                id: liveN.id,
                parent_id: liveN.parent_id,
                name: liveN.name,
                slug: liveN.slug,
                node_type: liveN.node_type,
                path: liveN.path,
                address: liveN.address,
                coordinates: liveN.coordinates
              });
            }
          });
          const liveNodeIds = result.nodes.map(n => n.id);
          window.db.nodes = window.db.nodes.filter(n => liveNodeIds.includes(n.id));
        }

        // Merge vouches_disputes
        if (result.vouches_disputes) {
          window.db.vouches_disputes = result.vouches_disputes.map(v => ({
            id: v.id,
            review_id: v.review_id,
            user_id: v.user_id,
            type: v.type,
            allocated_weight: parseFloat(v.allocated_weight)
          }));
        }

        window.saveDbState();

        // Dispatch general event for UI updates
        window.dispatchEvent(new Event('dbSyncComplete'));
        if (typeof window.refreshActiveViews === 'function') {
          window.refreshActiveViews();
        }
      }
    }
  } catch (e) {
    console.error("Failed to sync live reviews:", e);
  }
};

window.syncLiveProfiles = async function() {
  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/profiles');
    if (response.ok) {
      const result = await response.json();
      if (result.success && result.profiles) {
        result.profiles.forEach(liveP => {
          let localP = window.db.profiles.find(p => p.id === liveP.id);
          if (localP) {
            localP.username = liveP.username;
            localP.reputation_score = parseFloat(liveP.reputation_score);
            localP.base_reputation = parseFloat(liveP.reputation_score);
            localP.invited_by = liveP.invited_by;
            localP.is_active = liveP.is_active;
            localP.role = liveP.role;
            localP.released_by = liveP.released_by;
            localP.originally_invited_by = liveP.originally_invited_by;
            if (liveP.demographic_group) {
              localP.demographic_group = liveP.demographic_group;
            }
          } else {
            window.db.profiles.push({
              id: liveP.id,
              username: liveP.username,
              reputation_score: parseFloat(liveP.reputation_score),
              base_reputation: parseFloat(liveP.reputation_score),
              invited_by: liveP.invited_by,
              is_active: liveP.is_active,
              access_key: 'key_' + liveP.username,
              role: liveP.role,
              released_by: liveP.released_by,
              originally_invited_by: liveP.originally_invited_by,
              demographic_group: liveP.demographic_group || 'urban_affluent'
            });
          }
        });
        
        // Prune profiles that are not active/present on edge to keep in sync
        const liveProfileIds = result.profiles.map(p => p.id);
        window.db.profiles = window.db.profiles.filter(p => liveProfileIds.includes(p.id));

        window.saveDbState();
        
        // Update currentUser reference
        const userKey = sessionStorage.getItem('current_user_key');
        if (userKey) {
          window.currentUser = window.db.profiles.find(p => p.access_key === userKey && p.is_active);
        }

        window.dispatchEvent(new Event('dbSyncComplete'));
        if (typeof window.refreshActiveViews === 'function') {
          window.refreshActiveViews();
        }
      }
    }
  } catch (e) {
    console.error("Failed to sync live profiles:", e);
  }
};

// ----------------------------------------------------
// 5. Consensus & Lineage Logic
// ----------------------------------------------------
window.getLineageAlpha = function() {
  const settingsStr = localStorage.getItem('review_network_settings');
  if (settingsStr) {
    try {
      const settings = JSON.parse(settingsStr);
      if (settings && typeof settings.lineageAlpha === 'number') {
        return settings.lineageAlpha;
      }
    } catch (e) {
      console.warn("Failed to parse settings:", e);
    }
  }
  return 0.25;
};

window.areInSameInviteLineage = function(userIdA, userIdB) {
  if (userIdA === userIdB) return true;
  
  let pathA = [];
  let curr = window.db.profiles.find(p => p.id === userIdA);
  while (curr) {
    pathA.push(curr.id);
    curr = window.db.profiles.find(p => p.id === curr.invited_by);
  }
  
  let pathB = [];
  curr = window.db.profiles.find(p => p.id === userIdB);
  while (curr) {
    pathB.push(curr.id);
    curr = window.db.profiles.find(p => p.id === curr.invited_by);
  }
  
  return pathA.includes(userIdB) || pathB.includes(userIdA);
};

window.checkLineageCollusion = function(authorId, voterId) {
  if (authorId === voterId) return false;
  
  const checkParent = (id, target, depth) => {
    if (depth > 5 || !id) return false;
    const profile = window.db.profiles.find(p => p.id === id);
    if (profile) {
      if (profile.id === target) return true;
      return checkParent(profile.invited_by, target, depth + 1);
    }
    return false;
  };

  return checkParent(authorId, voterId, 1) || checkParent(voterId, authorId, 1);
};

window.calculateReviewConsensus = function(reviewId) {
  const review = window.db.reviews.find(r => r.id === reviewId);
  if (!review) return { theta: 1.0, total: 0, vouches: 0, disputes: 0 };

  const votes = window.db.vouches_disputes.filter(v => v.review_id === reviewId);
  
  let vouches = 0;
  let disputes = 0;

  votes.forEach(vote => {
    const voter = window.db.profiles.find(p => p.id === vote.user_id);
    if (!voter || !voter.is_active) return;

    let weight = parseFloat(voter.reputation_score);

    if (window.checkLineageCollusion(review.author_id, vote.user_id)) {
      weight *= 0.5;
    }

    if (vote.type === 'vouch') {
      vouches += weight;
    } else {
      disputes += weight;
    }
  });

  const total = vouches + disputes;
  const theta = total > 0 ? vouches / total : 1.0;
  return { theta, total, vouches, disputes };
};

window.calculateConsensusTheta = function(reviewId) {
  let review = window.db.reviews.find(r => r.id === reviewId);
  if (!review) return { theta: 1.0, wv: 0, wd: 0 };

  let votes = window.db.vouches_disputes.filter(v => v.review_id === reviewId);
  
  let wv = 0;
  let wd = 0;

  votes.forEach(vote => {
    let voter = window.db.profiles.find(p => p.id === vote.user_id);
    if (!voter || !voter.is_active) return;

    let weight = voter.reputation_score;

    if (window.areInSameInviteLineage(vote.user_id, review.author_id) && vote.user_id !== review.author_id) {
      weight *= 0.5;
    }

    if (vote.type === 'vouch') {
      wv += weight;
    } else {
      wd += weight;
    }
  });

  let theta = 1.0;
  if (wv + wd > 0) {
    theta = wv / (wv + wd);
  }

  return { theta, wv, wd };
};

window.getReviewTags = function(reviewId) {
  const tagIds = window.db.review_tags.filter(rt => rt.review_id === reviewId).map(rt => rt.tag_id);
  return window.db.tags.filter(t => tagIds.includes(t.id));
};

// ----------------------------------------------------
// 6. Deprecation: Client-Side Reputation Decay Loop Warnings
// ----------------------------------------------------
window.runLineageReputationDecay = function() {
  console.warn("runLineageReputationDecay deprecated: calculations moved strictly to the backend.");
};

window.computeReputationDecay = function() {
  console.warn("computeReputationDecay deprecated: calculations moved strictly to the backend.");
};

window.getNodePathString = function(node) {
  if (!node) return '';
  let parts = [];
  let curr = node;
  while (curr) {
    parts.unshift(curr.name);
    curr = window.db.nodes.find(n => n.id === curr.parent_id);
  }
  return parts.join(' / ');
};
