// services.js - Shared database, state management, security helpers, and Edge API synchronization logic

// ----------------------------------------------------
// Global State Declarations (Bound to Window for page-wide global sharing)
// ----------------------------------------------------
window.db = undefined;
let _currentUser = null;
Object.defineProperty(window, 'currentUser', {
  get() {
    return _currentUser;
  },
  set(val) {
    _currentUser = val;
    if (typeof window.syncSidebarFooter === 'function') {
      window.syncSidebarFooter();
    }
  },
  configurable: true,
  enumerable: true
});

window.syncSidebarFooter = function() {
  const userDot = document.querySelector('.user-status-dot');
  const userLabel = document.querySelector('.username-display');
  
  if (window.currentUser && window.currentUser.is_active) {
    if (userDot) {
      userDot.className = 'user-status-dot online';
    }
    if (userLabel) {
      userLabel.innerText = '@' + window.currentUser.username;
    }
  } else {
    if (userDot) {
      userDot.className = 'user-status-dot offline';
    }
    if (userLabel) {
      const isIndexPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
      userLabel.innerText = isIndexPage ? 'Guest (Sign In)' : 'Guest';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.syncSidebarFooter();
});

// Initialize background worker for CPU-heavy tasks (shared across all pages)
const appWorker = new Worker('worker.js');
let workerCallId = 0;
const workerPromises = {};

appWorker.onmessage = function(e) {
  const { id, result, error } = e.data;
  if (workerPromises[id]) {
    if (error) {
      workerPromises[id].reject(new Error(error));
    } else {
      workerPromises[id].resolve(result);
    }
    delete workerPromises[id];
  }
};

window.runWorkerTask = function(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++workerCallId;
    workerPromises[id] = { resolve, reject };
    appWorker.postMessage({ id, type, payload });
  });
};

// ----------------------------------------------------
// IndexedDB promise-based wrappers (avoids external dependency bloat)
// ----------------------------------------------------
const DB_NAME = 'inviteonly_db';
const STORE_NAME = 'network_state';

function getIDBStore(mode) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      resolve(store);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

