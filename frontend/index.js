// index.js - Production Portal Logic
// Handles tab navigation, forum feed rendering, tag filtering, directory explorer, and user settings

let db;
let currentUser = null;
let activeTagFilter = null;
let currentDirectoryPath = []; // Array of node objects representing breadcrumb trail
let selectedUserId = null;
let uploadedFiles = [];

// Levenshtein Distance for fuzzy matching spelling variations
function getEditDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// Seed Data Fallback (client-side mock DB)
function getSeedData() {
  return {
    version: 2,
    profiles: [
      { id: '00000000-0000-0000-0000-000000000001', username: 'root_moderator', reputation_score: 1.0000, base_reputation: 1.0000, invited_by: null, is_active: true, access_key: 'key_root_moderator', role: 'key_root_moderator' }
    ],
    nodes: [
      { id: 1, parent_id: null, name: 'Earth', slug: 'earth', node_type: 'planet', path: '1' },
      { id: 2, parent_id: 1, name: 'United States', slug: 'united_states', node_type: 'country', path: '1.2' },
      { id: 3, parent_id: 2, name: 'Texas', slug: 'texas', node_type: 'state', path: '1.2.3' },
      { id: 4, parent_id: 3, name: 'Austin', slug: 'austin', node_type: 'city', path: '1.2.3.4' },
      { id: 5, parent_id: 4, name: 'Coffee Shops', slug: 'coffee_shops', node_type: 'category', path: '1.2.3.4.5' },
      { id: 6, parent_id: 5, name: 'Classic Coffee', slug: 'classic_coffee', node_type: 'merchant', path: '1.2.3.4.5.6', address: "221 North Loop Blvd, Austin, TX", coordinates: "30.3184° N, 97.7245° W" },
      { id: 7, parent_id: 5, name: 'Downtown Cafe', slug: 'downtown_cafe', node_type: 'merchant', path: '1.2.3.4.5.7', address: "3504 Menchaca Rd, Austin, TX", coordinates: "30.2335° N, 97.7858° W" },
      { id: 8, parent_id: 6, name: 'Cold Brew Coffee', slug: 'cold_brew_coffee', node_type: 'item', path: '1.2.3.4.5.6.8' }
    ],
    global_entities: [
      { id: 'ge_macchiato', name: 'Iced Caramel Macchiato', category: 'Coffee' },
      { id: 'ge_gpu_x', name: 'Silicon Core GPU-X', category: 'Hardware' },
      { id: 'ge_fishing_pool', name: 'Silver Creek Fishing Pool', category: 'Outdoor Recreation' }
    ],
    execution_instances: [
      { id: 'ei_macchiato_402', global_entity_id: 'ge_macchiato', current_archetype_id: 'arch_iced_macchiato', location_name: 'Classic Coffee - Franchise #402', address: '221 North Loop Blvd, Austin, TX', coordinates: '30.3184, -97.7245', gps_dop: 1.0 },
      { id: 'ei_gpu_fab12', global_entity_id: 'ge_gpu_x', current_archetype_id: 'arch_gpu_7nm', location_name: 'Foundry Fab #12', address: 'Phoenix, AZ', coordinates: '33.4484, -112.0740', gps_dop: 1.0 },
      { id: 'ei_silver_creek', global_entity_id: 'ge_fishing_pool', current_archetype_id: 'arch_stream_winter', location_name: 'Picabo Stream Pool', address: 'Picabo, ID', coordinates: '43.3275, -114.1685', gps_dop: 1.0 }
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
}

// ----------------------------------------------------
// 1. Initial State Database Load
// ----------------------------------------------------
function loadDb() {
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

  const seed = getSeedData();
  if (!parsed || !parsed.profiles || !parsed.nodes || !parsed.invite_tokens || !parsed.reviews || !parsed.vouches_disputes) {
    db = seed;
    localStorage.setItem('review_network_db', JSON.stringify(db));
  } else {
    db = parsed;
    
    // Ensure tags and review_tags collections exist in loaded DB state
    if (!db.tags) db.tags = seed.tags;
    if (!db.review_tags) db.review_tags = seed.review_tags;
    
    // Auto-migrate keys
    let migrated = false;
    db.profiles.forEach(p => {
      if (!p.access_key) {
        p.access_key = 'key_' + p.username;
        migrated = true;
      }
    });
    if (migrated) saveDbState();
  }
  
  // Set defaults for custom categories if needed
  if (!db.global_entities) {
    db.global_entities = seed.global_entities;
    db.execution_instances = seed.execution_instances;
    saveDbState();
  }

  const wasChanged = checkSuspensions();
  if (wasChanged) {
    // Recalculate reputations without calling loadDb() to avoid recursion
    db.profiles.forEach(p => {
      if (p.is_active) {
        p.reputation_score = p.base_reputation;
      }
    });

    const penaltyAlpha = getLineageAlpha();

    db.profiles.forEach(targetProfile => {
      if (!targetProfile.is_active) return;

      let totalDiscount = 0.0;

      const findDeconstructionWeight = (inviterId, generation) => {
        const invitees = db.profiles.filter(p => p.invited_by === inviterId);
        invitees.forEach(invitee => {
          const inviteeReviews = db.reviews.filter(r => r.author_id === invitee.id);
          inviteeReviews.forEach(r => {
            const consensus = calculateReviewConsensus(r.id);
            if (consensus.theta < 0.40) {
              const decay = (1.0 - consensus.theta) / (generation * penaltyAlpha);
              totalDiscount += decay;
            }
          });
          findDeconstructionWeight(invitee.id, generation + 1);
        });
      };

      findDeconstructionWeight(targetProfile.id, 1);
      targetProfile.reputation_score = Math.max(0.0000, targetProfile.base_reputation - totalDiscount);
    });

    saveDbState();
  }
}

function saveDbState() {
  localStorage.setItem('review_network_db', JSON.stringify(db));
}

function loadFollows() {
  const stored = localStorage.getItem('review_network_follows');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      return [];
    }
  }
  return [];
}

function saveFollows(follows) {
  localStorage.setItem('review_network_follows', JSON.stringify(follows));
}

window.toggleFollowUser = function(userId, event) {
  if (event) event.stopPropagation();
  let follows = loadFollows();
  const idx = follows.indexOf(userId);
  if (idx > -1) {
    follows.splice(idx, 1);
  } else {
    follows.push(userId);
  }
  saveFollows(follows);
  
  // Re-render active views
  const activeTab = document.querySelector('.nav-tab-btn.active')?.getAttribute('data-tab');
  if (activeTab === 'feed-view') {
    renderFeedReviews();
  } else if (activeTab === 'following-view') {
    renderFollowingFeed();
  }
};

async function syncLiveReviews() {
  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/reviews');
    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        // Merge reviews
        if (result.reviews) {
          result.reviews.forEach(liveR => {
            let localR = db.reviews.find(r => r.id === liveR.id);
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
              db.reviews.push({
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
          db.reviews = db.reviews.filter(r => r.id.startsWith('local_') || liveIds.includes(r.id));
        }

        // Merge tags
        if (result.tags) {
          result.tags.forEach(liveT => {
            let localT = db.tags.find(t => t.id === liveT.id);
            if (localT) {
              localT.name = liveT.name;
            } else {
              db.tags.push({
                id: liveT.id,
                name: liveT.name
              });
            }
          });
        }

        // Merge review_tags
        if (result.review_tags) {
          db.review_tags = result.review_tags;
        }

        // Merge nodes
        if (result.nodes) {
          result.nodes.forEach(liveN => {
            let localN = db.nodes.find(n => n.id === liveN.id);
            if (localN) {
              localN.parent_id = liveN.parent_id;
              localN.name = liveN.name;
              localN.slug = liveN.slug;
              localN.node_type = liveN.node_type;
              localN.path = liveN.path;
              localN.address = liveN.address;
              localN.coordinates = liveN.coordinates;
            } else {
              db.nodes.push({
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
          db.nodes = db.nodes.filter(n => liveNodeIds.includes(n.id));
        }

        // Merge vouches_disputes
        if (result.vouches_disputes) {
          db.vouches_disputes = result.vouches_disputes.map(v => ({
            id: v.id,
            review_id: v.review_id,
            user_id: v.user_id,
            type: v.type,
            allocated_weight: parseFloat(v.allocated_weight)
          }));
        }

        saveDbState();

        // Refresh active views
        const activeTab = document.querySelector('.nav-tab-btn.active')?.getAttribute('data-tab');
        if (activeTab === 'feed-view') {
          renderFeedReviews();
        } else if (activeTab === 'following-view') {
          renderFollowingFeed();
        } else if (activeTab === 'browse-view') {
          renderDirectoryExplorer();
        }
      }
    }
  } catch (e) {
    console.error("Failed to sync live reviews:", e);
  }
}


async function syncLiveProfiles() {
  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/profiles');
    if (response.ok) {
      const result = await response.json();
      if (result.success && result.profiles) {
        result.profiles.forEach(liveP => {
          let localP = db.profiles.find(p => p.id === liveP.id);
          if (localP) {
            localP.username = liveP.username;
            localP.reputation_score = parseFloat(liveP.reputation_score);
            localP.invited_by = liveP.invited_by;
            localP.is_active = liveP.is_active;
            localP.role = liveP.role;
            localP.released_by = liveP.released_by;
            localP.originally_invited_by = liveP.originally_invited_by;
          } else {
            db.profiles.push({
              id: liveP.id,
              username: liveP.username,
              reputation_score: parseFloat(liveP.reputation_score),
              base_reputation: parseFloat(liveP.reputation_score),
              invited_by: liveP.invited_by,
              is_active: liveP.is_active,
              access_key: 'key_' + liveP.username,
              role: liveP.role,
              released_by: liveP.released_by,
              originally_invited_by: liveP.originally_invited_by
            });
          }
        });
        saveDbState();
      }
    }
  } catch (e) {
    console.error("Failed to sync live profiles:", e);
  }
}

function checkSuspensions() {
  if (!db || !db.profiles) return false;
  let changed = false;
  const now = Date.now();
  db.profiles.forEach(p => {
    if (!p.is_active && p.suspended_until && p.suspended_until <= now) {
      p.is_active = true;
      p.suspended_until = null;
      changed = true;
    }
  });
  return changed;
}

// ----------------------------------------------------
// 2. Identity and Authentication State
// ----------------------------------------------------
function syncCurrentUser() {
  loadDb();
  const userKey = sessionStorage.getItem('current_user_key');
  const userDot = document.querySelector('.user-status-dot');
  const userLabel = document.querySelector('.username-display');
  const guestGate = document.getElementById('submit-guest-gate');
  const submitForm = document.getElementById('submit-form-card');
  const settingsInfo = document.getElementById('settings-user-info');
  const settingsGroup = document.getElementById('settings-user-group');
  const submitRep = document.getElementById('submit-reputation-badge');

  // Determine current user and update admin-only elements visibility
  if (userKey) {
    currentUser = db.profiles.find(p => p.access_key === userKey && p.is_active);
  } else {
    currentUser = null;
  }

  const adminElements = document.querySelectorAll('.admin-only');
  const isAdmin = currentUser && (currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator');
  adminElements.forEach(el => {
    if (isAdmin) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  if (userKey && currentUser) {
    // Offline safeguard check (deactivated in sandbox)
    if (!currentUser.is_active) {
        sessionStorage.removeItem('current_user_key');
        currentUser = null;
        syncCurrentUser();
        return;
      }

      // Update Header
      if (userDot) {
        userDot.className = 'user-status-dot online';
      }
      if (userLabel) {
        userLabel.innerText = '@' + currentUser.username;
      }

      // Update Post Review Gates
      if (guestGate) guestGate.classList.add('hidden');
      if (submitForm) submitForm.classList.remove('hidden');
      if (submitRep) submitRep.innerText = 'Reputation: ' + currentUser.reputation_score.toFixed(4);

      // Update Settings Profile Card
      if (settingsGroup) {
        settingsGroup.innerText = 'Active Ledger Profile';
        settingsGroup.className = 'badge privacy-badge';
      }
      if (settingsInfo) {
        settingsInfo.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:0.5rem; font-size:0.88rem; margin-top:1rem;">
            <div><strong>Username:</strong> @${currentUser.username}</div>
            <div><strong>Reputation Score:</strong> ${currentUser.reputation_score.toFixed(4)}</div>
            <div><strong>Invite Lineage Parent:</strong> ${currentUser.invited_by ? '@' + (db.profiles.find(p => p.id === currentUser.invited_by)?.username || 'Unknown') : 'System Level'}</div>
            <div style="margin-top:0.5rem; padding:0.75rem; background:rgba(255,255,255,0.03); border:1px dashed var(--border-color); border-radius:var(--radius-sm);">
              <label style="font-size:0.7rem; color:#71717a; text-transform:uppercase;">Private Access Key Credentials</label>
              <code style="display:block; font-family:var(--font-mono); color:var(--color-primary); word-break:break-all; font-size:0.85rem; margin-top:0.25rem;">${currentUser.access_key}</code>
            </div>
            <button class="btn btn-secondary" id="btn-settings-logout" style="margin-top:0.5rem;">Sign Out from Device</button>
          </div>
        `;
        document.getElementById('btn-settings-logout').addEventListener('click', () => {
          sessionStorage.removeItem('current_user_key');
          location.reload();
        });

        // Username change handler
        const changeNameBtn = document.getElementById('btn-settings-change-username');
        const changeNameInput = document.getElementById('settings-new-username');
        const changeNameError = document.getElementById('username-change-error');

        if (changeNameBtn && changeNameInput) {
          // Clone and replace to prevent duplicate events on multiple calls
          const newBtn = changeNameBtn.cloneNode(true);
          changeNameBtn.parentNode.replaceChild(newBtn, changeNameBtn);

          newBtn.addEventListener('click', async () => {
            const newUsername = changeNameInput.value.trim();
            if (!newUsername) {
              alert("Please enter a new username.");
              return;
            }

            if (changeNameError) changeNameError.classList.add('hidden');

            try {
              const oldKey = sessionStorage.getItem('current_user_key');
              const res = await fetch('https://api.inviteonlyreviews.com/api/profile/update-username', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  authKey: oldKey,
                  newUsername: newUsername
                })
              });

              const data = await res.json();
              if (!res.ok || !data.success) {
                if (changeNameError) {
                  changeNameError.innerText = data.error || 'Failed to update username.';
                  changeNameError.classList.remove('hidden');
                } else {
                  alert("Error: " + (data.error || 'Failed to update username.'));
                }
                return;
              }

              // Access key update logic
              let suffix = '';
              if (oldKey === 'key_root_moderator') {
                suffix = 'moderator';
              } else {
                const lastUnderscore = oldKey.lastIndexOf('_');
                if (lastUnderscore > 4) {
                  suffix = oldKey.substring(lastUnderscore + 1);
                }
              }

              const newKey = suffix ? `key_${newUsername}_${suffix}` : `key_${newUsername}`;

              // Update local DB profile
              const profile = db.profiles.find(p => p.id === currentUser.id);
              if (profile) {
                profile.username = newUsername;
                profile.access_key = newKey;
              }

              saveDbState();
              sessionStorage.setItem('current_user_key', newKey);
              currentUser = profile;

              changeNameInput.value = '';

              prompt(`✓ Username updated successfully!\n\nPlease copy and save this key to log in next time.\n\nYour new Access Key is:`, newKey);
              location.reload();
            } catch (err) {
              console.error(err);
              alert("An error occurred updating username: " + err.message);
            }
          });
        }
      }
      return;
    }

  // Guest State
  currentUser = null;
  if (userDot) {
    userDot.className = 'user-status-dot offline';
  }
  if (userLabel) {
    userLabel.innerText = 'Guest (Sign In)';
  }
  if (guestGate) guestGate.classList.remove('hidden');
  if (submitForm) submitForm.classList.add('hidden');
  if (settingsGroup) {
    settingsGroup.innerText = 'Guest Mode';
    settingsGroup.className = 'badge count-badge';
  }
}

// ----------------------------------------------------
// 3. Tab Switching Transition Manager
// ----------------------------------------------------
function initTabNavigation() {
  const tabs = document.querySelectorAll('.nav-tab-btn');
  const panels = document.querySelectorAll('.portal-tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');

      // Update Nav
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update Panels
      panels.forEach(p => {
        if (p.id === targetId) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });

      // Special Tab Actions
      if (targetId === 'browse-view') {
        renderDirectoryExplorer();
      } else if (targetId === 'feed-view') {
        renderFeedReviews();
      } else if (targetId === 'following-view') {
        renderFollowingFeed();
      } else if (targetId === 'users-view') {
        renderUsersSearch();
      } else if (targetId === 'submit-view') {
        populateDropdowns();
        initAddressAutocomplete();
      }
    });
  });

  // Handle URL hash routing or deep link clicks
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash;
    if (hash === '#post-review') {
      const submitTab = document.getElementById('nav-btn-submit');
      if (submitTab) submitTab.click();
    }
  });

  // Check URL params or hash on page load to pre-select tab
  const urlParams = new URLSearchParams(window.location.search);
  const requestedTab = urlParams.get('tab');
  if (requestedTab) {
    const matchedTab = Array.from(tabs).find(t => t.getAttribute('data-tab') === requestedTab);
    if (matchedTab) {
      matchedTab.click();
    }
  } else if (window.location.hash === '#post-review') {
    const submitTab = document.getElementById('nav-btn-submit');
    if (submitTab) submitTab.click();
  }
}

// Helper: Calculate Consensus ratio and voting weight
function calculateReviewConsensus(reviewId) {
  const review = db.reviews.find(r => r.id === reviewId);
  if (!review) return { theta: 1.0, total: 0, vouches: 0, disputes: 0 };

  const votes = db.vouches_disputes.filter(v => v.review_id === reviewId);
  
  let vouches = 0;
  let disputes = 0;

  votes.forEach(vote => {
    const voter = db.profiles.find(p => p.id === vote.user_id);
    if (!voter || !voter.is_active) return;

    let weight = parseFloat(voter.reputation_score);

    // Apply social proximity discount (50% penalty if voter is in same invite lineage)
    if (checkLineageCollusion(review.author_id, vote.user_id)) {
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
}

// Helper: Get categories, tags list and lineage check
function getReviewTags(reviewId) {
  const tagIds = db.review_tags.filter(rt => rt.review_id === reviewId).map(rt => rt.tag_id);
  return db.tags.filter(t => tagIds.includes(t.id));
}

// Helper: Verify if user has invitation lineage overlap (discount weight by 50%)
function checkLineageCollusion(authorId, voterId) {
  if (authorId === voterId) return false;
  
  // Recursively trace parent nodes up to 5 generations
  const checkParent = (id, target, depth) => {
    if (depth > 5 || !id) return false;
    const profile = db.profiles.find(p => p.id === id);
    if (profile) {
      if (profile.id === target) return true;
      return checkParent(profile.invited_by, target, depth + 1);
    }
    return false;
  };

  return checkParent(authorId, voterId, 1) || checkParent(voterId, authorId, 1);
}

// ----------------------------------------------------
// 4. Forum Feed Rendering & Search
// ----------------------------------------------------
function renderFeedReviews() {
  const searchInput = document.getElementById('feed-search-input');
  const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const sortSelect = document.getElementById('feed-sort-select');
  const sortBy = sortSelect ? sortSelect.value : 'latest';
  const feedList = document.getElementById('portal-feed-list');
  const popularTagsWrapper = document.getElementById('feed-popular-tags');
  const settingsRevealConsent = document.getElementById('chk-settings-reveal-low')?.checked || false;

  if (!feedList) return;
  feedList.innerHTML = '';

  // 1. Populate popular tags filter bar
  if (popularTagsWrapper) {
    popularTagsWrapper.innerHTML = '';
    
    // Add "All" chip
    const allChip = document.createElement('span');
    allChip.className = !activeTagFilter ? 'tag-chip active' : 'tag-chip';
    allChip.innerText = '#all';
    allChip.addEventListener('click', () => {
      activeTagFilter = null;
      document.getElementById('active-tag-indicator').classList.add('hidden');
      renderFeedReviews();
    });
    popularTagsWrapper.appendChild(allChip);

    db.tags.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = activeTagFilter === tag.id ? 'tag-chip active' : 'tag-chip';
      chip.innerText = '#' + tag.name;
      chip.addEventListener('click', () => {
        activeTagFilter = tag.id;
        const indicator = document.getElementById('active-tag-indicator');
        const tagNameEl = document.getElementById('active-tag-name');
        if (indicator && tagNameEl) {
          tagNameEl.innerText = '#' + tag.name;
          indicator.classList.remove('hidden');
        }
        renderFeedReviews();
      });
      popularTagsWrapper.appendChild(chip);
    });
  }

  // 2. Filter reviews
  let reviews = db.reviews.map(review => {
    const author = db.profiles.find(p => p.id === review.author_id);
    const node = db.nodes.find(n => n.id === review.node_id);
    const tags = getReviewTags(review.id);
    const consensus = calculateReviewConsensus(review.id);

    return { ...review, author, node, tags, consensus };
  });

  // Filter by tag if selected
  if (activeTagFilter) {
    reviews = reviews.filter(r => db.review_tags.some(rt => rt.review_id === r.id && rt.tag_id === activeTagFilter));
  }

  // Filter by search query (content, merchant name, or tags)
  if (searchVal) {
    if (searchVal.startsWith('#')) {
      const tagQuery = searchVal.replace('#', '');
      reviews = reviews.filter(r => r.tags.some(t => t.name.toLowerCase().includes(tagQuery)));
    } else {
      reviews = reviews.filter(r => 
        r.raw_content.toLowerCase().includes(searchVal) ||
        r.author.username.toLowerCase().includes(searchVal) ||
        (r.node && r.node.name.toLowerCase().includes(searchVal)) ||
        r.tags.some(t => t.name.toLowerCase().includes(searchVal))
      );
    }
  }

  // 3. Sort reviews
  if (sortBy === 'newest') {
    reviews.sort((a, b) => b.created_at - a.created_at);
  } else if (sortBy === 'consensus') {
    reviews.sort((a, b) => b.consensus.theta - a.consensus.theta);
  } else if (sortBy === 'contested') {
    // Sorting by most voted but closest to 50% split (contested value)
    reviews.sort((a, b) => {
      const weightA = Math.abs(a.consensus.theta - 0.5);
      const weightB = Math.abs(b.consensus.theta - 0.5);
      return weightA - weightB; // Lower difference first (closer to 50/50)
    });
  }

  if (reviews.length === 0) {
    feedList.innerHTML = `
      <div class="empty-feed-placeholder">
        <p>No reviews found matching filters.</p>
      </div>
    `;
    return;
  }

  // 4. Render
  reviews.forEach(r => {
    renderReviewCard(r, feedList, settingsRevealConsent);
  });
}

function renderReviewCard(r, parentContainer, settingsRevealConsent) {
  const cardContainer = document.createElement('div');
  cardContainer.className = 'review-card-container';
  cardContainer.style.marginBottom = '1.25rem';

  // Target parent directory categories
  let pathString = 'Directory Space';
  if (r.node) {
    const pathParts = [];
    const tracePath = (nodeId) => {
      const n = db.nodes.find(item => item.id === nodeId);
      if (n) {
        pathParts.unshift(n.name);
        if (n.parent_id) tracePath(n.parent_id);
      }
    };
    tracePath(r.node.id);
    pathString = pathParts.join(' ➔ ');
  }

  let cardClass = 'review-card card';
  let warningBanner = '';
  const thetaPct = Math.round(r.consensus.theta * 100);

  if (r.consensus.theta >= 0.40 && r.consensus.theta < 0.70) {
    cardClass += ' disputed-mid';
    warningBanner = `<div class="review-warning-banner yellow">⚠️ Contested Feedback: Community consensus is split (${thetaPct}% approve)</div>`;
  } else if (r.consensus.theta < 0.40) {
    cardClass += ' disputed-heavy';
    warningBanner = `<div class="review-warning-banner red">🛑 LOW CONSENSUS: This review has failed community guidelines (${thetaPct}% approve)</div>`;
  }

  let verifyBadge = '';
  if (r.is_verified_experience) {
    let badgeLabel = '✓ Verified Experience';
    if (r.verification_method === 'exif_gps') badgeLabel = '📍 GPS Proximity Verified';
    if (r.verification_method === 'wasm_ocr') badgeLabel = '🧾 WASM Receipt OCR';
    verifyBadge = `<span class="badge verification-status verified" style="pointer-events: none;">${badgeLabel}</span>`;
  } else {
    verifyBadge = `<span class="badge verification-status unverified" style="pointer-events: none;">Unverified</span>`;
  }

  let tagsHtml = '';
  if (r.tags && r.tags.length > 0) {
    tagsHtml = `
      <div class="review-tag-badges" style="margin-top: 0.75rem; display: flex; gap: 0.35rem; flex-wrap: wrap;">
        ${r.tags.map(t => `<span class="tag-chip" style="font-size:0.75rem; padding: 2px 8px; background: rgba(255,255,255,0.04); border: 1px solid var(--border-color); cursor:pointer;" onclick="setFeedTagFilter(${t.id}, '${t.name}')">#${t.name}</span>`).join('')}
      </div>
    `;
  }

  let paramsHtml = '';
  if (r.param_val_1 !== null) {
    paramsHtml = `
      <div class="post-telemetry-meta" style="margin-top:0.5rem; padding:0.5rem; background:rgba(0,0,0,0.2); border-radius:4px; font-size:0.75rem; font-family:var(--font-mono); color:#a1a1aa;">
        📊 Telemetry Data: Param1=${r.param_val_1.toFixed(2)}${r.param_val_2 !== null ? `, Param2=${r.param_val_2.toFixed(2)}` : ''}${r.param_val_3 !== null ? `, Param3=${r.param_val_3.toFixed(2)}` : ''}
      </div>
    `;
  }

  const hasVotedVouch = currentUser ? db.vouches_disputes.some(v => v.review_id === r.id && v.user_id === currentUser.id && v.type === 'vouch') : false;
  const hasVotedDispute = currentUser ? db.vouches_disputes.some(v => v.review_id === r.id && v.user_id === currentUser.id && v.type === 'dispute') : false;

  const vouchBtnClass = hasVotedVouch ? 'vote-btn vouch-active' : 'vote-btn';
  const disputeBtnClass = hasVotedDispute ? 'vote-btn dispute-active' : 'vote-btn';

  const isContested = r.consensus.theta < 0.40;
  const isCollapsed = isContested && !settingsRevealConsent;

  let deleteBtnHtml = '';
  const isModerator = currentUser && (currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator');
  if (isModerator) {
    deleteBtnHtml = `<button class="btn-delete-review" onclick="deleteReviewFromFeed('${r.id}')" style="background: transparent; border: none; color: var(--color-danger); cursor: pointer; font-size: 0.8rem; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px; border: 1px solid rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05);" onmouseenter="this.style.background='rgba(239, 68, 68, 0.15)'" onmouseleave="this.style.background='rgba(239, 68, 68, 0.05)'">🗑️ Delete</button>`;
  }

  // Follow/Unfollow button HTML
  let followBtnHtml = '';
  if (currentUser && r.author && r.author_id !== currentUser.id) {
    const follows = loadFollows();
    const isFollowed = follows.includes(r.author_id);
    if (isFollowed) {
      followBtnHtml = `<button onclick="toggleFollowUser('${r.author_id}', event)" class="btn-follow" style="background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-color); color: #a1a1aa; cursor: pointer; font-size: 0.72rem; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px; margin-left: 0.5rem; transition: background 0.2s;">👥 Unfollow</button>`;
    } else {
      followBtnHtml = `<button onclick="toggleFollowUser('${r.author_id}', event)" class="btn-follow active" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: var(--color-primary); cursor: pointer; font-size: 0.72rem; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px; margin-left: 0.5rem; transition: background 0.2s;" onmouseenter="this.style.background='rgba(16, 185, 129, 0.2)'" onmouseleave="this.style.background='rgba(16, 185, 129, 0.1)'">👤+ Follow</button>`;
    }
  }

  const cardContentHtml = `
    <div class="${cardClass}" style="${isCollapsed ? 'filter: blur(4px); pointer-events: none; opacity: 0.2;' : ''}">
      ${warningBanner}
      <div class="post-header-row" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.75rem;">
        <div>
          <div class="post-path" style="font-size:0.75rem; color:var(--color-primary); font-family:var(--font-mono);" title="${pathString.replace(/&#x27;/g, `'`).replace(/&quot;/g, `"`).replace(/&amp;/g, `&`)}">${pathString}</div>
          <div style="display:flex; align-items:center; gap:0.25rem;">
            <h3 class="post-author" style="margin: 0.15rem 0; font-size: 0.95rem;">@${r.author?.username || 'deactivated_user'}</h3>
            ${followBtnHtml}
          </div>
        </div>
        <div style="display:flex; gap:0.5rem; align-items:center;">
          ${verifyBadge}
          <span class="post-date" style="font-size:0.75rem; color:#71717a;">${new Date(r.created_at).toLocaleDateString()}</span>
          ${deleteBtnHtml}
        </div>
      </div>
      <p class="post-body-text" style="font-size:0.9rem; line-height:1.45; color:#e4e4e7;">${r.raw_content}</p>
      ${paramsHtml}
      ${tagsHtml}
      
      <div class="post-footer-row" style="display:flex; align-items:center; justify-content:space-between; margin-top:1rem; border-top:1px solid var(--border-color); padding-top:0.75rem;">
        <div class="post-votes-summary" style="font-size:0.8rem; color:#a1a1aa;">
          <span>👍 Vouch Weight: <strong>${r.consensus.vouches.toFixed(1)}</strong></span>
          <span style="margin-left:0.75rem;">👎 Dispute Weight: <strong>${r.consensus.disputes.toFixed(1)}</strong></span>
        </div>
        <div class="post-vote-actions" style="display:flex; gap:0.5rem;">
          <button class="${vouchBtnClass}" onclick="castFeedVote('${r.id}', 'vouch')">👍 Vouch</button>
          <button class="${disputeBtnClass}" onclick="castFeedVote('${r.id}', 'dispute')">👎 Dispute</button>
        </div>
      </div>
    </div>
  `;

  cardContainer.innerHTML = cardContentHtml;

  if (isCollapsed) {
    const overlay = document.createElement('div');
    overlay.className = 'reveal-overlay';
    overlay.innerHTML = `
      <span style="font-size: 1.5rem; margin-bottom: 0.25rem;">🛑</span>
      <strong style="color: #f43f5e; font-size: 0.85rem;">Review Contested (Guidelines failed)</strong>
      <p style="font-size: 0.72rem; color: #a1a1aa; margin: 0.25rem 1rem; text-align: center;">This post has low community consensus. Click to reveal.</p>
    `;
    overlay.addEventListener('click', () => {
      overlay.style.display = 'none';
      const cardEl = cardContainer.querySelector('.review-card');
      if (cardEl) {
        cardEl.style.filter = 'none';
        cardEl.style.opacity = '1';
        cardEl.style.pointerEvents = 'auto';
      }
    });
    cardContainer.appendChild(overlay);
  }

  parentContainer.appendChild(cardContainer);
}

function renderFollowingFeed() {
  const feedList = document.getElementById('portal-following-feed-list');
  const settingsRevealConsent = document.getElementById('chk-settings-reveal-low')?.checked || false;

  if (!feedList) return;
  feedList.innerHTML = '';

  const follows = loadFollows();

  if (follows.length === 0) {
    feedList.innerHTML = `
      <div class="empty-feed-placeholder" style="text-align: center; padding: 3rem 1rem;">
        <p style="color: #a1a1aa; font-size: 0.95rem;">You are not following any reviewers yet.</p>
        <p style="color: var(--color-text-dim); font-size: 0.8rem; margin-top: 0.5rem;">Follow reviewers from the main feed to see their posts here.</p>
      </div>
    `;
    return;
  }

  // Filter reviews
  let reviews = db.reviews.map(review => {
    const author = db.profiles.find(p => p.id === review.author_id);
    const node = db.nodes.find(n => n.id === review.node_id);
    const tags = getReviewTags(review.id);
    const consensus = calculateReviewConsensus(review.id);

    return { ...review, author, node, tags, consensus };
  });

  // Filter by followed authors
  reviews = reviews.filter(r => follows.includes(r.author_id));

  // Sort chronologically (latest reviews first)
  reviews.sort((a, b) => b.created_at - a.created_at);

  if (reviews.length === 0) {
    feedList.innerHTML = `
      <div class="empty-feed-placeholder" style="text-align: center; padding: 3rem 1rem;">
        <p style="color: #a1a1aa; font-size: 0.95rem;">No reviews posted by reviewers you follow.</p>
      </div>
    `;
    return;
  }

  reviews.forEach(r => {
    renderReviewCard(r, feedList, settingsRevealConsent);
  });
}

function renderUsersSearch() {
  renderUsersSearchList();

  if (selectedUserId) {
    renderSelectedUserDetails(selectedUserId);
  } else {
    const detailCard = document.getElementById('selected-user-info-card');
    if (detailCard) {
      detailCard.innerHTML = `
        <div class="empty-feed-placeholder" style="text-align: center; padding: 3rem 1rem;">
          <p style="color: #a1a1aa; font-size: 0.95rem;">Select a reviewer from the left sidebar to view details</p>
        </div>
      `;
    }
    const reviewList = document.getElementById('user-reviews-list');
    if (reviewList) {
      reviewList.innerHTML = '';
    }
  }
}

function renderUsersSearchList() {
  const searchInput = document.getElementById('users-search-input');
  const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const deck = document.getElementById('users-list-deck');
  const countBadge = document.getElementById('users-count-badge');

  if (!deck) return;
  deck.innerHTML = '';

  let profiles = db.profiles;

  if (searchVal) {
    profiles = profiles.filter(p => p.username.toLowerCase().includes(searchVal));
  }

  profiles.sort((a, b) => b.reputation_score - a.reputation_score);

  if (countBadge) {
    countBadge.innerText = `${profiles.length} user${profiles.length === 1 ? '' : 's'}`;
  }

  if (profiles.length === 0) {
    deck.innerHTML = `
      <div class="empty-feed-placeholder" style="text-align: center; padding: 1.5rem 0.5rem; font-size: 0.85rem; color: #a1a1aa;">
        No users found matching query.
      </div>
    `;
    return;
  }

  profiles.forEach(p => {
    const item = document.createElement('div');
    item.className = 'user-deck-item';
    if (selectedUserId === p.id) {
      item.classList.add('selected');
    }
    
    const follows = loadFollows();
    const isFollowed = follows.includes(p.id);
    const followTag = isFollowed ? ' <span style="color: var(--color-primary); font-size: 0.72rem;">(Following)</span>' : '';

    item.innerHTML = `
      <div class="user-deck-info">
        <div class="user-deck-name">@${p.username}${followTag}</div>
        <div class="user-deck-rep">Reputation: ${p.reputation_score.toFixed(4)}</div>
      </div>
      <div class="user-deck-action">View &rarr;</div>
    `;

    item.addEventListener('click', () => {
      selectUserInExplorer(p.id);
    });

    deck.appendChild(item);
  });
}

window.selectUserInExplorer = function(userId) {
  selectedUserId = userId;
  renderUsersSearchList();
  renderSelectedUserDetails(userId);
};

function renderSelectedUserDetails(userId) {
  const detailCard = document.getElementById('selected-user-info-card');
  const reviewList = document.getElementById('user-reviews-list');
  const settingsRevealConsent = document.getElementById('chk-settings-reveal-low')?.checked || false;

  if (!detailCard || !reviewList) return;

  const profile = db.profiles.find(p => p.id === userId);
  if (!profile) {
    detailCard.innerHTML = `<div class="empty-feed-placeholder"><p>User not found.</p></div>`;
    reviewList.innerHTML = '';
    return;
  }

  let inviterName = 'None (Root Node)';
  if (profile.invited_by) {
    const inviter = db.profiles.find(p => p.id === profile.invited_by);
    inviterName = inviter ? `@${inviter.username}` : 'Unknown Profile';
  }

  const follows = loadFollows();
  const isFollowed = follows.includes(profile.id);
  
  let followButtonHtml = '';
  if (currentUser && profile.id !== currentUser.id) {
    if (isFollowed) {
      followButtonHtml = `
        <button onclick="toggleFollowUserFromExplorer('${profile.id}')" class="btn" style="background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-color); color: #a1a1aa; width: auto; font-size: 0.85rem; padding: 0.45rem 1rem;">
          Unfollow Reviewer
        </button>
      `;
    } else {
      followButtonHtml = `
        <button onclick="toggleFollowUserFromExplorer('${profile.id}')" class="btn btn-primary" style="width: auto; font-size: 0.85rem; padding: 0.45rem 1rem;">
          👤+ Follow Reviewer
        </button>
      `;
    }
  }

  detailCard.innerHTML = `
    <div class="user-profile-header" style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem; margin-bottom: 1rem;">
      <div>
        <h2 style="font-family: var(--font-heading); font-size: 1.35rem; margin: 0 0 0.25rem 0;">@${profile.username}</h2>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="user-meta-badge" style="background: ${profile.is_active ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color: ${profile.is_active ? '#10b981' : '#ef4444'}; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.72rem; font-weight: 600;">
            ${profile.is_active ? 'Active Profile' : 'Suspended'}
          </span>
        </div>
      </div>
      <div>
        ${followButtonHtml}
      </div>
    </div>

    <div class="user-profile-meta-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 0.5rem;">
      <div class="user-meta-item">
        <span class="user-meta-label" style="font-size: 0.72rem; color: var(--color-text-dim); text-transform: uppercase;">Reputation Score</span>
        <span class="user-meta-value" style="font-size: 1.1rem; color: var(--color-primary); font-family: var(--font-mono); font-weight: 600;">${profile.reputation_score.toFixed(4)}</span>
      </div>
      <div class="user-meta-item">
        <span class="user-meta-label" style="font-size: 0.72rem; color: var(--color-text-dim); text-transform: uppercase;">Inviter</span>
        <span class="user-meta-value" style="font-size: 0.95rem; font-weight: 500;">${inviterName}</span>
      </div>
      <div class="user-meta-item">
        <span class="user-meta-label" style="font-size: 0.72rem; color: var(--color-text-dim); text-transform: uppercase;">Demographic Cohort</span>
        <span class="user-meta-value" style="font-size: 0.95rem; font-weight: 500;">${profile.demographic_group || 'N/A'}</span>
      </div>
    </div>
  `;

  reviewList.innerHTML = '';
  const userReviews = db.reviews.filter(r => r.author_id === profile.id).map(review => {
    const author = db.profiles.find(p => p.id === review.author_id);
    const node = db.nodes.find(n => n.id === review.node_id);
    const tags = getReviewTags(review.id);
    const consensus = calculateReviewConsensus(review.id);
    return { ...review, author, node, tags, consensus };
  });

  userReviews.sort((a, b) => b.created_at - a.created_at);

  if (userReviews.length === 0) {
    reviewList.innerHTML = `
      <div class="empty-feed-placeholder" style="text-align: center; padding: 3rem 1rem;">
        <p style="color: #a1a1aa; font-size: 0.9rem;">This reviewer has not published any immutable feedback yet.</p>
      </div>
    `;
    return;
  }

  userReviews.forEach(r => {
    renderReviewCard(r, reviewList, settingsRevealConsent);
  });
}

window.toggleFollowUserFromExplorer = function(userId) {
  let follows = loadFollows();
  const idx = follows.indexOf(userId);
  if (idx > -1) {
    follows.splice(idx, 1);
  } else {
    follows.push(userId);
  }
  saveFollows(follows);
  
  renderUsersSearch();
};

// Global hook to clear feed filters or set tags
window.setFeedTagFilter = function(tagId, tagName) {
  activeTagFilter = tagId;
  const indicator = document.getElementById('active-tag-indicator');
  const tagNameEl = document.getElementById('active-tag-name');
  if (indicator && tagNameEl) {
    tagNameEl.innerText = '#' + tagName;
    indicator.classList.remove('hidden');
  }
  
  // Switch to Feed tab in case we clicked a tag chip from directory/profile
  const feedTabBtn = document.querySelector('[data-tab="feed-view"]');
  if (feedTabBtn) feedTabBtn.click();
  
  renderFeedReviews();
};

window.castFeedVote = function(reviewId, type) {
  loadDb();
  if (!currentUser) {
    alert("Authentication Required: You must enter your Access Key in the Profile tab to cast vouches or disputes.");
    location.href = 'profile.html';
    return;
  }

  // Check unique vote rule
  let existingIndex = db.vouches_disputes.findIndex(v => v.review_id === reviewId && v.user_id === currentUser.id);
  const review = db.reviews.find(r => r.id === reviewId);
  if (!review) return;

  // Verify social proximity discount (50% weight penalty for direct lineage)
  let allocatedWeight = parseFloat(currentUser.reputation_score);
  const isLineageCollusion = checkLineageCollusion(review.author_id, currentUser.id);
  if (isLineageCollusion) {
    allocatedWeight = allocatedWeight * 0.5000;
  }

  if (existingIndex > -1) {
    const existing = db.vouches_disputes[existingIndex];
    if (existing.type === type) {
      // Toggle off
      db.vouches_disputes.splice(existingIndex, 1);
    } else {
      // Switch type
      existing.type = type;
      existing.allocated_weight = allocatedWeight;
    }
  } else {
    // New vote
    db.vouches_disputes.push({
      review_id: reviewId,
      user_id: currentUser.id,
      type: type,
      allocated_weight: allocatedWeight
    });
  }

  saveDbState();
  
  // Re-run reputation contagion calculations
  runLineageReputationDecay();

  // Sync UI — update whichever tab is currently visible
  const activeTab = document.querySelector('.nav-tab-btn.active')?.getAttribute('data-tab');
  if (activeTab === 'feed-view') renderFeedReviews();
  else if (activeTab === 'following-view') renderFollowingFeed();
  else if (activeTab === 'browse-view') renderDirectoryExplorer();
  else if (activeTab === 'users-view' && selectedUserId) renderSelectedUserDetails(selectedUserId);
  else renderFeedReviews(); // fallback

  // Sync vouch to database in background
  fetch('https://api.inviteonlyreviews.com/api/vouch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      authKey: sessionStorage.getItem('current_user_key'),
      reviewId: reviewId,
      type: type,
      allocatedWeight: allocatedWeight
    })
  }).catch(err => {
    console.error("Failed to sync vouch:", err);
  });
};

window.deleteReviewFromFeed = function(reviewId) {
  if (!confirm("Are you sure you want to permanently delete this review from the network?")) {
    return;
  }
  
  loadDb();
  
  db.reviews = db.reviews.filter(r => r.id !== reviewId);
  db.vouches_disputes = db.vouches_disputes.filter(v => v.review_id !== reviewId);
  db.review_tags = db.review_tags.filter(rt => rt.review_id !== reviewId);
  
  saveDbState();
  runLineageReputationDecay();
  
  // Sync UI
  renderFeedReviews();
  renderDirectoryExplorer();
  
  // Update other views via event trigger
  window.dispatchEvent(new Event('storage'));

  // Delete from database
  fetch('https://api.inviteonlyreviews.com/api/reviews', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      authKey: sessionStorage.getItem('current_user_key'),
      reviewId: reviewId
    })
  }).then(res => {
    if (res.ok) {
      syncLiveReviews();
    } else {
      res.json().then(data => alert("Warning: Review deleted locally but failed to sync from database: " + (data.error || "Unknown error")));
    }
  }).catch(err => {
    console.error("Failed to delete review:", err);
  });
  
  alert("Review successfully deleted from the network.");
};

function getLineageAlpha() {
  const settingsStr = localStorage.getItem('review_network_settings');
  if (settingsStr) {
    try {
      const settings = JSON.parse(settingsStr);
      if (settings && typeof settings.lineageAlpha === 'number') {
        return settings.lineageAlpha;
      }
    } catch (e) {
      console.warn("Failed to parse review_network_settings:", e);
    }
  }
  return 0.25; // default alpha
}

// ----------------------------------------------------
// 5. Lineage Penalities & Reputation Contagion Engine
// ----------------------------------------------------
function runLineageReputationDecay() {
  loadDb();
  
  // Reset all profile reputations to base scores first
  db.profiles.forEach(p => {
    if (p.is_active) {
      p.reputation_score = p.base_reputation;
    }
  });

  const penaltyAlpha = getLineageAlpha();

  // Compute for all profiles
  db.profiles.forEach(targetProfile => {
    if (!targetProfile.is_active) return;

    // Find all reviews written by downstream invitees (blast radius)
    let totalDiscount = 0.0;

    const findDeconstructionWeight = (inviterId, generation) => {
      const invitees = db.profiles.filter(p => p.invited_by === inviterId);
      invitees.forEach(invitee => {
        // Fetch reviews written by this invitee
        const inviteeReviews = db.reviews.filter(r => r.author_id === invitee.id);
        inviteeReviews.forEach(r => {
          const consensus = calculateReviewConsensus(r.id);
          if (consensus.theta < 0.40) {
            // Dispute decay math: (1 - consensus) / (generation_distance * alpha)
            const decay = (1.0 - consensus.theta) / (generation * penaltyAlpha);
            totalDiscount += decay;
          }
        });

        // Recursively inspect grandchildren
        findDeconstructionWeight(invitee.id, generation + 1);
      });
    };

    findDeconstructionWeight(targetProfile.id, 1);

    // Apply decayed reputation score capped at zero
    targetProfile.reputation_score = Math.max(0.0000, targetProfile.base_reputation - totalDiscount);
  });

  saveDbState();
  syncCurrentUser(); // Refreshes badge
}

// ----------------------------------------------------
// 6. Hierarchical Directory Browser
// ----------------------------------------------------
function renderDirectoryExplorer() {
  const listDeck = document.getElementById('directory-items-deck');
  const breadcrumbs = document.getElementById('directory-breadcrumbs-bar');
  const detailsCard = document.getElementById('selected-node-info-card');
  const detailsReviews = document.getElementById('directory-reviews-list');
  const nodeCountBadge = document.getElementById('directory-nodes-count');

  if (!listDeck) return;
  listDeck.innerHTML = '';

  // Get current directory root
  let currentParentId = currentDirectoryPath.length > 0 ? currentDirectoryPath[currentDirectoryPath.length - 1].id : null;

  // 1. Render Breadcrumbs
  if (breadcrumbs) {
    breadcrumbs.innerHTML = '';
    
    // Root link
    const rootLink = document.createElement('span');
    rootLink.className = 'crumb-link';
    rootLink.innerText = '📁 Earth';
    rootLink.addEventListener('click', () => {
      currentDirectoryPath = [];
      renderDirectoryExplorer();
    });
    breadcrumbs.appendChild(rootLink);

    currentDirectoryPath.forEach((node, idx) => {
      const separator = document.createElement('span');
      separator.className = 'crumb-separator';
      separator.innerText = ' ➔ ';
      breadcrumbs.appendChild(separator);

      const link = document.createElement('span');
      link.className = idx === currentDirectoryPath.length - 1 ? 'crumb-link active' : 'crumb-link';
      link.innerText = node.name;
      link.addEventListener('click', () => {
        currentDirectoryPath = currentDirectoryPath.slice(0, idx + 1);
        renderDirectoryExplorer();
      });
      breadcrumbs.appendChild(link);
    });
  }

  // 2. Load child nodes in current parent directory
  const children = db.nodes.filter(n => n.parent_id === currentParentId);
  if (nodeCountBadge) {
    nodeCountBadge.innerText = `${children.length} space(s)`;
  }

  if (children.length === 0) {
    listDeck.innerHTML = `
      <div style="padding:1.5rem; text-align:center; color:#71717a; font-size:0.85rem;">
        No sub-spaces listed in this directory location.
      </div>
    `;
  }

  children.forEach(child => {
    const card = document.createElement('div');
    card.className = 'directory-card card-hover-effect';
    
    let typeIcon = '📂';
    if (child.node_type === 'merchant') typeIcon = '🏪';
    if (child.node_type === 'item') typeIcon = '📦';
    if (child.node_type === 'fishing_spot') typeIcon = '🎣';
    if (child.node_type === 'point_of_interest') typeIcon = '📍';

    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.75rem;">
        <span style="font-size:1.5rem;">${typeIcon}</span>
        <div style="display:flex; flex-direction:column;">
          <strong style="font-size:0.95rem; color:#e4e4e7;">${child.name}</strong>
          <span style="font-size:0.72rem; color:#71717a; text-transform:uppercase; font-family:var(--font-mono);">${child.node_type}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      // If click folder node, traverse down
      if (child.node_type !== 'merchant' && child.node_type !== 'item' && child.node_type !== 'fishing_spot') {
        currentDirectoryPath.push(child);
        renderDirectoryExplorer();
      } else {
        // Highlight active details card and render reviews specifically
        renderNodeDetail(child);
      }
    });

    listDeck.appendChild(card);
  });

  // Default Node Detail state if nothing selected: show the parent folder details
  if (currentDirectoryPath.length > 0) {
    renderNodeDetail(currentDirectoryPath[currentDirectoryPath.length - 1]);
  } else {
    // Root level details
    const rootNode = db.nodes.find(n => n.parent_id === null);
    if (rootNode) renderNodeDetail(rootNode);
  }
}

// Render active node statistics & review feed
function renderNodeDetail(node) {
  const detailsCard = document.getElementById('selected-node-info-card');
  const detailsReviews = document.getElementById('directory-reviews-list');
  const settingsRevealConsent = document.getElementById('chk-settings-reveal-low')?.checked || false;

  if (!detailsCard || !detailsReviews) return;
  detailsCard.innerHTML = '';
  detailsReviews.innerHTML = '';

  // Get reviews specifically for this node
  const reviews = db.reviews.filter(r => r.node_id === node.id).map(review => {
    const author = db.profiles.find(p => p.id === review.author_id);
    const consensus = calculateReviewConsensus(review.id);
    const tags = getReviewTags(review.id);
    return { ...review, author, consensus, tags };
  });

  // Calculate Node Consensus averages
  let avgConsensus = 1.0;
  if (reviews.length > 0) {
    const sum = reviews.reduce((acc, r) => acc + r.consensus.theta, 0);
    avgConsensus = sum / reviews.length;
  }
  const avgPct = Math.round(avgConsensus * 100);

  // Address and coords
  const addressBlock = node.address ? `
    <div style="font-size:0.85rem; margin-top:0.35rem; color:#a1a1aa;">
      📍 <strong>Address:</strong> ${node.address}
    </div>
  ` : '';
  const coordsBlock = node.coordinates ? `
    <div style="font-size:0.85rem; margin-top:0.15rem; color:#a1a1aa;">
      🌐 <strong>Coordinates:</strong> <code style="font-family:var(--font-mono); font-size:0.78rem;">${node.coordinates}</code>
    </div>
  ` : '';

  let consensusBadgeColor = 'var(--color-success)';
  if (avgConsensus < 0.70) consensusBadgeColor = 'var(--color-warning)';
  if (avgConsensus < 0.40) consensusBadgeColor = '#f43f5e';

  const isMod = currentUser && (currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator');
  let modActionsButtonHtml = '';
  if (isMod && node.parent_id !== null) {
    modActionsButtonHtml = `
      <button class="btn btn-danger btn-sm" onclick="deleteNodeFromDirectory(${node.id})" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; background: transparent; border: 1px solid var(--color-danger); color: var(--color-danger); border-radius: var(--radius-sm); display: inline-flex; align-items: center; gap: 0.25rem; width: auto; cursor: pointer; margin-left: 0.5rem;">
        🗑️ Delete Space
      </button>
      <button class="btn btn-warning btn-sm" onclick="mergeNodeInDirectory(${node.id})" style="padding: 0.35rem 0.65rem; font-size: 0.75rem; background: transparent; border: 1px solid var(--color-warning); color: var(--color-warning); border-radius: var(--radius-sm); display: inline-flex; align-items: center; gap: 0.25rem; width: auto; cursor: pointer; margin-left: 0.5rem;">
        🔀 Merge Space
      </button>
    `;
  }

  detailsCard.innerHTML = `
    <div class="card-header" style="border-bottom: 1px solid var(--border-color); padding-bottom:0.75rem; margin-bottom:0.75rem;">
      <div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="badge count-badge" style="font-family:var(--font-mono); text-transform:uppercase;">${node.node_type}</span>
          ${modActionsButtonHtml}
        </div>
        <h2 style="margin-top:0.25rem;">${node.name}</h2>
      </div>
      <div style="text-align:right;">
        <div style="font-size:0.7rem; color:#71717a; text-transform:uppercase;">Consensus Rating</div>
        <strong style="font-size:1.35rem; color:${consensusBadgeColor};">${avgPct}%</strong>
      </div>
    </div>
    ${addressBlock}
    ${coordsBlock}
    <div style="display:flex; justify-content:space-between; margin-top:1rem; font-size:0.82rem; color:#71717a;">
      <span>Directory path: <code>${node.path}</code></span>
      <span>${reviews.length} feedback posts</span>
    </div>
  `;

  // Render node reviews list
  if (reviews.length === 0) {
    detailsReviews.innerHTML = `
      <div class="empty-feed-placeholder">
        <p>No feedback posts registered in this directory space yet.</p>
        <button class="btn btn-secondary btn-sm" style="margin-top:0.5rem;" onclick="redirectToPostReview(${node.id})">Be the first to post</button>
      </div>
    `;
    return;
  }

  reviews.forEach(r => {
    const cardContainer = document.createElement('div');
    cardContainer.className = 'review-card-container';
    cardContainer.style.marginBottom = '1rem';

    let cardClass = 'review-card card';
    let warningBanner = '';
    const thetaPct = Math.round(r.consensus.theta * 100);

    if (r.consensus.theta >= 0.40 && r.consensus.theta < 0.70) {
      cardClass += ' disputed-mid';
      warningBanner = `<div class="review-warning-banner yellow">⚠️ Contested: Split consensus (${thetaPct}%)</div>`;
    } else if (r.consensus.theta < 0.40) {
      cardClass += ' disputed-heavy';
      warningBanner = `<div class="review-warning-banner red">🛑 LOW CONSENSUS: Guidelines Failed (${thetaPct}%)</div>`;
    }

    const hasVotedVouch = currentUser ? db.vouches_disputes.some(v => v.review_id === r.id && v.user_id === currentUser.id && v.type === 'vouch') : false;
    const hasVotedDispute = currentUser ? db.vouches_disputes.some(v => v.review_id === r.id && v.user_id === currentUser.id && v.type === 'dispute') : false;

    const vouchBtnClass = hasVotedVouch ? 'vote-btn vouch-active' : 'vote-btn';
    const disputeBtnClass = hasVotedDispute ? 'vote-btn dispute-active' : 'vote-btn';

    // Collapse content overlay if contested and user consent is NOT checked
    const isContested = r.consensus.theta < 0.40;
    const isCollapsed = isContested && !settingsRevealConsent;

    let verifyBadge = '';
    if (r.is_verified_experience) {
      let badgeLabel = '✓ Verified';
      if (r.verification_method === 'exif_gps') badgeLabel = '📍 GPS';
      if (r.verification_method === 'wasm_ocr') badgeLabel = '🧾 OCR';
      verifyBadge = `<span class="badge verification-status verified" style="font-size:0.65rem; padding: 2px 6px; pointer-events: none;">${badgeLabel}</span>`;
    }

    let deleteBtnHtml = '';
    const isModerator = currentUser && (currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator');
    if (isModerator) {
      deleteBtnHtml = `<button class="btn-delete-review" onclick="deleteReviewFromFeed('${r.id}')" style="background: transparent; border: none; color: var(--color-danger); cursor: pointer; font-size: 0.7rem; padding: 1px 4px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px; border: 1px solid rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05);" onmouseenter="this.style.background='rgba(239, 68, 68, 0.15)'" onmouseleave="this.style.background='rgba(239, 68, 68, 0.05)'">🗑️ Delete</button>`;
    }

    cardContainer.innerHTML = `
      <div class="${cardClass}" style="${isCollapsed ? 'filter: blur(4px); pointer-events: none; opacity: 0.2;' : ''}">
        ${warningBanner}
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
          <strong style="font-size:0.85rem; color:#e4e4e7;">@${r.author?.username || 'deactivated_user'}</strong>
          <div style="display:flex; gap:0.25rem; align-items:center;">
            ${verifyBadge}
            <span style="font-size:0.7rem; color:#71717a;">${new Date(r.created_at).toLocaleDateString()}</span>
            ${deleteBtnHtml}
          </div>
        </div>
        <p style="font-size:0.82rem; line-height:1.4; color:#d4d4d8; margin:0;">${r.raw_content}</p>
        ${r.tags && r.tags.length > 0 ? `<div style="display:flex; gap:0.25rem; flex-wrap:wrap; margin-top:0.4rem;">${r.tags.map(t => `<span class="tag-chip" style="font-size:0.65rem; padding: 1px 6px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color);">#${t.name}</span>`).join('')}</div>` : ''}
        
        <div style="display:flex; align-items:center; justify-content:space-between; margin-top:0.75rem; border-top:1px solid var(--border-color); padding-top:0.5rem; font-size:0.75rem;">
          <span style="color:#71717a;">👍 ${r.consensus.vouches.toFixed(1)} | 👎 ${r.consensus.disputes.toFixed(1)}</span>
          <div style="display:flex; gap:0.25rem;">
            <button class="${vouchBtnClass}" style="font-size:0.7rem; padding: 2px 6px;" onclick="castFeedVote('${r.id}', 'vouch')">👍 Vouch</button>
            <button class="${disputeBtnClass}" style="font-size:0.7rem; padding: 2px 6px;" onclick="castFeedVote('${r.id}', 'dispute')">👎 Dispute</button>
          </div>
        </div>
      </div>
    `;

    if (isCollapsed) {
      const overlay = document.createElement('div');
      overlay.className = 'reveal-overlay';
      overlay.innerHTML = `
        <span style="font-size: 1.1rem; margin-bottom: 0.15rem;">🛑</span>
        <strong style="color: #f43f5e; font-size: 0.75rem;">Contested Feedback</strong>
        <p style="font-size: 0.65rem; color: #a1a1aa; margin: 0.15rem 0.5rem; text-align: center;">Click to reveal.</p>
      `;
      overlay.addEventListener('click', () => {
        overlay.style.display = 'none';
        const cardEl = cardContainer.querySelector('.review-card');
        if (cardEl) {
          cardEl.style.filter = 'none';
          cardEl.style.opacity = '1';
          cardEl.style.pointerEvents = 'auto';
        }
      });
      cardContainer.appendChild(overlay);
    }

    detailsReviews.appendChild(cardContainer);
  });
}

// Redirect hook to submission from directory placeholder
window.redirectToPostReview = function(nodeId) {
  const submitTabBtn = document.querySelector('[data-tab="submit-view"]');
  if (submitTabBtn) {
    submitTabBtn.click();
    
    // Pre-select target node in dropdown
    const select = document.getElementById('select-portal-target-node');
    if (select) {
      select.value = nodeId;
      select.dispatchEvent(new Event('change'));
    }
  }
};

// ----------------------------------------------------
// 7. Searchable Dropdowns & Autofill Forms
// ----------------------------------------------------
function populateDropdowns() {
  loadDb();
  
  // 1. Populate Target Nodes
  const selectTarget = document.getElementById('select-portal-target-node');
  const selectParent = document.getElementById('select-portal-parent-category');

  if (selectTarget) {
    selectTarget.innerHTML = '';
    // Load all leaf nodes
    db.nodes.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.text = `[${n.node_type.toUpperCase()}] ${n.name} (path: ${n.path})`;
      selectTarget.appendChild(opt);
    });
  }

  if (selectParent) {
    selectParent.innerHTML = '';
    // Load category nodes
    db.nodes.filter(n => n.node_type !== 'merchant' && n.node_type !== 'item' && n.node_type !== 'fishing_spot').forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.text = `${n.name} (path: ${n.path})`;
      selectParent.appendChild(opt);
    });
  }
}

// Helper: Bind real-time searchable dropdown filter inputs
function initDropdownTypeaheadFilter() {
  const setupTypeahead = (inputId, selectId) => {
    const input = document.getElementById(inputId);
    const select = document.getElementById(selectId);
    if (!input || !select) return;

    input.addEventListener('input', () => {
      const filter = input.value.toLowerCase().trim();
      Array.from(select.options).forEach(opt => {
        const text = opt.text.toLowerCase();
        if (text.includes(filter)) {
          opt.style.display = '';
        } else {
          opt.style.display = 'none';
        }
      });
    });
  };

  setupTypeahead('portal-target-node-search', 'select-portal-target-node');
  setupTypeahead('portal-parent-category-search', 'select-portal-parent-category');
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// OpenStreetMap Nominatim verified address autocomplete
function initAddressAutocomplete() {
  const addressInput = document.getElementById('portal-review-new-address');
  const coordsInput = document.getElementById('portal-review-new-coords');
  const autocompleteMenu = document.getElementById('portal-address-autocomplete');
  if (!addressInput || !autocompleteMenu) return;

  const fetchSuggestions = async () => {
    autocompleteMenu.innerHTML = '';
    const val = addressInput.value.trim();
    if (!val) {
      autocompleteMenu.classList.add('hidden');
      return;
    }

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}`);
      if (!response.ok) throw new Error("Network response was not ok");
      const data = await response.json();

      autocompleteMenu.innerHTML = '';
      if (data.length === 0) {
        const div = document.createElement('div');
        div.style.padding = '0.5rem';
        div.style.fontSize = '0.8rem';
        div.style.color = '#71717a';
        div.innerText = 'No matching addresses found';
        autocompleteMenu.appendChild(div);
      } else {
        data.forEach(item => {
          const lat = parseFloat(item.lat);
          const lon = parseFloat(item.lon);
          const formattedCoords = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;

          const div = document.createElement('div');
          div.className = 'autocomplete-item';
          div.innerHTML = `
            <span style="font-size:0.9rem; font-weight:500;">${item.display_name}</span>
            <span style="font-size:0.7rem; color:#71717a; font-family:var(--font-mono);">${formattedCoords}</span>
          `;
          div.addEventListener('click', () => {
            addressInput.value = item.display_name;
            if (coordsInput) coordsInput.value = formattedCoords;
            autocompleteMenu.classList.add('hidden');
          });
          autocompleteMenu.appendChild(div);
        });
      }
      autocompleteMenu.classList.remove('hidden');
    } catch (err) {
      console.error("OSM Geocoding fetch failed:", err);
    }
  };

  const debouncedFetch = debounce(fetchSuggestions, 300);

  addressInput.addEventListener('input', debouncedFetch);

  // Hide autocomplete menu when clicking outside
  document.addEventListener('click', (e) => {
    if (e.target !== addressInput && !autocompleteMenu.contains(e.target)) {
      autocompleteMenu.classList.add('hidden');
    }
  });
}

// Coordinate parsing helper
function parseCoords(coordStr) {
  if (!coordStr) return null;
  const decimalRegex = /^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/;
  const matchDecimal = coordStr.match(decimalRegex);
  if (matchDecimal) {
    return {
      lat: parseFloat(matchDecimal[1]),
      lon: parseFloat(matchDecimal[2])
    };
  }

  const degRegex = /(-?\d+\.\d+)\s*°\s*([NESWnesw])\s*,\s*(-?\d+\.\d+)\s*°\s*([NESWnesw])/;
  const matchDeg = coordStr.match(degRegex);
  if (matchDeg) {
    let lat = parseFloat(matchDeg[1]);
    const latDir = matchDeg[2].toUpperCase();
    let lon = parseFloat(matchDeg[3]);
    const lonDir = matchDeg[4].toUpperCase();

    if (latDir === 'S') lat = -lat;
    if (lonDir === 'W') lon = -lon;
    return { lat, lon };
  }
  return null;
}

// Haversine distance formula (in meters)
function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Extract GPS coords from EXIF using exifr library
async function extractGpsFromImages(files) {
  if (typeof exifr === 'undefined') {
    console.error("exifr library not loaded");
    return null;
  }
  for (let file of files) {
    try {
      const gps = await exifr.gps(file);
      if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
        return gps;
      }
    } catch (err) {
      console.warn("EXIF GPS parsing failed for file:", file.name, err);
    }
  }
  return null;
}

// Perform client-side WASM OCR using Tesseract.js on images
async function performOcrOnImages(files, logProgressCb) {
  if (typeof Tesseract === 'undefined') {
    console.error("Tesseract.js library not loaded");
    return "";
  }
  let combinedText = "";
  for (let file of files) {
    try {
      let lastPercent = -20;
      const ret = await Tesseract.recognize(file, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text' && logProgressCb) {
            const percent = Math.floor(m.progress * 10) * 10;
            if (percent >= lastPercent + 20) {
              logProgressCb(percent);
              lastPercent = percent;
            }
          }
        }
      });
      combinedText += " " + ret.data.text;
    } catch (err) {
      console.error("Tesseract OCR failed for file:", file.name, err);
    }
  }
  return combinedText;
}

// Fuzzy match keyword/aliases in OCR text
function fuzzyMatchText(ocrText, targetName, aliases = []) {
  const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  
  const normOcr = normalize(ocrText);
  const normTarget = normalize(targetName);
  const normAliases = aliases.map(a => normalize(a)).filter(Boolean);
  
  if (!normTarget) return false;
  if (normOcr.includes(normTarget)) return true;
  for (let alias of normAliases) {
    if (normOcr.includes(alias)) return true;
  }
  
  // Sliding window Levenshtein check
  const ocrWords = normOcr.split(' ');
  const targetWords = normTarget.split(' ');
  const windowSize = targetWords.length;
  
  const threshold = Math.max(1, Math.floor(normTarget.length * 0.25));
  
  for (let i = 0; i <= ocrWords.length - windowSize; i++) {
    const windowPhrase = ocrWords.slice(i, i + windowSize).join(' ');
    if (getEditDistance(windowPhrase, normTarget) <= threshold) {
      return true;
    }
  }
  
  for (let alias of normAliases) {
    const aliasWords = alias.split(' ');
    const aWindowSize = aliasWords.length;
    const aThreshold = Math.max(1, Math.floor(alias.length * 0.25));
    for (let i = 0; i <= ocrWords.length - aWindowSize; i++) {
      const windowPhrase = ocrWords.slice(i, i + aWindowSize).join(' ');
      if (getEditDistance(windowPhrase, alias) <= aThreshold) {
        return true;
      }
    }
  }
  return false;
}

// ----------------------------------------------------
// 8. Review Submission & Tag Pipeline
// ----------------------------------------------------
function initReviewSubmission() {
  const existingRadio = document.querySelector('input[name="portal-review-node-mode"][value="existing"]');
  const newRadio = document.querySelector('input[name="portal-review-node-mode"][value="new"]');
  
  const targetNodeGroup = document.getElementById('portal-target-node-group');
  const nodeCreatorPanel = document.getElementById('portal-node-creator-panel');

  const gpsCheckbox = document.getElementById('chk-portal-gps');
  const ocrCheckbox = document.getElementById('chk-portal-ocr');
  const mediaGroup = document.getElementById('poe-media-group');
  const uploadInput = document.getElementById('poe-image-upload');
  const previewContainer = document.getElementById('poe-preview-container');
  const poeLogs = document.getElementById('portal-poe-logs');

  if (!existingRadio || !newRadio) return;

  // Toggle Creator View
  const toggleViewMode = (mode) => {
    if (mode === 'new') {
      targetNodeGroup.classList.add('hidden');
      nodeCreatorPanel.classList.remove('hidden');
    } else {
      targetNodeGroup.classList.remove('hidden');
      nodeCreatorPanel.classList.add('hidden');
    }
  };

  existingRadio.addEventListener('change', () => toggleViewMode('existing'));
  newRadio.addEventListener('change', () => toggleViewMode('new'));

  // Toggle Media Group visibility and accept attribute
  const updatePoeMediaVisibility = () => {
    if (gpsCheckbox.checked || ocrCheckbox.checked) {
      mediaGroup.classList.remove('hidden');
      if (gpsCheckbox.checked) {
        uploadInput.setAttribute('accept', 'image/jpeg, image/jpg, image/heic, image/heif');
        if (uploadedFiles && uploadedFiles.length > 0) {
          const allowedExifTypes = ['image/jpeg', 'image/jpg', 'image/heic', 'image/heif'];
          const nonExifFiles = uploadedFiles.filter(f => {
            const ext = f.name.split('.').pop().toLowerCase();
            const isAllowedExt = ['jpeg', 'jpg', 'heic', 'heif'].includes(ext);
            const isAllowedMime = allowedExifTypes.includes(f.type);
            return !isAllowedExt && !isAllowedMime;
          });
          if (nonExifFiles.length > 0) {
            alert("Warning: For GPS proximity verification, formats like .webp, .png, and .gif rarely contain native EXIF GPS data. Please ensure you are uploading original, unedited photos directly from your phone (.JPG or .HEIC).");
          }
        }
      } else {
        uploadInput.setAttribute('accept', 'image/*');
      }
    } else {
      mediaGroup.classList.add('hidden');
      if (uploadInput) {
        uploadInput.value = '';
        uploadInput.setAttribute('accept', 'image/*');
      }
      if (previewContainer) previewContainer.innerHTML = '';
      uploadedFiles = [];
    }
  };

  gpsCheckbox.addEventListener('change', updatePoeMediaVisibility);
  ocrCheckbox.addEventListener('change', updatePoeMediaVisibility);

  // File Upload Preview
  if (uploadInput) {
    uploadInput.addEventListener('change', (e) => {
      previewContainer.innerHTML = '';
      uploadedFiles = Array.from(e.target.files);
      
      const allowedExifTypes = ['image/jpeg', 'image/jpg', 'image/heic', 'image/heif'];
      const nonExifFiles = uploadedFiles.filter(f => {
        const ext = f.name.split('.').pop().toLowerCase();
        const isAllowedExt = ['jpeg', 'jpg', 'heic', 'heif'].includes(ext);
        const isAllowedMime = allowedExifTypes.includes(f.type);
        return !isAllowedExt && !isAllowedMime;
      });

      if (gpsCheckbox.checked && nonExifFiles.length > 0) {
        alert("Warning: For GPS proximity verification, formats like .webp, .png, and .gif rarely contain native EXIF GPS data. Please ensure you are uploading original, unedited photos directly from your phone (.JPG or .HEIC).");
      }

      uploadedFiles.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const wrapper = document.createElement('div');
          wrapper.style.position = 'relative';
          wrapper.style.width = '60px';
          wrapper.style.height = '60px';
          wrapper.style.borderRadius = 'var(--radius-sm)';
          wrapper.style.border = '1px solid var(--border-color)';
          wrapper.style.overflow = 'hidden';
          
          const img = document.createElement('img');
          img.src = event.target.result;
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'cover';
          
          wrapper.appendChild(img);
          previewContainer.appendChild(wrapper);
        };
        reader.readAsDataURL(file);
      });
    });
  }

  // Submission handler
  const btnSubmit = document.getElementById('btn-portal-submit-review');
  if (btnSubmit) {
    btnSubmit.addEventListener('click', () => {
      loadDb();
      if (!currentUser) {
        alert("Authentication Error: You must be logged in to post reviews.");
        return;
      }

      const isNewMode = newRadio.checked;
      const content = document.getElementById('portal-review-text').value.trim();
      const tagsInputVal = document.getElementById('portal-review-tags').value.trim();
      const attachGps = gpsCheckbox.checked;
      const attachOcr = ocrCheckbox.checked;

      if (!content || content.length < 10) {
        alert("Error: Review content must be at least 10 characters long.");
        return;
      }

      let targetNodeId = null;
      let newNodesList = [];

      // 1. Resolve Target Node ID
      if (!isNewMode) {
        const select = document.getElementById('select-portal-target-node');
        targetNodeId = parseInt(select.value);
        if (isNaN(targetNodeId)) {
          alert("Error: Please select an existing space/merchant to review.");
          return;
        }
      } else {
        // Create new node path
        const parentIdSelect = document.getElementById('select-portal-parent-category');
        const parentId = parentIdSelect.value ? parseInt(parentIdSelect.value) : null;
        const newPath = document.getElementById('portal-review-new-path').value.trim();
        const address = document.getElementById('portal-review-new-address').value.trim();
        const coords = document.getElementById('portal-review-new-coords').value.trim();
        const leafNodeType = document.getElementById('select-portal-leaf-type').value;
        const aliasesInput = document.getElementById('portal-review-new-aliases') ? document.getElementById('portal-review-new-aliases').value.trim() : '';
        const aliasesList = aliasesInput ? aliasesInput.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

        if (!newPath) {
          alert("Error: Please provide a new location path name.");
          return;
        }

        // Generate taxonomy nodes recursively
        const pathSegments = newPath.split('/').map(s => s.trim()).filter(Boolean);
        let currentParent = parentId;

        pathSegments.forEach((segment, idx) => {
          const slug = segment.toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 50);
          const isLeaf = idx === pathSegments.length - 1;

          const newNodePayload = {
            name: segment,
            slug: slug,
            node_type: isLeaf ? leafNodeType : 'category',
            aliases: isLeaf ? aliasesList : []
          };

          if (isLeaf) {
            if (address) newNodePayload.address = address;
            if (coords) newNodePayload.coordinates = coords;
          }

          newNodesList.push(newNodePayload);
        });
      }

      // 2. Perform PoE Logs pipeline
      poeLogs.innerHTML = '';
      if (attachGps || attachOcr) {
        poeLogs.classList.remove('hidden');
      } else {
        poeLogs.classList.add('hidden');
      }

      const log = (msg, style = '') => {
        poeLogs.innerHTML += `<div class="log-line ${style}">> ${msg}</div>`;
        poeLogs.scrollTop = poeLogs.scrollHeight;
      };

      let pipeline = [];
      let gpsSuccess = false;
      let ocrSuccess = false;

      if (attachGps) {
        pipeline.push(async (cb) => {
          log("Edge-Worker: Analyzing image EXIF metadata...", "info");
          try {
            const gpsCoords = await extractGpsFromImages(uploadedFiles);
            if (gpsCoords) {
              log(`Edge-Worker: Found EXIF GPS coordinates: ${gpsCoords.latitude.toFixed(6)}, ${gpsCoords.longitude.toFixed(6)}`, "info");
              
              let targetCoordsStr = "";
              if (isNewMode) {
                targetCoordsStr = document.getElementById('portal-review-new-coords').value.trim();
              } else {
                const node = db.nodes.find(n => n.id === targetNodeId);
                targetCoordsStr = node ? (node.coordinates || "") : "";
              }
              
              const targetCoords = parseCoords(targetCoordsStr);
              if (targetCoords) {
                const distance = getHaversineDistance(gpsCoords.latitude, gpsCoords.longitude, targetCoords.lat, targetCoords.lon);
                log(`Edge-Worker: Proximity check - Distance to target is ${distance.toFixed(1)} meters.`, "info");
                if (distance <= 100) {
                  log(`Edge-Worker: Found EXIF GPS. Proximity matches target. (Distance ${distance.toFixed(1)}m)`, "success");
                  gpsSuccess = true;
                } else {
                  log(`Edge-Worker: GPS Mismatch. Proximity check FAILED (Distance ${distance.toFixed(1)}m > 100m).`, "danger");
                }
              } else {
                log("Edge-Worker: Target location lacks valid coordinates. Proximity check FAILED.", "danger");
              }
            } else {
              log("Edge-Worker: Proximity check FAILED. No GPS data found. Ensure you are uploading an original, unedited photo directly from your phone's camera gallery. Downloaded, screenshotted, or web-saved images (like WebP/PNG) have their location data automatically removed.", "danger");
            }
          } catch (err) {
            log(`Edge-Worker: EXIF parsing error: ${err.message}`, "danger");
          }
          cb();
        });
      }

      if (attachOcr) {
        pipeline.push(async (cb) => {
          log("Serverless Worker: Loading WASM Tesseract OCR engine...", "info");
          try {
            if (uploadedFiles.length === 0) {
              log("Serverless Worker: No files uploaded for OCR analysis. Transaction verification FAILED.", "danger");
            } else {
              log("Serverless Worker: Analyzing text from uploaded receipt...", "info");
              const ocrText = await performOcrOnImages(uploadedFiles, (percent) => {
                log(`Serverless Worker: OCR Parsing ${percent}%...`, "info");
              });
              log(`Serverless Worker: OCR Text extracted successfully. Performing keyword matches...`, "info");
              
              let targetName = "";
              let targetAliases = [];
              if (isNewMode) {
                const pathText = document.getElementById('portal-review-new-path').value.trim();
                const pathSegments = pathText.split('/').map(s => s.trim()).filter(Boolean);
                targetName = pathSegments[pathSegments.length - 1] || "";
                const aliasesInput = document.getElementById('portal-review-new-aliases') ? document.getElementById('portal-review-new-aliases').value.trim() : '';
                targetAliases = aliasesInput ? aliasesInput.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
              } else {
                const node = db.nodes.find(n => n.id === targetNodeId);
                targetName = node ? node.name : "";
                targetAliases = node ? (node.aliases || []) : [];
              }
              
              const isOcrMatch = fuzzyMatchText(ocrText, targetName, targetAliases);
              if (isOcrMatch) {
                log(`Serverless Worker: Keyword Match parsed successfully on invoice for "${targetName}".`, "success");
                ocrSuccess = true;
              } else {
                log(`Serverless Worker: OCR Parsing FAILED. No matching keyword/alias found for "${targetName}".`, "danger");
              }
            }
          } catch (err) {
            log(`Serverless Worker: OCR parsing error: ${err.message}`, "danger");
          }
          cb();
        });
      }

      const commitReview = () => {
        log("PoE Pipeline complete. Appending review...", "command");
        
        let isVerified = false;
        let method = null;
        if (attachGps && gpsSuccess) {
          isVerified = true;
          method = 'exif_gps';
        }
        if (attachOcr && ocrSuccess) {
          isVerified = true;
          method = method ? `${method},wasm_ocr` : 'wasm_ocr';
        }

        const newReviewId = '00000000-0000-0000-0000-000000' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
        
        const newReview = {
          id: newReviewId,
          node_id: isNewMode ? null : targetNodeId,
          author_id: currentUser.id,
          raw_content: content,
          is_verified_experience: isVerified,
          verification_method: method,
          created_at: Date.now()
        };

        db.reviews.push(newReview);

        // 3. Process Tags input
        const tagsList = [];
        if (tagsInputVal) {
          const rawTags = tagsInputVal.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
          rawTags.forEach(tagStr => {
            let tag = db.tags.find(t => t.name === tagStr);
            let tagId;
            if (!tag) {
              tagId = Math.floor(Math.random() * 100000000) + 1000000;
              db.tags.push({ id: tagId, name: tagStr });
            } else {
              tagId = tag.id;
            }

            db.review_tags.push({ review_id: newReviewId, tag_id: tagId });
            tagsList.push(tagStr);
          });
        }

        saveDbState();
        runLineageReputationDecay();

        fetch('https://api.inviteonlyreviews.com/api/reviews', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            authKey: sessionStorage.getItem('current_user_key'),
            review: newReview,
            newNodes: newNodesList,
            parentNodeId: isNewMode ? parentIdSelect.value : null,
            tags: tagsList
          })
        }).then(res => {
          if (res.ok) {
            syncLiveReviews();
          } else {
            res.json().then(data => alert("Warning: Review stored locally but failed to sync to ledger: " + (data.error || "Unknown error")));
          }
        }).catch(err => {
          console.error("Failed to sync review post to database:", err);
        });

        setTimeout(() => {
          document.getElementById('portal-review-text').value = '';
          document.getElementById('portal-review-tags').value = '';
          gpsCheckbox.checked = false;
          ocrCheckbox.checked = false;
          mediaGroup.classList.add('hidden');
          if (uploadInput) uploadInput.value = '';
          if (previewContainer) previewContainer.innerHTML = '';
          uploadedFiles = [];
          poeLogs.classList.add('hidden');
          
          if (document.getElementById('portal-review-new-path')) {
            document.getElementById('portal-review-new-path').value = '';
          }
          if (document.getElementById('portal-review-new-aliases')) {
            document.getElementById('portal-review-new-aliases').value = '';
          }
          if (document.getElementById('portal-review-new-address')) {
            document.getElementById('portal-review-new-address').value = '';
          }
          if (document.getElementById('portal-review-new-coords')) {
            document.getElementById('portal-review-new-coords').value = '';
          }

          existingRadio.checked = true;
          existingRadio.dispatchEvent(new Event('change'));

          alert("Success! Your review has been added immutably to the ledger.");
          
          const feedTabBtn = document.querySelector('[data-tab="feed-view"]');
          if (feedTabBtn) feedTabBtn.click();
        }, 400);
      };

      // Run sequential pipeline
      if (pipeline.length > 0) {
        let currentStep = 0;
        const next = () => {
          if (currentStep < pipeline.length) {
            pipeline[currentStep++](next);
          } else {
            commitReview();
          }
        };
        next();
      } else {
        commitReview();
      }
    });
  }
}