window.idbGet = async function(key) {
  const store = await getIDBStore('readonly');
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

window.idbSet = async function(key, value) {
  const store = await getIDBStore('readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

window.idbRemove = async function(key) {
  const store = await getIDBStore('readwrite');
  return new Promise((resolve, reject) => {
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// ----------------------------------------------------
// Global Preferences & Follows Cache
// ----------------------------------------------------
window.settings = {
  lineageAlpha: 0.25,
  revealLowQualityConsent: false
};

window.loadSettings = async function() {
  try {
    const stored = await window.idbGet('review_network_settings');
    if (stored) {
      window.settings = { ...window.settings, ...stored };
    }
  } catch (e) {
    console.error("Failed to load settings from IndexedDB:", e);
  }
  return window.settings;
};

window.saveSettings = async function(updated) {
  window.settings = { ...window.settings, ...updated };
  try {
    await window.idbSet('review_network_settings', window.settings);
  } catch (e) {
    console.error("Failed to save settings to IndexedDB:", e);
  }
};

window.follows = [];

window.loadFollows = async function() {
  try {
    const stored = await window.idbGet('review_network_follows');
    window.follows = stored || [];
  } catch (e) {
    console.error("Failed to load follows from IndexedDB:", e);
    window.follows = [];
  }
  return window.follows;
};

window.saveFollows = async function(follows) {
  window.follows = follows;
  try {
    await window.idbSet('review_network_follows', follows);
  } catch (e) {
    console.error("Failed to save follows to IndexedDB:", e);
  }
};

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
    review_history: [],
    comments: [],
    tags: [
      { id: 1, name: 'third wave coffee shop' },
      { id: 2, name: 'fishing' },
      { id: 3, name: 'EDC gear' },
      { id: 4, name: 'outdoor recreation' }
    ],
    review_tags: []
  };
};

window.loadDb = async function(force = false) {
  if (window.db && !force) {
    // Sync current user references
    if (window.currentUser) {
      window.currentUser = window.db.profiles.find(p => p.id === window.currentUser.id && p.is_active);
    }
    return;
  }

  let parsed = null;
  try {
    parsed = await window.idbGet('review_network_db');
  } catch (e) {
    console.error("IndexedDB read error:", e);
  }

  if (parsed && parsed.version !== 2) {
    parsed = null;
    try {
      await window.idbRemove('review_network_db');
    } catch (e) {
      console.error("Failed to remove invalid db version:", e);
    }
  }

  const seed = window.getSeedData();
  if (!parsed || !parsed.profiles || !parsed.nodes || !parsed.invite_tokens || !parsed.reviews || !parsed.vouches_disputes) {
    window.db = seed;
    try {
      await window.idbSet('review_network_db', window.db);
    } catch (e) {
      console.error("Failed to seed IndexedDB:", e);
    }
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
      await window.saveDbState();
    }
  }
  
  const wasChanged = window.checkSuspensions();
  if (wasChanged) {
    await window.saveDbState();
  }

  // Update current user references
  if (window.currentUser) {
    window.currentUser = window.db.profiles.find(p => p.id === window.currentUser.id && p.is_active);
  }
};

window.saveDbState = async function() {
  if (!window.db) return;
  try {
    await window.idbSet('review_network_db', window.db);
  } catch (e) {
    console.error("IndexedDB write error:", e);
  }
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
window.syncLiveReviews = async function(limit = null, offset = null) {
  try {
    let url = 'https://api.inviteonlyreviews.com/api/reviews';
    const params = [];
    if (limit !== null) params.push(`limit=${limit}`);
    if (offset !== null) params.push(`offset=${offset}`);
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const response = await fetch(url, { credentials: 'include' });
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
          
          // Only prune if we fetched a full unpaginated sync
          if (limit === null && offset === null) {
            const liveIds = result.reviews.map(r => r.id);
            window.db.reviews = window.db.reviews.filter(r => r.id.startsWith('local_') || liveIds.includes(r.id));
          }
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
          if (limit === null && offset === null) {
            const liveTagIds = result.tags.map(t => t.id);
            window.db.tags = window.db.tags.filter(t => liveTagIds.includes(t.id));
          }
        }

        // Merge review_tags
        if (result.review_tags) {
          if (limit === null && offset === null) {
            window.db.review_tags = result.review_tags;
          } else {
            // Append or update tags locally
            result.review_tags.forEach(rt => {
              const exists = window.db.review_tags.some(localRt => localRt.review_id === rt.review_id && localRt.tag_id === rt.tag_id);
              if (!exists) {
                window.db.review_tags.push(rt);
              }
            });
          }
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
          if (limit === null && offset === null) {
            const liveNodeIds = result.nodes.map(n => n.id);
            window.db.nodes = window.db.nodes.filter(n => liveNodeIds.includes(n.id));
          }
        }

        // Merge vouches_disputes
        if (result.vouches_disputes) {
          const parsedVouches = result.vouches_disputes.map(v => ({
            id: v.id,
            review_id: v.review_id,
            user_id: v.user_id,
            type: v.type,
            allocated_weight: parseFloat(v.allocated_weight)
          }));
          if (limit === null && offset === null) {
            window.db.vouches_disputes = parsedVouches;
          } else {
            // Merge vouches
            parsedVouches.forEach(v => {
              const idx = window.db.vouches_disputes.findIndex(localV => localV.id === v.id);
              if (idx > -1) {
                window.db.vouches_disputes[idx] = v;
              } else {
                window.db.vouches_disputes.push(v);
              }
            });
          }
        }

        // Merge review_history
        if (result.review_history) {
          if (limit === null && offset === null) {
            window.db.review_history = result.review_history;
          } else {
            if (!window.db.review_history) window.db.review_history = [];
            result.review_history.forEach(h => {
              const idx = window.db.review_history.findIndex(localH => localH.id === h.id);
              if (idx > -1) {
                window.db.review_history[idx] = h;
              } else {
                window.db.review_history.push(h);
              }
            });
          }
        }

        // Merge comments
        if (result.comments) {
          if (limit === null && offset === null) {
            window.db.comments = result.comments;
          } else {
            if (!window.db.comments) window.db.comments = [];
            result.comments.forEach(c => {
              const idx = window.db.comments.findIndex(localC => localC.id === c.id);
              if (idx > -1) {
                window.db.comments[idx] = c;
              } else {
                window.db.comments.push(c);
              }
            });
          }
        }

        await window.saveDbState();

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
    const response = await fetch('https://api.inviteonlyreviews.com/api/profiles', { credentials: 'include' });
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

        await window.saveDbState();
        
        // Update currentUser reference
        if (window.currentUser) {
          window.currentUser = window.db.profiles.find(p => p.id === window.currentUser.id && p.is_active);
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
  if (window.settings && typeof window.settings.lineageAlpha === 'number') {
    return window.settings.lineageAlpha;
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

window.getEditDistance = function(a, b) {
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
};

window.parseCoords = function(coordStr) {
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
};

window.getHaversineDistance = function(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

window.findNormalizedNode = async function(parentId, name) {
  if (!name) return null;
  const searchName = name.trim().toLowerCase();
  
  // Find children under parentId
  const siblings = window.db.nodes.filter(n => n.parent_id === parentId);
  
  // 1. Exact or case-insensitive match
  let matched = siblings.find(n => n.name.trim().toLowerCase() === searchName);
  if (matched) return matched;
  
  // 2. Sibling aliases match
  matched = siblings.find(n => {
    if (n.aliases && Array.isArray(n.aliases)) {
      return n.aliases.some(alias => String(alias).trim().toLowerCase() === searchName);
    }
    return false;
  });
  if (matched) return matched;
  
  // 3. Fuzzy Levenshtein match (distance <= 2)
  for (const n of siblings) {
    try {
      const dist = await window.runWorkerTask('getEditDistance', { a: n.name.trim().toLowerCase(), b: searchName });
      if (dist <= 2) return n;
    } catch (e) {
      console.error("Worker error during fuzzy match:", e);
      // Fallback to sync calculation in case worker fails or is not initialized
      if (window.getEditDistance(n.name.trim().toLowerCase(), searchName) <= 2) {
        return n;
      }
    }
  }
  return null;
};


window.checkSpatialDeduplication = async function(coordsStr) {
  if (!coordsStr) return null;
  const userCoords = window.parseCoords(coordsStr);
  if (!userCoords) return null;
  
  // Leaf nodes have node_type !== 'planet', 'country', 'state', 'city', 'category'
  const nonLeafTypes = ['planet', 'country', 'state', 'city', 'category'];
  const leafNodes = window.db.nodes.filter(n => !nonLeafTypes.includes(n.node_type) && n.coordinates);
  
  for (const node of leafNodes) {
    const nodeCoords = window.parseCoords(node.coordinates);
    if (!nodeCoords) continue;
    
    const distance = window.getHaversineDistance(userCoords.lat, userCoords.lon, nodeCoords.lat, nodeCoords.lon);
    if (distance <= 50) {
      const choice = await window.showConfirm(
        `A location named "${node.name}" already exists near these coordinates (${Math.round(distance)} meters away). Would you like to attach your review to this existing location instead?`,
        "Location Already Exists Nearby"
      );
      if (choice) {
        return node.id;
      }
    }
  }
  return null;
};

window.editReviewInline = function(reviewId) {
  const cardContainer = document.querySelector(`[data-review-id="${reviewId}"]`);
  if (!cardContainer) return;
  const bodyTextEl = cardContainer.querySelector('.post-body-text') || cardContainer.querySelector('.review-content');
  if (!bodyTextEl) return;
  
  // If already editing, do nothing
  if (cardContainer.querySelector('.edit-review-textarea')) return;

  const review = window.db.reviews.find(r => r.id === reviewId);
  if (!review) return;
  const rawContent = review.raw_content;

  const textarea = document.createElement('textarea');
  textarea.className = 'edit-review-textarea';
  textarea.value = rawContent;
  textarea.style.width = '100%';
  textarea.style.minHeight = '100px';
  textarea.style.background = 'rgba(0,0,0,0.3)';
  textarea.style.border = '1px solid var(--border-color)';
  textarea.style.borderRadius = 'var(--radius-sm)';
  textarea.style.color = '#fff';
  textarea.style.padding = '0.5rem';
  textarea.style.marginTop = '0.5rem';
  textarea.style.fontFamily = 'inherit';
  textarea.style.fontSize = '0.9rem';

  const actionsDiv = document.createElement('div');
  actionsDiv.style.display = 'flex';
  actionsDiv.style.gap = '0.5rem';
  actionsDiv.style.marginTop = '0.5rem';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.innerText = 'Save';
  saveBtn.style.padding = '0.2rem 0.6rem';
  saveBtn.style.fontSize = '0.75rem';
  saveBtn.style.width = 'auto';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.innerText = 'Cancel';
  cancelBtn.style.padding = '0.2rem 0.6rem';
  cancelBtn.style.fontSize = '0.75rem';
  cancelBtn.style.width = 'auto';

  actionsDiv.appendChild(saveBtn);
  actionsDiv.appendChild(cancelBtn);

  bodyTextEl.style.display = 'none';
  bodyTextEl.parentNode.insertBefore(textarea, bodyTextEl.nextSibling);
  textarea.parentNode.insertBefore(actionsDiv, textarea.nextSibling);

  cancelBtn.addEventListener('click', () => {
    textarea.remove();
    actionsDiv.remove();
    bodyTextEl.style.display = 'block';
  });

  saveBtn.addEventListener('click', async () => {
    const newContent = textarea.value.trim();
    if (!newContent) {
      alert("Review content cannot be empty.");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerText = 'Saving...';
    cancelBtn.disabled = true;

    try {
      const response = await fetch('https://api.inviteonlyreviews.com/api/reviews/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reviewId, newContent })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          // Update local db
          review.raw_content = newContent;
          if (!window.db.review_history) window.db.review_history = [];
          window.db.review_history.push({
            id: 'local_hist_' + Date.now(),
            review_id: reviewId,
            old_content: rawContent,
            changed_at: new Date().toISOString()
          });
          await window.saveDbState();

          // Refresh view
          if (typeof window.renderFeedReviews === 'function') window.renderFeedReviews();
          if (typeof window.renderMyReviewsFeed === 'function') window.renderMyReviewsFeed();
        } else {
          alert("Error: " + (result.error || "Failed to save edits."));
          saveBtn.disabled = false;
          saveBtn.innerText = 'Save';
          cancelBtn.disabled = false;
        }
      } else {
        const result = await response.json().catch(() => ({}));
        alert("Error: " + (result.error || "Failed to save edits."));
        saveBtn.disabled = false;
        saveBtn.innerText = 'Save';
        cancelBtn.disabled = false;
      }
    } catch (err) {
      console.error(err);
      alert("Network error: Failed to connect to server.");
      saveBtn.disabled = false;
      saveBtn.innerText = 'Save';
      cancelBtn.disabled = false;
    }
  });
};

window.viewReviewHistory = function(reviewId) {
  const history = window.db.review_history ? window.db.review_history.filter(h => h.review_id === reviewId) : [];
  if (history.length === 0) return;
  // Sort history by changed_at DESC
  history.sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));

  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.background = 'rgba(0,0,0,0.85)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '99999';

  const modal = document.createElement('div');
  modal.className = 'confirm-modal';
  modal.style.maxWidth = '550px';
  modal.style.width = '90%';
  modal.style.maxHeight = '80vh';
  modal.style.overflowY = 'auto';

  const titleEl = document.createElement('div');
  titleEl.className = 'confirm-modal-title';
  titleEl.innerText = '🕒 Edit History';

  const listContainer = document.createElement('div');
  listContainer.className = 'confirm-modal-body';
  listContainer.style.display = 'flex';
  listContainer.style.flexDirection = 'column';
  listContainer.style.gap = '1.25rem';
  listContainer.style.maxHeight = '50vh';
  listContainer.style.overflowY = 'auto';

  history.forEach((h, idx) => {
    const item = document.createElement('div');
    item.style.paddingBottom = '1rem';
    if (idx < history.length - 1) {
      item.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
    }
    
    const timeEl = document.createElement('div');
    timeEl.style.fontSize = '0.75rem';
    timeEl.style.color = 'var(--color-primary)';
    timeEl.style.marginBottom = '0.5rem';
    timeEl.innerText = `Version from ${new Date(h.changed_at).toLocaleString()}`;
    
    const contentEl = document.createElement('p');
    contentEl.style.fontSize = '0.85rem';
    contentEl.style.color = '#e4e4e7';
    contentEl.style.margin = '0';
    contentEl.style.whiteSpace = 'pre-wrap';
    contentEl.innerText = h.old_content;

    item.appendChild(timeEl);
    item.appendChild(contentEl);
    listContainer.appendChild(item);
  });

  const buttonsDiv = document.createElement('div');
  buttonsDiv.className = 'confirm-modal-buttons';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn';
  closeBtn.innerText = 'Close';
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
  });

  buttonsDiv.appendChild(closeBtn);

  modal.appendChild(titleEl);
  modal.appendChild(listContainer);
  modal.appendChild(buttonsDiv);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
};

window.postComment = async function(reviewId, event) {
  event.preventDefault();
  const form = event.target;
  const input = form.querySelector('input');
  if (!input) return;
  const content = input.value.trim();
  if (!content) return;

  const btn = form.querySelector('button');
  if (btn) btn.disabled = true;

  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ reviewId, content })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        // Add locally
        if (!window.db.comments) window.db.comments = [];
        window.db.comments.push({
          id: 'local_c_' + Date.now(),
          author_id: window.currentUser.id,
          review_id: reviewId,
          content: content,
          created_at: new Date().toISOString()
        });
        await window.saveDbState();

        // Refresh views
        if (typeof window.renderFeedReviews === 'function') window.renderFeedReviews();
        if (typeof window.renderMyReviewsFeed === 'function') window.renderMyReviewsFeed();
      } else {
        alert("Error: " + (result.error || "Failed to post comment."));
      }
    } else {
      const result = await response.json().catch(() => ({}));
      alert("Error: " + (result.error || "Failed to post comment."));
    }
  } catch (err) {
    console.error(err);
    alert("Network error: Failed to connect to server.");
  } finally {
    if (btn) btn.disabled = false;
  }
};