// ----------------------------------------------------
// 9. Preferences and Config Initialization
// ----------------------------------------------------
function initPreferences() {
  const chkRevealConsent = document.getElementById('chk-settings-reveal-low');
  
  if (chkRevealConsent) {
    // Load from localStorage
    const consent = localStorage.getItem('reveal_low_quality_consent') === 'true';
    chkRevealConsent.checked = consent;

    chkRevealConsent.addEventListener('change', (e) => {
      localStorage.setItem('reveal_low_quality_consent', e.target.checked ? 'true' : 'false');
      // Instantly trigger re-render of feed reviews to update filters!
      renderFeedReviews();
    });
  }
}

window.deleteNodeFromDirectory = async function(nodeId) {
  if (!confirm("Are you sure you want to permanently delete this directory space, including all sub-spaces and reviews?")) {
    return;
  }

  const userKey = sessionStorage.getItem('current_user_key');
  if (!userKey) {
    alert("Error: You must be logged in to perform this operation.");
    return;
  }

  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/nodes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authKey: userKey,
        nodeId: nodeId
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to delete directory space.');
    }

    alert("Directory space successfully deleted from the ledger.");

    // Update local DB: remove the node and all of its descendants, and all their reviews
    loadDb();
    
    // Find all descendants recursively
    const getDescendants = (id) => {
      let desc = [];
      const children = db.nodes.filter(n => n.parent_id === id);
      children.forEach(c => {
        desc.push(c.id);
        desc = desc.concat(getDescendants(c.id));
      });
      return desc;
    };
    
    const nodeIdsToDelete = [nodeId].concat(getDescendants(nodeId));
    
    // Remove nodes
    db.nodes = db.nodes.filter(n => !nodeIdsToDelete.includes(n.id));
    
    // Remove reviews for those nodes
    db.reviews = db.reviews.filter(r => !nodeIdsToDelete.includes(r.node_id));
    
    saveDbState();

    // Reset current directory view if it was inside or equal to the deleted node
    const isDeleted = currentDirectoryPath.some(n => nodeIdsToDelete.includes(n.id));
    if (isDeleted) {
      currentDirectoryPath = [];
    }
    
    renderDirectoryExplorer();

  } catch (err) {
    alert("Error: " + err.message);
  }
};

window.mergeNodeInDirectory = async function(nodeId) {
  const targetIdStr = prompt("Enter the ID of the canonical target category/merchant to merge this space into:");
  if (targetIdStr === null) return;
  const targetId = parseInt(targetIdStr.trim());
  if (isNaN(targetId)) {
    alert("Error: Target ID must be a number.");
    return;
  }

  if (nodeId === targetId) {
    alert("Error: Cannot merge a space into itself.");
    return;
  }

  const userKey = sessionStorage.getItem('current_user_key');
  if (!userKey) {
    alert("Error: You must be logged in to perform this operation.");
    return;
  }

  if (!confirm(`Are you sure you want to merge space #${nodeId} into space #${targetId}? All child spaces and reviews will be moved.`)) {
    return;
  }

  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/admin/merge-nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authKey: userKey,
        sourceNodeId: nodeId,
        targetNodeId: targetId
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to merge directory spaces.');
    }

    alert("Directory spaces successfully merged on the ledger!");

    // Clear local storage / trigger complete sync to pull down updated paths and relationships
    localStorage.removeItem('review_network_db');
    loadDb();
    await syncLiveReviews();
    await syncLiveProfiles();
    
    // Reset path back to root since structure changed
    currentDirectoryPath = [];
    renderDirectoryExplorer();

  } catch (err) {
    alert("Error: " + err.message);
  }
};

// ----------------------------------------------------
// 10. Initialization & Listeners Setup
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  loadDb();
  const sessionKey = sessionStorage.getItem('current_user_key');
  const userExists = sessionKey ? db.profiles.find(p => p.access_key === sessionKey && p.is_active) : null;
  if (!sessionKey || !userExists) {
    window.location.href = 'profile.html';
    return;
  }
  syncCurrentUser();
  initTabNavigation();
  initDropdownTypeaheadFilter();
  initReviewSubmission();
  initPreferences();

  // Sync live profiles and reviews exactly once on load
  syncLiveProfiles();
  syncLiveReviews();

  // Search input real-time query
  const searchInput = document.getElementById('feed-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderFeedReviews();
    });
  }

  // Users Search input real-time query
  const usersSearchInput = document.getElementById('users-search-input');
  if (usersSearchInput) {
    usersSearchInput.addEventListener('input', () => {
      renderUsersSearchList();
    });
  }

  // Sorting query selector
  const sortSelect = document.getElementById('feed-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      renderFeedReviews();
    });
  }

  // Clear tag filter button
  const clearFilterBtn = document.getElementById('btn-clear-tag-filter');
  if (clearFilterBtn) {
    clearFilterBtn.addEventListener('click', () => {
      activeTagFilter = null;
      document.getElementById('active-tag-indicator').classList.add('hidden');
      renderFeedReviews();
    });
  }

  // Initial tab loading renders Feed
  renderFeedReviews();

  // Multi-tab ledger state synchronization listener
  window.addEventListener('storage', (e) => {
    if (e.key === 'review_network_db') {
      loadDb();
      syncCurrentUser();
      
      // Update UI feeds
      const activeTab = document.querySelector('.nav-tab-btn.active')?.getAttribute('data-tab');
      if (activeTab === 'feed-view') {
        renderFeedReviews();
      } else if (activeTab === 'browse-view') {
        renderDirectoryExplorer();
      } else if (activeTab === 'users-view') {
        renderUsersSearch();
      }
    }
  });
});
