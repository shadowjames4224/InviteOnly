// profile.js - Consumer Profile Dashboard Logic
// Handles credentials login, review submission, invite limits, and cross-client storage sync.

function showAccessKeyModal(title, message, key) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '9999';

  const modal = document.createElement('div');
  modal.style.background = 'var(--bg-card)';
  modal.style.padding = '2rem';
  modal.style.borderRadius = 'var(--radius-md)';
  modal.style.border = '1px solid var(--border-color)';
  modal.style.maxWidth = '450px';
  modal.style.width = '90%';
  modal.style.textAlign = 'center';
  modal.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';

  const titleEl = document.createElement('h3');
  titleEl.innerText = title;
  titleEl.style.marginTop = '0';
  titleEl.style.color = 'var(--color-success)';

  const msgEl = document.createElement('p');
  msgEl.innerText = message;
  msgEl.style.fontSize = '0.9rem';
  msgEl.style.color = 'var(--color-text-muted)';
  msgEl.style.marginBottom = '1.5rem';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.value = key;
  keyInput.readOnly = true;
  keyInput.style.width = '100%';
  keyInput.style.padding = '0.75rem';
  keyInput.style.background = 'rgba(0,0,0,0.3)';
  keyInput.style.border = '1px solid var(--border-color)';
  keyInput.style.color = 'var(--color-text-main)';
  keyInput.style.borderRadius = 'var(--radius-sm)';
  keyInput.style.marginBottom = '1rem';
  keyInput.style.textAlign = 'center';
  keyInput.style.fontFamily = 'var(--font-mono)';
  
  const copyBtn = document.createElement('button');
  copyBtn.innerText = 'Copy to Clipboard';
  copyBtn.className = 'btn btn-primary btn-full';
  copyBtn.style.marginBottom = '0.75rem';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(key).then(() => {
      copyBtn.innerText = '✓ Copied!';
      setTimeout(() => {
        copyBtn.innerText = 'Copy to Clipboard';
      }, 2000);
    });
  };

  const closeBtn = document.createElement('button');
  closeBtn.innerText = 'I have saved it';
  closeBtn.className = 'btn btn-secondary btn-full';
  closeBtn.onclick = () => {
    document.body.removeChild(overlay);
  };

  modal.appendChild(titleEl);
  modal.appendChild(msgEl);
  modal.appendChild(keyInput);
  modal.appendChild(copyBtn);
  modal.appendChild(closeBtn);
  overlay.appendChild(modal);

  document.body.appendChild(overlay);
}

// db and currentUser are defined globally in services.js
window.loadDbState = window.loadDb;
let profileUploadedFiles = [];

function formatRep(rep) {
  const val = parseFloat(rep);
  return isNaN(val) ? '1.0000' : val.toFixed(4);
}

// getSeedData, loadDbState, and saveDbState are imported/mapped from services.js

// syncLiveReviews and syncLiveProfiles are imported from services.js
window.refreshActiveViews = function() {
  if (currentUser) {
    renderMyReviewsFeed();
    
    // Re-evaluate admin privileges based on synced roles
    const isModerator = currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator';
    const adminPanel = document.getElementById('admin-management-panel');
    if (adminPanel) {
      if (isModerator && adminPanel.classList.contains('hidden')) {
        adminPanel.classList.remove('hidden');
        if (typeof initAdminPanel === 'function') initAdminPanel();
      } else if (!isModerator) {
        adminPanel.classList.add('hidden');
      }
    }

    if (isModerator) {
      if (typeof renderAdminInviteGraph === 'function') renderAdminInviteGraph();
      if (typeof populateAdminManageUserDropdown === 'function') populateAdminManageUserDropdown();
      if (typeof populateAdminInviterDropdown === 'function') populateAdminInviterDropdown();
      if (typeof renderAdminReleasedList === 'function') renderAdminReleasedList();
    }
  }
};

async function updateProfilesOnEdge(updatesList) {
  if (!currentUser) return;
  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/admin/manage-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'update',
        updates: updatesList
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to update profiles on server.');
    }
  } catch (err) {
    console.error("Failed to sync profile updates to edge:", err);
    alert("Warning: Local database updated, but failed to sync changes to Supabase: " + err.message);
  }
}

async function deleteProfileOnEdge(profileId) {
  if (!currentUser) return;
  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/admin/manage-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'delete',
        targetId: profileId
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to delete profile on server.');
    }
  } catch (err) {
    console.error("Failed to sync profile deletion to edge:", err);
    alert("Warning: Local profile deleted, but failed to sync deletion to Supabase: " + err.message);
  }
}

async function createProfileOnEdge(profileData) {
  if (!currentUser) return;
  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/admin/manage-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'create',
        profile: profileData
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to create profile on server.');
    }
  } catch (err) {
    console.error("Failed to sync profile creation to edge:", err);
    alert("Warning: Local profile created, but failed to sync creation to Supabase: " + err.message);
  }
}

function getDbProfilesSnapshot() {
  return db.profiles.map(p => ({
    id: p.id,
    is_active: p.is_active,
    reputation_score: p.reputation_score,
    invited_by: p.invited_by,
    role: p.role,
    released_by: p.released_by,
    originally_invited_by: p.originally_invited_by
  }));
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
// 2. Lineage & Reputation Logic
// ----------------------------------------------------
// areInSameInviteLineage, calculateConsensusTheta, and getLineageAlpha are imported from services.js



// getNodePathString is imported from services.js

// ----------------------------------------------------
// 3. UI Controller & Rendering
// ----------------------------------------------------
function checkAuthentication() {
  if (currentUser && currentUser.is_active) {
    showDashboard();
  } else {
    showLoginGate();
  }
}

function showLoginGate() {
  currentUser = null;
  fetch('https://api.inviteonlyreviews.com/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(e => {});
  document.getElementById('login-gate').classList.remove('hidden');
  document.getElementById('profile-content').classList.add('hidden');
  
  // Hide Dev Sandbox links for guests
  const sandboxLinks = document.querySelectorAll('a[href="sandbox.html"]');
  sandboxLinks.forEach(link => link.classList.add('hidden'));

  // Hide authenticated menu options from guest sidebar
  const authLinks = document.querySelectorAll('.sidebar-nav a[href^="index.html"]');
  authLinks.forEach(link => link.classList.add('hidden'));

  // Update status footer
  if (typeof window.syncSidebarFooter === 'function') {
    window.syncSidebarFooter();
  }
}

function showDashboard() {
  document.getElementById('login-gate').classList.add('hidden');
  document.getElementById('profile-content').classList.remove('hidden');
  
  renderProfileCard();
  renderInviteHub();
  populateMerchantDropdown();
  populateParentNodeDropdown();
  renderMyReviewsFeed();

  // Searchable Dropdowns
  initSearchFirstLocationSelector();
  makeSelectSearchable('review-new-parent-node', 'Type to search parent category/city...');
  makeSelectSearchable('review-new-global-entity', 'Type to search blueprint spec...');
  makeSelectSearchable('review-new-leaf-type', 'Type to search leaf type...');

  // Maps autocomplete
  initAddressVerification();

  // Show/hide Admin Management Console based on whether user is root_moderator or a moderator
  const isModerator = currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator';
  const adminPanel = document.getElementById('admin-management-panel');
  if (adminPanel) {
    if (isModerator) {
      adminPanel.classList.remove('hidden');
      initAdminPanel();
    } else {
      adminPanel.classList.add('hidden');
    }
  }

  // Show authenticated menu options
  const authLinks = document.querySelectorAll('.sidebar-nav a[href^="index.html"]');
  authLinks.forEach(link => link.classList.remove('hidden'));

  // Update status footer
  if (typeof window.syncSidebarFooter === 'function') {
    window.syncSidebarFooter();
  }
}

function renderProfileCard() {
  const usernameEl = document.getElementById('profile-username');
  if (usernameEl) usernameEl.innerText = currentUser.username;
  
  const statusBadge = document.getElementById('profile-status');
  if (statusBadge) {
    statusBadge.innerText = currentUser.is_active ? 'Active' : 'Revoked';
    statusBadge.className = currentUser.is_active ? 'badge privacy-badge' : 'badge count-badge'; // Count badge uses rose/danger color
  }

  const repEl = document.getElementById('profile-rep');
  if (repEl) repEl.innerText = formatRep(currentUser.reputation_score);

  const baseRepEl = document.getElementById('profile-base-rep');
  if (baseRepEl) baseRepEl.innerText = formatRep(currentUser.base_reputation);

  const inviter = db.profiles.find(p => p.id === currentUser.invited_by);
  const invitedByEl = document.getElementById('profile-invited-by');
  if (invitedByEl) {
    invitedByEl.innerText = inviter ? inviter.username : 'Root Network (No inviter)';
  }

  const keyPreviewEl = document.getElementById('profile-key-preview');
  if (keyPreviewEl) {
    const keyLen = currentUser.access_key.length;
    keyPreviewEl.innerText = currentUser.access_key.substr(0, 6) + '...' + currentUser.access_key.substr(keyLen - 4);
  }
}

function renderInviteHub() {
  const isMod = currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator';
  const myPendingTokens = db.invite_tokens.filter(t => t.inviter_id === currentUser.id && !t.is_used);
  const totalGenerated = db.invite_tokens.filter(t => t.inviter_id === currentUser.id).length;

  let remaining = 0;
  let quotaMax = 5;
  if (isMod) {
    quotaMax = 20;
    const releasedCount = db.profiles.filter(p => p.originally_invited_by === currentUser.id && p.released_by === currentUser.id).length;
    const consumed = totalGenerated - releasedCount;
    remaining = Math.max(0, 20 - consumed);
  } else {
    remaining = Math.max(0, 5 - totalGenerated);
  }

  const invitesLeftEl = document.getElementById('invites-left');
  if (invitesLeftEl) {
    invitesLeftEl.innerText = `${remaining} Left`;
    invitesLeftEl.className = remaining > 0 ? 'badge privacy-badge' : 'badge count-badge';
  }

  const btnGen = document.getElementById('btn-generate-profile-token');
  if (btnGen) {
    if (remaining === 0) {
      btnGen.disabled = true;
      btnGen.innerText = `Invite Quota Reached (${quotaMax}/${quotaMax})`;
      btnGen.className = 'btn btn-secondary btn-full';
    } else {
      btnGen.disabled = false;
      btnGen.innerText = 'Generate Invite Token';
      btnGen.className = 'btn btn-primary btn-full';
    }
  }

  const listContainer = document.getElementById('profile-token-list');
  if (listContainer) {
    listContainer.innerHTML = '';

    if (myPendingTokens.length === 0) {
      listContainer.innerHTML = '<div class="details-placeholder" style="text-align:center; padding:1rem 0;">No pending invites.</div>';
    } else {
      myPendingTokens.forEach(t => {
        // Check if token is expired
        let expiredNotice = '';
        if (t.expires_at < Date.now()) {
          expiredNotice = ' (Expired)';
        }

        const html = `
          <div class="token-item-card" style="position: relative; padding-bottom: 2.2rem;">
            <div class="token-code-line">
              <code>${t.rawToken || 'tkn_secret'}</code>
              <span class="token-status unused">Unused${expiredNotice}</span>
            </div>
            <div class="token-hash" style="font-size: 0.65rem; font-family: monospace; color: var(--color-text-dim);">Hash: ${t.token.substring(0, 20)}...</div>
            <div style="position: absolute; right: 8px; bottom: 8px; display: flex; gap: 0.35rem;">
              <button class="btn btn-primary" onclick="copyTokenToClipboard('${t.rawToken}')" style="font-size: 0.68rem; padding: 0.2rem 0.5rem; width: auto; border-radius: var(--radius-sm);">Copy</button>
              <button class="btn btn-danger" onclick="cancelPendingInvite('${t.rawToken}')" style="font-size: 0.68rem; padding: 0.2rem 0.5rem; width: auto; border-radius: var(--radius-sm); background: transparent; border: 1px solid var(--color-danger); color: var(--color-danger);">Cancel</button>
            </div>
          </div>
        `;
        listContainer.innerHTML += html;
      });
    }
  }

  // Populate Redeemed Accounts list
  const redeemedListContainer = document.getElementById('profile-redeemed-list');
  if (redeemedListContainer) {
    redeemedListContainer.innerHTML = '';
    const invitees = db.profiles.filter(p => p.invited_by === currentUser.id);
    
    if (invitees.length === 0) {
      redeemedListContainer.innerHTML = '<div class="details-placeholder" style="text-align:center; padding:1rem 0; font-size: 0.8rem;">No redeemed invites.</div>';
    } else {
      invitees.forEach(invitee => {
        const statusText = invitee.is_active ? 'Active' : 'Suspended';
        
        let actionBtn = '';
        if (invitee.is_active) {
          actionBtn = `<button class="btn btn-danger" onclick="revokeRedeemedUser('${invitee.id}')" style="font-size: 0.68rem; padding: 0.2rem 0.5rem; width: auto; border-radius: var(--radius-sm); background: transparent; border: 1px solid var(--color-danger); color: var(--color-danger); margin-right: 0.35rem;">Revoke</button>`;
          if (isMod) {
            actionBtn += `<button class="btn btn-primary" onclick="releaseUser('${invitee.id}')" style="font-size: 0.68rem; padding: 0.2rem 0.5rem; width: auto; border-radius: var(--radius-sm); background: var(--color-primary); border: none; color: white;">Release</button>`;
          }
        } else {
          actionBtn = `<span style="font-size: 0.72rem; color: var(--color-text-dim); font-weight: 500;">Suspended</span>`;
        }
        
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.padding = '0.5rem 0.75rem';
        item.style.background = 'rgba(255,255,255,0.02)';
        item.style.border = '1px solid var(--border-color)';
        item.style.borderRadius = 'var(--radius-sm)';
        
        item.innerHTML = `
          <div>
            <div style="font-size: 0.85rem; font-weight: 600; color: white;">@${invitee.username}</div>
            <div style="font-size: 0.72rem; color: ${invitee.is_active ? 'var(--color-primary)' : 'var(--color-danger)'};">Status: ${statusText} &bull; Rep: ${formatRep(invitee.reputation_score)}</div>
          </div>
          <div>
            ${actionBtn}
          </div>
        `;
        redeemedListContainer.appendChild(item);
      });
    }
  }
}

window.copyTokenToClipboard = function(tokenStr) {
  navigator.clipboard.writeText(tokenStr);
  alert(`Invite token copied: ${tokenStr}\nProvide this to a friend to let them register!`);
};

window.cancelPendingInvite = async function(rawToken) {
  if (!(await showConfirm("Are you sure you want to cancel this pending invite? It will be invalidated and you will get your invite slot back.", "Cancel Pending Invite"))) {
    return;
  }
  
  db.invite_tokens = db.invite_tokens.filter(t => t.rawToken !== rawToken);
  saveDbState();
  renderInviteHub();
  window.dispatchEvent(new Event('storage'));
  alert("Pending invite successfully cancelled.");
};

window.revokeRedeemedUser = async function(inviteeId) {
  const invitee = db.profiles.find(p => p.id === inviteeId);
  if (!invitee) return;
  
  if (!(await showConfirm(`Are you sure you want to revoke the invite for @${invitee.username}? This will suspend their profile and cascade-revoke all accounts in their downstream lineage.`, "Revoke Invited User"))) {
    return;
  }
  
  const snapshot = getDbProfilesSnapshot();
  
  let revokedList = [];
  const gatherDescendants = (id) => {
    let children = db.profiles.filter(p => p.invited_by === id && p.is_active);
    children.forEach(c => {
      revokedList.push(c);
      gatherDescendants(c.id);
    });
  };

  revokedList.push(invitee);
  gatherDescendants(invitee.id);

  revokedList.forEach(p => {
    p.is_active = false;
    p.reputation_score = 0.0000;
  });

  saveDbState();
  
  // Sync cascading updates to Supabase

  // Refresh UI
  renderInviteHub();
  renderProfileCard();
  renderMyReviewsFeed();
  if (selectedAdminProfileId) {
    selectAdminProfile(selectedAdminProfileId);
  }
  
  alert(`Successfully revoked @${invitee.username} and cascade-revoked ${revokedList.length - 1} downstream profiles.`);
};

window.releaseUser = async function(targetId) {
  const target = db.profiles.find(p => p.id === targetId);
  if (!target) return;

  if (!(await showConfirm(`Are you sure you want to release @${target.username} to a standalone account? This will detach them from your hierarchical tree (preventing cascade revocation) and free up 1 slot in your invite quota.`, "Release User"))) {
    return;
  }

  if (!currentUser) return;
  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/admin/release-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        targetId: targetId
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to release user on Cloudflare Worker.');
    }

    // Success! Update local db state and sync
    alert(`Successfully released @${target.username} to a standalone account.`);
    
    // Update local state temporarily
    target.originally_invited_by = currentUser.id;
    target.released_by = currentUser.id;
    target.invited_by = null;
    saveDbState();
    
    // Sync and render
    await syncLiveProfiles();
    renderInviteHub();
  } catch (e) {
    console.error("Error releasing user:", e);
    alert(`Error releasing user: ${e.message}`);
  }
};

function populateMerchantDropdown() {
  const selectNode = document.getElementById('review-target-node');
  if (!selectNode) return;
  selectNode.innerHTML = '';

  // Sort nodes by path to keep structure logical
  const sortedNodes = [...db.nodes].sort((a, b) => a.path.localeCompare(b.path));
  sortedNodes.forEach(m => {
    const option = document.createElement('option');
    option.value = m.id;
    const typeLabel = m.node_type.toUpperCase().replace('_', ' ');
    let extraLoc = '';
    if (m.address) extraLoc += ` | Address: ${m.address}`;
    if (m.coordinates) extraLoc += ` | GPS: ${m.coordinates}`;
    option.innerText = `[${typeLabel}] ${getNodePathString(m)}${extraLoc}`;
    selectNode.appendChild(option);
  });
  selectNode.dispatchEvent(new Event('change'));
}

function populateParentNodeDropdown() {
  const selectParent = document.getElementById('review-new-parent-node');
  if (!selectParent) return;
  selectParent.innerHTML = '';

  // Sort nodes by path to keep structure logical
  const sortedNodes = [...db.nodes].sort((a, b) => a.path.localeCompare(b.path));
  sortedNodes.forEach(n => {
    const option = document.createElement('option');
    option.value = n.id;
    option.innerText = `${getNodePathString(n)} (${n.node_type})`;
    selectParent.appendChild(option);
  });
  selectParent.dispatchEvent(new Event('change'));
}

// ----------------------------------------------------
// Governance Voting Helpers (mirrored from index.js)
// ----------------------------------------------------

// checkLineageCollusion, calculateReviewConsensus, and runLineageReputationDecay are imported/mapped from services.js

// Global vote function exposed on the window so review card onclick attributes work
window.castFeedVote = async function(reviewId, type) {
  await loadDbState();
  if (!currentUser) {
    alert("Authentication Required: You must enter your Access Key to cast vouches or disputes.");
    return;
  }

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

  await saveDbState();

  // Re-run reputation contagion calculations
  runLineageReputationDecay();

  // Optimistically update the profile feed immediately
  renderMyReviewsFeed();

  // Sync vouch to database in background (fire-and-forget, no re-fetch)
  fetch('https://api.inviteonlyreviews.com/api/vouch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({
      reviewId: reviewId,
      type: type,
      allocatedWeight: allocatedWeight
    })
  }).catch(err => {
    console.error("Failed to sync vouch:", err);
  });
};

function renderMyReviewsFeed() {
  const feed = document.getElementById('profile-reviews-feed');
  feed.innerHTML = '';

  const myReviews = db.reviews.filter(r => r.author_id === currentUser.id);
  document.getElementById('my-reviews-count').innerText = `${myReviews.length} Reviews`;

  if (myReviews.length === 0) {
    feed.innerHTML = '<div class="details-placeholder" style="line-height:80px; text-align:center;">You have not posted any reviews yet. Submit one using the form above!</div>';
    return;
  }

  // Sort: date DESC
  myReviews.sort((a, b) => b.created_at - a.created_at);

  const fragment = document.createDocumentFragment();
  myReviews.forEach(r => {
    const node = db.nodes.find(n => n.id === r.node_id);
    const { theta, wv, wd } = calculateConsensusTheta(r.id);

    let cardClass = 'vouch-heavy';
    let disputeNotice = '';

    if (theta >= 0.70) {
      cardClass = 'vouch-heavy';
    } else if (theta >= 0.40 && theta < 0.70) {
      cardClass = 'disputed-mid';
      disputeNotice = `<div class="dispute-notice" style="margin-top: 0.5rem;">⚠️ Disputed content - opacity reduced by 50% in public explorer.</div>`;
    } else {
      cardClass = 'disputed-heavy';
      disputeNotice = `<div class="dispute-notice-heavy" style="margin-top: 0.5rem;">🚫 Heavily Disputed. Blurred and hidden in public explorer.</div>`;
    }

    // Find voters who vouched or disputed
    const votes = db.vouches_disputes.filter(v => v.review_id === r.id);
    let votesHTML = '';
    if (votes.length > 0) {
      const voteStrings = votes.map(v => {
        const voter = db.profiles.find(p => p.id === v.user_id);
        const name = voter ? voter.username : 'unknown';
        const symbol = v.type === 'vouch' ? '👍' : '👎';
        return `@${sanitizeHTML(name)} ${symbol}`;
      });
      votesHTML = `<div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.5rem; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 0.5rem;"><strong>Governance Votes:</strong> ${voteStrings.join(', ')}</div>`;
    }

    let locHTML = '';
    if (node && (node.address || node.coordinates)) {
      let parts = [];
      if (node.address) parts.push(`📍 Address: ${sanitizeHTML(node.address)}`);
      if (node.coordinates) parts.push(`🌐 GPS: ${sanitizeHTML(node.coordinates)}`);
      locHTML = `<div style="font-size: 0.75rem; color: var(--color-success); margin-top: 0.25rem; font-weight: 500;">${parts.join(' | ')}</div>`;
    }

    // Parameters line
    let parametersLine = '';
    const inst = db.execution_instances.find(ei => ei.id === r.execution_instance_id);
    const ge = inst ? db.global_entities.find(g => g.id === inst.global_entity_id) : null;
    
    if (ge) {
      if (ge.id === 'ge_macchiato' && r.param_val_1) {
        parametersLine = `<div class="review-parameters" style="font-size:0.8rem; font-family:monospace; margin-top:0.25rem; color:#a1a1aa;">☕ Espresso Weight: ${r.param_val_1}g | Layering: ${r.param_val_2}</div>`;
      } else if (ge.id === 'ge_gpu_x' && r.param_val_1) {
        parametersLine = `<div class="review-parameters" style="font-size:0.8rem; font-family:monospace; margin-top:0.25rem; color:#a1a1aa;">🔌 Thermal: ${r.param_val_1}°C | Clock: ${r.param_val_2}GHz | Voltage: ${r.param_val_3}V</div>`;
      } else if (ge.id === 'ge_fishing_pool' && r.param_val_1) {
        parametersLine = `<div class="review-parameters" style="font-size:0.8rem; font-family:monospace; margin-top:0.25rem; color:#a1a1aa;">🎣 Flow Rate: ${r.param_val_1} cfs | Water Temp: ${r.param_val_2}°C</div>`;
      }
    }

    // Verification badge
    let poeBadge = '';
    if (r.is_verified_experience) {
      let badgeLabel = '✓ PoE Verified';
      if (r.verification_method === 'exif_gps') badgeLabel = '📍 GPS Geofenced';
      if (r.verification_method === 'wasm_ocr') badgeLabel = '🧾 WASM Receipt OCR';
      if (r.verification_method === 'secure_enclave') badgeLabel = '🔒 Enclave Signature';
      poeBadge = `<span class="review-badge poe-verified">${badgeLabel}</span>`;
    }

    // Edit button HTML - since it's "my reviews", currentUser is definitely the author
    const editBtnHtml = `<button class="btn-edit-review" onclick="editReviewInline('${r.id}')" style="background: transparent; border: none; color: var(--color-primary); cursor: pointer; font-size: 0.8rem; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px; border: 1px solid rgba(16, 185, 129, 0.2); background: rgba(16, 185, 129, 0.05); margin-right: 0.25rem;" onmouseenter="this.style.background='rgba(16, 185, 129, 0.15)'" onmouseleave="this.style.background='rgba(16, 185, 129, 0.05)'">✏️ Edit</button>`;

    // Changelog button HTML
    let changelogBtnHtml = '';
    const history = window.db.review_history ? window.db.review_history.filter(h => h.review_id === r.id) : [];
    if (history.length > 0) {
      changelogBtnHtml = `<div style="margin-top: 0.5rem;"><button onclick="viewReviewHistory('${r.id}')" style="background: transparent; border: none; color: #a1a1aa; cursor: pointer; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px; border: 1px solid rgba(255,255,255,0.15); transition: background 0.2s;" onmouseenter="this.style.background='rgba(255,255,255,0.05)'" onmouseleave="this.style.background='transparent'">🕒 View Edit History (${history.length})</button></div>`;
    }

    // Comments Section HTML
    const comments = window.db.comments ? window.db.comments.filter(c => c.review_id === r.id) : [];
    let commentsListHtml = '';
    if (comments.length > 0) {
      comments.sort((a, b) => new Date(a.created_at || a.id) - new Date(b.created_at || b.id));
      commentsListHtml = `
        <div class="comments-list" style="margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; padding-left: 0.5rem; border-left: 2px solid rgba(255,255,255,0.08);">
          ${comments.map(c => {
            const author = window.db.profiles.find(p => p.id === c.author_id);
            const name = author ? author.username : 'deactivated_user';
            return `
              <div class="comment-item" style="font-size: 0.8rem; line-height: 1.35; color: #d4d4d8;">
                <span style="color: var(--color-primary); font-weight: 600;">@${sanitizeHTML(name)}</span>: 
                <span>${sanitizeHTML(c.content)}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    let replyFormHtml = '';
    if (currentUser) {
      replyFormHtml = `
        <form onsubmit="postComment('${r.id}', event)" style="display: flex; gap: 0.4rem; margin-top: 0.5rem;">
          <input type="text" placeholder="Add a comment..." required style="flex-grow: 1; font-size: 0.8rem; padding: 0.25rem 0.5rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: var(--radius-sm); color: #fff;" />
          <button type="submit" class="btn btn-primary" style="padding: 0.25rem 0.75rem; font-size: 0.75rem; width: auto; height: auto; margin: 0;">Reply</button>
        </form>
      `;
    }

    const commentsSectionHtml = `
      <div class="comments-section" style="margin-top: 0.75rem; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 0.5rem;">
        <h4 style="margin: 0; font-size: 0.85rem; color: #a1a1aa; font-weight: 600;">Comments (${comments.length})</h4>
        ${commentsListHtml}
        ${replyFormHtml}
      </div>
    `;

    const html = `
      <div class="review-card ${cardClass}" data-review-id="${r.id}" style="margin-bottom: 0px; word-wrap: break-word; word-break: break-word; overflow-wrap: break-word;">
        <div class="review-card-header">
          <div>
            <strong>${node ? sanitizeHTML(node.name) : 'Unknown Node'}</strong>
            <span class="node-path" style="display: block; font-size: 0.7rem; margin-top: 0.25rem; background: transparent; border: none; color: var(--color-text-dim); padding: 0; word-wrap: break-word; word-break: break-word; overflow-wrap: break-word; white-space: normal;">
              ${node ? sanitizeHTML(getNodePathString(node)) : ''}
            </span>
            ${locHTML}
            ${parametersLine}
          </div>
          <div class="review-badge-container">
            ${editBtnHtml}
            ${poeBadge}
          </div>
        </div>
        <div class="review-content" style="margin-top: 0.5rem;">${sanitizeHTML(r.raw_content)}</div>
        
        <!-- Render tags linked to this review -->
        ${(() => {
          const tagIds = db.review_tags ? db.review_tags.filter(rt => rt.review_id === r.id).map(rt => rt.tag_id) : [];
          const tags = db.tags ? db.tags.filter(t => tagIds.includes(t.id)) : [];
          if (tags.length === 0) return '';
          return `
            <div class="review-tag-badges" style="margin-top: 0.5rem; display: flex; gap: 0.25rem; flex-wrap: wrap;">
              ${tags.map(t => `<span class="tag-chip" style="font-size:0.65rem; padding: 1px 6px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius:4px;">#${sanitizeHTML(t.name)}</span>`).join('')}
            </div>
          `;
        })()}

        ${disputeNotice}
        ${votesHTML}
        ${changelogBtnHtml}
        <div class="review-card-footer" style="margin-top: 0.75rem; border-top: 1px solid var(--border-color); padding-top: 0.5rem;">
          <div class="consensus-stats">
            <span class="consensus-ratio-formula">θ = ${theta.toFixed(2)}</span>
            <span>(Vouch: ${wv.toFixed(2)} | Dispute: ${wd.toFixed(2)})</span>
          </div>
        </div>
        ${commentsSectionHtml}
      </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    if (wrapper.firstElementChild) {
      fragment.appendChild(wrapper.firstElementChild);
    }
  });
  feed.appendChild(fragment);
}

// ----------------------------------------------------
// 4. Interactive User Inputs
// ----------------------------------------------------

// Toggle between existing merchant and new path creation
function renderProfileTelemetryInputs() {
  const container = document.getElementById('profile-telemetry-inputs-container');
  const gpsCheckboxRow = document.getElementById('profile-gps-checkbox-row');
  const ocrCheckboxRow = document.getElementById('profile-ocr-checkbox-row');
  const sigCheckboxRow = document.getElementById('profile-sig-checkbox-row');

  if (!container) return;

  const mode = document.querySelector('input[name="review-node-mode"]:checked')?.value || 'existing';
  let geId = '';

  if (mode === 'existing') {
    const nodeId = parseInt(document.getElementById('review-target-node')?.value);
    const node = db.nodes.find(n => n.id === nodeId);
    const instId = node ? node.execution_instance_id : null;
    const inst = instId ? db.execution_instances.find(ei => ei.id === instId) : null;
    if (inst) {
      geId = inst.global_entity_id;
    }
  } else {
    geId = document.getElementById('review-new-global-entity')?.value || '';
  }

  if (!geId) {
    container.classList.add('hidden');
    container.innerHTML = '';

    // reset check visibility
    gpsCheckboxRow?.classList.remove('hidden');
    ocrCheckboxRow?.classList.remove('hidden');
    sigCheckboxRow?.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  if (geId === 'ge_macchiato') {
    gpsCheckboxRow?.classList.remove('hidden');
    ocrCheckboxRow?.classList.remove('hidden');
    sigCheckboxRow?.classList.add('hidden');

    container.innerHTML = `
      <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-success); font-family:var(--font-heading);">☕ Telemetry Data Ingestion</h4>
      <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
        <div class="form-group-inline" style="margin-bottom:0; display: flex; align-items: center; gap: 0.5rem;">
          <label for="profile-param-espresso" style="font-size:0.75rem; color:#a1a1aa;">Espresso Weight (g):</label>
          <input type="number" id="profile-param-espresso" step="0.1" value="20.0" class="select-field" style="width: 80px; padding: 4px 8px; font-size:0.85rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: white; border-radius: 4px;">
        </div>
        <div class="form-group-inline" style="margin-bottom:0; display: flex; align-items: center; gap: 0.5rem;">
          <label for="profile-param-layering" style="font-size:0.75rem; color:#a1a1aa;">Layering (0-1):</label>
          <input type="number" id="profile-param-layering" min="0" max="1" step="0.1" value="1.0" class="select-field" style="width: 80px; padding: 4px 8px; font-size:0.85rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: white; border-radius: 4px;">
        </div>
      </div>
    `;
  } else if (geId === 'ge_gpu_x') {
    gpsCheckboxRow?.classList.add('hidden');
    ocrCheckboxRow?.classList.add('hidden');
    sigCheckboxRow?.classList.remove('hidden');

    container.innerHTML = `
      <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-success); font-family:var(--font-heading);">🔌 Enclave Telemetry Ingestion</h4>
      <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
        <div class="form-group-inline" style="margin-bottom:0; display: flex; align-items: center; gap: 0.5rem;">
          <label for="profile-param-thermal" style="font-size:0.75rem; color:#a1a1aa;">Thermal (°C):</label>
          <input type="number" id="profile-param-thermal" step="0.1" value="72.0" class="select-field" style="width: 80px; padding: 4px 8px; font-size:0.85rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: white; border-radius: 4px;">
        </div>
        <div class="form-group-inline" style="margin-bottom:0; display: flex; align-items: center; gap: 0.5rem;">
          <label for="profile-param-clock" style="font-size:0.75rem; color:#a1a1aa;">Clock (GHz):</label>
          <input type="number" id="profile-param-clock" step="0.01" value="2.50" class="select-field" style="width: 80px; padding: 4px 8px; font-size:0.85rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: white; border-radius: 4px;">
        </div>
        <div class="form-group-inline" style="margin-bottom:0; display: flex; align-items: center; gap: 0.5rem;">
          <label for="profile-param-voltage" style="font-size:0.75rem; color:#a1a1aa;">Voltage (V):</label>
          <input type="number" id="profile-param-voltage" step="0.01" value="1.15" class="select-field" style="width: 80px; padding: 4px 8px; font-size:0.85rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: white; border-radius: 4px;">
        </div>
      </div>
    `;
  } else if (geId === 'ge_fishing_pool') {
    gpsCheckboxRow?.classList.remove('hidden');
    ocrCheckboxRow?.classList.add('hidden');
    sigCheckboxRow?.classList.add('hidden');

    container.innerHTML = `
      <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-success); font-family:var(--font-heading);">🎣 Stream Telemetry Ingestion</h4>
      <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
        <div class="form-group-inline" style="margin-bottom:0; display: flex; align-items: center; gap: 0.5rem;">
          <label for="profile-param-flow" style="font-size:0.75rem; color:#a1a1aa;">Flow Rate (cfs):</label>
          <input type="number" id="profile-param-flow" step="0.1" value="30.0" class="select-field" style="width: 80px; padding: 4px 8px; font-size:0.85rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: white; border-radius: 4px;">
        </div>
        <div class="form-group-inline" style="margin-bottom:0; display: flex; align-items: center; gap: 0.5rem;">
          <label for="profile-param-temp" style="font-size:0.75rem; color:#a1a1aa;">Water Temp (°C):</label>
          <input type="number" id="profile-param-temp" step="0.1" value="14.0" class="select-field" style="width: 80px; padding: 4px 8px; font-size:0.85rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: white; border-radius: 4px;">
        </div>
      </div>
    `;
  }
}

// Toggle between existing merchant and new path creation
document.querySelectorAll('input[name="review-node-mode"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const mode = e.target.value;
    const labelEl = document.getElementById('label-review-target-search');
    const searchEl = document.getElementById('review-target-search');
    const autocompleteMenu = document.getElementById('review-target-autocomplete-menu');
    const breadcrumbPreview = document.getElementById('review-target-breadcrumb-preview');
    const groupNew = document.getElementById('group-new-node');
    const targetNodeSelect = document.getElementById('review-target-node');

    if (mode === 'existing') {
      if (labelEl) labelEl.innerText = "Select Location or Business";
      if (searchEl) {
        searchEl.placeholder = "Search by name... (e.g. Austin, Shinjuku, Classic Coffee)";
        const selectedId = parseInt(targetNodeSelect?.value);
        const selectedNode = db.nodes.find(n => n.id === selectedId);
        searchEl.value = selectedNode ? selectedNode.name : '';
        if (selectedNode && breadcrumbPreview) {
          breadcrumbPreview.classList.remove('hidden');
        }
      }
      if (groupNew) groupNew.classList.add('hidden');
    } else {
      if (labelEl) labelEl.innerText = "New Location Name (Slashes separate sub-folders)";
      if (searchEl) {
        searchEl.placeholder = "e.g. Coffee Shops / Joe's Cafe";
        searchEl.value = '';
      }
      if (autocompleteMenu) autocompleteMenu.classList.add('hidden');
      if (breadcrumbPreview) breadcrumbPreview.classList.add('hidden');
      if (groupNew) groupNew.classList.remove('hidden');
    }
    renderProfileTelemetryInputs();
  });
});

document.getElementById('review-target-node')?.addEventListener('change', renderProfileTelemetryInputs);
document.getElementById('review-new-global-entity')?.addEventListener('change', renderProfileTelemetryInputs);

// Verification logs disabled

// Login trigger
document.getElementById('btn-login')?.addEventListener('click', async () => {
  const keyInput = document.getElementById('login-access-key').value.trim();
  const errMsg = document.getElementById('login-error-msg');
  const btn = document.getElementById('btn-login');

  if (!keyInput) {
    errMsg.innerText = 'Error: Access key cannot be empty.';
    errMsg.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.innerText = 'Verifying...';

  try {
    const res = await fetch('https://api.inviteonlyreviews.com/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ authKey: keyInput })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      errMsg.innerText = 'Error: ' + (data.error || 'Invalid credentials or server error.');
      errMsg.classList.remove('hidden');
      btn.disabled = false;
      btn.innerText = 'Access Network';
      return;
    }

    const data = await res.json();
    const profile = data.profile;

    if (!profile.is_active) {
      errMsg.innerText = 'Security Block: This profile has been cascade-revoked due to trust contagion.';
      errMsg.classList.remove('hidden');
      btn.disabled = false;
      btn.innerText = 'Access Network';
      return;
    }

    // Successfully authenticated
    errMsg.classList.add('hidden');
    
    // Update local db if not present (in case of fresh browser login)
    let localP = db.profiles.find(p => p.id === profile.id);
    if (localP) {
      localP.username = profile.username;
      localP.reputation_score = profile.reputation_score;
      localP.invited_by = profile.invited_by;
      localP.is_active = profile.is_active;
      localP.role = profile.role;
      localP.access_key = keyInput; // Cache it locally for the session if needed
    } else {
      profile.access_key = keyInput;
      db.profiles.push(profile);
    }
    await saveDbState();

    currentUser = profile;
    showDashboard();

  } catch (err) {
    console.error(err);
    errMsg.innerText = 'Error connecting to verification server.';
    errMsg.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Access Network';
  }
});

// Toggle signup form visibility in Login Gate
document.getElementById('toggle-redeem-form')?.addEventListener('click', (e) => {
  e.preventDefault();
  const form = document.getElementById('login-gate-redeem-form');
  form.classList.toggle('hidden');
});

// In-place signup inside Login Gate
document.getElementById('btn-profile-signup')?.addEventListener('click', async () => {
  const tokenInput = document.getElementById('profile-reg-token').value.trim();
  const usernameInput = document.getElementById('profile-reg-username').value.trim();
  const errMsg = document.getElementById('profile-signup-msg');

  if (!tokenInput || !usernameInput) {
    errMsg.innerText = 'Error: Please enter both token and username.';
    errMsg.className = 'signup-status-message error';
    errMsg.classList.remove('hidden');
    return;
  }

  const regex = /^[A-Za-z0-9_]{3,15}$/;
  if (!regex.test(usernameInput)) {
    errMsg.innerText = 'Error: Username must be 3-15 chars (alphanumeric/underline).';
    errMsg.className = 'signup-status-message error';
    errMsg.classList.remove('hidden');
    return;
  }

  // Load latest DB state
  loadDbState();

  // Find token
  let tokenObj = db.invite_tokens.find(t => t.rawToken === tokenInput);
  const isLocalToken = !!tokenObj;

  if (isLocalToken) {
    if (tokenObj.is_used) {
      errMsg.innerText = 'Error: Token has already been redeemed.';
      errMsg.className = 'signup-status-message error';
      errMsg.classList.remove('hidden');
      return;
    }

    if (tokenObj.expires_at < Date.now()) {
      errMsg.innerText = 'Error: Invite token has expired.';
      errMsg.className = 'signup-status-message error';
      errMsg.classList.remove('hidden');
      return;
    }
  }

  if (db.profiles.some(p => p.username.toLowerCase() === usernameInput.toLowerCase())) {
    errMsg.innerText = 'Error: Username is already taken.';
    errMsg.className = 'signup-status-message error';
    errMsg.classList.remove('hidden');
    return;
  }

  // Perform Cloud signup
  errMsg.innerText = 'Connecting to Cloudflare edge worker...';
  errMsg.className = 'signup-status-message info';
  errMsg.classList.remove('hidden');

  try {
    // Generate secure random suffix (16 hex chars)
    let suffix = '';
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        const randomArray = new Uint32Array(2);
        window.crypto.getRandomValues(randomArray);
        suffix = Array.from(randomArray).map(n => n.toString(16).padStart(8, '0')).join('');
      } else {
        throw new Error('Web Crypto API not available');
      }
    } catch (e) {
      // Safe fallback
      const chars = '0123456789abcdef';
      for (let i = 0; i < 16; i++) {
        suffix += chars[Math.floor(Math.random() * 16)];
      }
    }
    const accessKey = 'key_' + usernameInput + '_' + suffix;

    const response = await fetch('https://api.inviteonlyreviews.com/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        inviteToken: tokenInput,
        username: usernameInput,
        password: accessKey,
        demographicGroup: document.getElementById('profile-reg-demographic')?.value || 'urban_affluent'
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Edge registration transaction failed.');
    }

    // Success: Sync local state
    if (tokenObj) {
      tokenObj.is_used = true;
    }
    const newId = result.profile ? result.profile.id : (result.profile_id || null);
    if (!newId) {
      throw new Error("Failed to retrieve profile ID from registration response.");
    }
    
    db.profiles.push({
      id: newId,
      username: usernameInput,
      reputation_score: 1.0000,
      base_reputation: 1.0000,
      invited_by: (result.profile && result.profile.invited_by) || (tokenObj ? tokenObj.inviter_id : null),
      is_active: true,
      access_key: accessKey,
      demographic_group: document.getElementById('profile-reg-demographic')?.value || 'urban_affluent'
    });

    await saveDbState();

    errMsg.innerText = '✓ Success! Logged in as @' + usernameInput;
    errMsg.className = 'signup-status-message success';
    errMsg.classList.remove('hidden');

    showAccessKeyModal('✓ Registration successful!', 'IMPORTANT: Copy and save this key. You will need it to log in next time.', accessKey);

    // Clear inputs
    document.getElementById('profile-reg-token').value = '';
    document.getElementById('profile-reg-username').value = '';

    // Log in automatically
    currentUser = db.profiles.find(p => p.id === newId);

    setTimeout(() => {
      errMsg.classList.add('hidden');
      document.getElementById('login-gate-redeem-form').classList.add('hidden');
      showDashboard();
    }, 500);

  } catch (err) {
    errMsg.innerText = 'Error: ' + err.message;
    errMsg.className = 'signup-status-message error';
    errMsg.classList.remove('hidden');
  }
});

// Logout trigger
document.getElementById('btn-logout')?.addEventListener('click', () => {
  showLoginGate();
});

// Update Memorable Key Suffix
const btnUpdateKeySuffix = document.getElementById('btn-update-key-suffix');
if (btnUpdateKeySuffix) {
  btnUpdateKeySuffix.addEventListener('click', async () => {
    const suffixInput = document.getElementById('custom-key-suffix');
    if (!suffixInput) return;
    const suffix = suffixInput.value.trim();

    if (!currentUser) {
      alert("Error: You must be logged in to update your access key.");
      return;
    }

    // Validate the suffix (minimum 6 characters, alphanumeric only, no spaces)
    const alphanumericRegex = /^[a-zA-Z0-9]+$/;
    if (!suffix) {
      alert("Error: Suffix cannot be empty.");
      return;
    }
    if (suffix.length < 6) {
      alert("Error: Suffix must be at least 6 characters long.");
      return;
    }
    if (!alphanumericRegex.test(suffix)) {
      alert("Error: Suffix must be alphanumeric only (letters and numbers, no spaces).");
      return;
    }

    // Update access key
    const newKey = `key_${currentUser.username}_${suffix}`;

    btnUpdateKeySuffix.disabled = true;
    btnUpdateKeySuffix.innerText = 'Updating...';

    try {
      const res = await fetch('https://api.inviteonlyreviews.com/api/profile/update-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          newKey: newKey
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(()=>({}));
        alert("Error: " + (data.error || 'Failed to update access key.'));
        return;
      }

      // Find current user's profile in db.profiles and update it locally
      const profile = db.profiles.find(p => p.id === currentUser.id);
      if (profile) {
        profile.access_key = newKey;
        currentUser.access_key = newKey;
      }

      // Save changes to IndexedDB database state
      await saveDbState();

      // Clear the input
      suffixInput.value = '';

      // Refresh UI preview
      renderProfileCard();

      showAccessKeyModal('✓ Access key updated successfully!', 'Please copy and save this key to log in next time.', newKey);

    } catch (err) {
      console.error(err);
      alert("An error occurred connecting to the server.");
    } finally {
      btnUpdateKeySuffix.disabled = false;
      btnUpdateKeySuffix.innerText = 'Update Credentials';
    }
  });
}

// Quick login mapping
window.quickLogin = function(key) {
  const loginInput = document.getElementById('login-access-key');
  if (loginInput) loginInput.value = key;
  document.getElementById('btn-login')?.click();
};

// Generate invite token
document.getElementById('btn-generate-profile-token')?.addEventListener('click', async () => {
  const isMod = currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator';
  const totalGenerated = db.invite_tokens.filter(t => t.inviter_id === currentUser.id).length;
  if (isMod) {
    const releasedCount = db.profiles.filter(p => p.originally_invited_by === currentUser.id && p.released_by === currentUser.id).length;
    const consumed = totalGenerated - releasedCount;
    if (consumed >= 20) {
      alert("Quota reached: You cannot have more than 20 active invited accounts as a moderator.");
      return;
    }
  } else {
    if (totalGenerated >= 5) {
      alert("Quota reached: You cannot generate more than 5 invite tokens.");
      return;
    }
  }

  const rawToken = 'tkn_' + Math.random().toString(36).substr(2, 16);

  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/generate-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        rawToken: rawToken
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to generate token on Cloudflare Worker.');
    }

    // Compute SHA-256 hash of raw token for local consistency
    const encoder = new TextEncoder();
    const tokenData = encoder.encode(rawToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', tokenData);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    db.invite_tokens.push({
      token: hashHex,
      inviter_id: currentUser.id,
      is_used: false,
      expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
      rawToken: rawToken
    });

    await saveDbState();
    renderInviteHub();
  } catch (err) {
    alert('Error generating live invite: ' + err.message);
    console.error(err);
  }
});

// Submit review with simulated PoE EXIF/OCR/Enclave
document.getElementById('btn-submit-profile-review')?.addEventListener('click', async () => {
  const mode = document.querySelector('input[name="review-node-mode"]:checked').value;
  let nodeId;
  const globalEntityId = document.getElementById('review-new-global-entity')?.value || '';
  const newNodesList = [];

  if (mode === 'existing') {
    nodeId = parseInt(document.getElementById('review-target-node').value);
    if (isNaN(nodeId)) {
      alert("Please select a valid merchant node.");
      return;
    }
  } else {
    // Create new node pathway dynamically
    const parentIdVal = document.getElementById('review-new-parent-node').value;
    const pathText = document.getElementById('review-target-search').value.trim();
    const leafType = document.getElementById('review-new-leaf-type').value;
    const address = document.getElementById('review-new-address').value.trim();
    const coords = document.getElementById('review-new-coords').value.trim();

    if (!parentIdVal) {
      alert("Please select a valid base parent node.");
      return;
    }
    if (!pathText) {
      alert("Please specify the path of the new location/item to review.");
      return;
    }

    let finalNodeId = null;
    let createNodesNeeded = true;

    // Intercept leaf node creation if coordinates already exist nearby
    if (coords) {
      const existingNodeId = await window.checkSpatialDeduplication(coords);
      if (existingNodeId) {
        finalNodeId = existingNodeId;
        createNodesNeeded = false;
      }
    }

    if (createNodesNeeded) {
      const parentId = parseInt(parentIdVal);
      const parts = pathText.split('/').map(p => p.trim()).filter(Boolean);
      if (parts.length === 0) {
        alert("Sub-path cannot be empty.");
        return;
      }

      // Helper to generate slug
      const toSlug = (str) => {
        return str.toLowerCase()
                  .replace(/[^a-z0-9_]+/g, '_')
                  .replace(/^_+|_+$/g, '');
      };

      let currentParentId = parentId;
      let createdCount = 0;

      for (let i = 0; i < parts.length; i++) {
        const name = parts[i];
        const slug = toSlug(name);
        if (!slug) {
          alert(`Invalid name component: "${name}"`);
          return;
        }

        // Check if node exists under currentParentId using findNormalizedNode
        let existingNode = window.findNormalizedNode(currentParentId, name);
        const isLeaf = (i === parts.length - 1);

        if (existingNode) {
          currentParentId = existingNode.id;
          if (isLeaf) {
            if (address) existingNode.address = address;
            if (coords) existingNode.coordinates = coords;
            if (globalEntityId && !existingNode.execution_instance_id) {
              const arch = db.parameterized_archetypes.find(a => a.parent_entity_id === globalEntityId);
              const instId = 'ei_' + globalEntityId.replace('ge_', '') + '_' + existingNode.id;
              const newInstance = {
                id: instId,
                global_entity_id: globalEntityId,
                current_archetype_id: arch ? arch.id : null,
                location_name: name,
                address: address || null,
                coordinates: coords || null,
                gps_dop: 1.0
              };
              db.execution_instances.push(newInstance);
              existingNode.execution_instance_id = instId;
            }
          }
        } else {
          // Create new node
          const nextId = Math.floor(Math.random() * 100000000) + 1000000;
          const parentNode = db.nodes.find(n => n.id === currentParentId);
          const parentPath = parentNode ? parentNode.path : '';
          const newPath = parentPath ? `${parentPath}.${nextId}` : `${nextId}`;

          // intermediate nodes are 'category', leaf node has selected type
          let type = isLeaf ? leafType : 'category';
          if (!isLeaf) {
            const parentNode = db.nodes.find(n => n.id === currentParentId);
            if (parentNode) {
              if (parentNode.node_type === 'state') {
                type = 'city';
              } else if (parentNode.node_type === 'city') {
                type = 'neighborhood';
              }
            }
          }

          const newNode = {
            id: nextId,
            parent_id: currentParentId,
            name: name,
            slug: slug,
            node_type: type,
            path: newPath,
            address: isLeaf && address ? address : null,
            coordinates: isLeaf && coords ? coords : null,
            needs_taxonomy_review: (type === 'city')
          };

          if (isLeaf && globalEntityId) {
            const arch = db.parameterized_archetypes.find(a => a.parent_entity_id === globalEntityId);
            const instId = 'ei_' + globalEntityId.replace('ge_', '') + '_' + nextId;
            const newInstance = {
              id: instId,
              global_entity_id: globalEntityId,
              current_archetype_id: arch ? arch.id : null,
              location_name: name,
              address: address || null,
              coordinates: coords || null,
              gps_dop: 1.0
            };
            db.execution_instances.push(newInstance);
            newNode.execution_instance_id = instId;
          }

          db.nodes.push(newNode);
          newNodesList.push(newNode);
          currentParentId = nextId;
          createdCount++;
        }
      }
      finalNodeId = currentParentId;
    }

    nodeId = finalNodeId;
    // Always re-populate dropdowns to ensure they are in sync
    populateMerchantDropdown();
    populateParentNodeDropdown();
  }

  const content = document.getElementById('new-review-text').value.trim();
  const gpsChecked = document.getElementById('chk-profile-gps')?.checked || false;
  const ocrChecked = document.getElementById('chk-profile-ocr')?.checked || false;
  const sigChecked = false;

  if (content.length < 10 || content.length > 10000) {
    alert("Review must be between 10 and 10,000 characters.");
    return;
  }

  const activeNode = db.nodes.find(n => n.id === nodeId);
  const instId = activeNode ? activeNode.execution_instance_id : null;
  const inst = instId ? db.execution_instances.find(ei => ei.id === instId) : null;
  const ge = inst ? db.global_entities.find(g => g.id === inst.global_entity_id) : null;

  let param1 = null;
  let param2 = null;
  let param3 = null;
  let method = null;
  let gpsDopVal = null;

  if (ge) {
    if (ge.id === 'ge_macchiato') {
      param1 = parseFloat(document.getElementById('profile-param-espresso')?.value || 20.0);
      param2 = parseFloat(document.getElementById('profile-param-layering')?.value || 1.0);
    } else if (ge.id === 'ge_gpu_x') {
      param1 = parseFloat(document.getElementById('profile-param-thermal')?.value || 72.0);
      param2 = parseFloat(document.getElementById('profile-param-clock')?.value || 2.50);
      param3 = parseFloat(document.getElementById('profile-param-voltage')?.value || 1.15);
    } else if (ge.id === 'ge_fishing_pool') {
      param1 = parseFloat(document.getElementById('profile-param-flow')?.value || 30.0);
      param2 = parseFloat(document.getElementById('profile-param-temp')?.value || 14.0);
    }
  }

  // Telemetry Console Logs
  const poeLogs = document.getElementById('profile-poe-logs');
  if (poeLogs) {
    poeLogs.innerHTML = '';
    if (gpsChecked || ocrChecked) {
      poeLogs.classList.remove('hidden');
    } else {
      poeLogs.classList.add('hidden');
    }
  }

  const log = (msg, style = '') => {
    if (poeLogs) {
      poeLogs.innerHTML += `<div class="log-line ${style}">> ${msg}</div>`;
      poeLogs.scrollTop = poeLogs.scrollHeight;
    }
  };

  let pipeline = [];
  let gpsSuccess = false;
  let ocrSuccess = false;

  if (gpsChecked) {
    pipeline.push(async (cb) => {
      log("Edge-Worker: Analyzing image EXIF metadata...", "info");
      try {
        const gpsCoords = await extractGpsFromImages(profileUploadedFiles);
        if (gpsCoords) {
          log(`Edge-Worker: Found EXIF GPS coordinates: ${gpsCoords.latitude.toFixed(6)}, ${gpsCoords.longitude.toFixed(6)}`, "info");
          
          let targetCoordsStr = "";
          if (mode === 'new') {
            targetCoordsStr = document.getElementById('review-new-coords').value.trim();
          } else {
            const node = db.nodes.find(n => n.id === nodeId);
            targetCoordsStr = node ? (node.coordinates || "") : "";
          }
          
          const targetCoords = window.parseCoords(targetCoordsStr);
          if (targetCoords) {
            const distance = window.getHaversineDistance(gpsCoords.latitude, gpsCoords.longitude, targetCoords.lat, targetCoords.lon);
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

  if (ocrChecked) {
    pipeline.push(async (cb) => {
      log("Serverless Worker: Loading WASM Tesseract OCR engine...", "info");
      try {
        if (profileUploadedFiles.length === 0) {
          log("Serverless Worker: No files uploaded for OCR analysis. Transaction verification FAILED.", "danger");
        } else {
          log("Serverless Worker: Analyzing text from uploaded receipt...", "info");
          const ocrText = await performOcrOnImages(profileUploadedFiles, (percent) => {
            log(`Serverless Worker: OCR Parsing ${percent}%...`, "info");
          });
          log(`Serverless Worker: OCR Text extracted successfully. Performing keyword matches...`, "info");
          
          let targetName = "";
          let targetAliases = [];
          if (mode === 'new') {
            const pathText = document.getElementById('review-target-search').value.trim();
            const pathSegments = pathText.split('/').map(s => s.trim()).filter(Boolean);
            targetName = pathSegments[pathSegments.length - 1] || "";
            targetAliases = [];
          } else {
            const node = db.nodes.find(n => n.id === nodeId);
            targetName = node ? node.name : "";
            targetAliases = node ? (node.aliases || []) : [];
          }
          
          const isOcrMatch = await window.runWorkerTask('fuzzyMatchText', {
            ocrText,
            targetName,
            aliases: targetAliases
          });
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

  const runPostReviewTransaction = async () => {
    log("PoE Pipeline complete. Appending review...", "command");
    
    let hasValidPoe = false;
    if (gpsChecked && gpsSuccess) {
      hasValidPoe = true;
      method = 'exif_gps';
      gpsDopVal = 1.0;
    }
    if (ocrChecked && ocrSuccess) {
      hasValidPoe = true;
      method = method ? `${method},wasm_ocr` : 'wasm_ocr';
    }

    const newId = '00000000-0000-0000-0000-000000' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    
    const newReview = {
      id: newId,
      node_id: nodeId,
      execution_instance_id: instId,
      author_id: currentUser.id,
      raw_content: content,
      is_verified_experience: hasValidPoe,
      param_val_1: param1,
      param_val_2: param2,
      param_val_3: param3,
      verification_method: method,
      gps_dop: gpsDopVal,
      created_at: Date.now()
    };

    db.reviews.push(newReview);

    // Save custom tags
    const tagsList = [];
    const tagsInputVal = document.getElementById('new-review-tags')?.value.trim();
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
        db.review_tags.push({ review_id: newId, tag_id: tagId });
        tagsList.push(tagStr);
      });
    }

    await saveDbState();

    // Call Supabase API
    fetch('https://api.inviteonlyreviews.com/api/reviews', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({
        review: newReview,
        newNodes: newNodesList,
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

    // Clear inputs
    const tagsInput = document.getElementById('new-review-tags');
    if (tagsInput) tagsInput.value = '';
    document.getElementById('new-review-text').value = '';
    const searchInputEl = document.getElementById('review-target-search');
    if (searchInputEl) searchInputEl.value = '';
    const targetNodeSelect = document.getElementById('review-target-node');
    if (targetNodeSelect) targetNodeSelect.value = '';
    const newAddressEl = document.getElementById('review-new-address');
    if (newAddressEl) newAddressEl.value = '';
    const newCoordsEl = document.getElementById('review-new-coords');
    if (newCoordsEl) newCoordsEl.value = '';

    const gpsCheckboxEl = document.getElementById('chk-profile-gps');
    const ocrCheckboxEl = document.getElementById('chk-profile-ocr');
    const mediaGroupEl = document.getElementById('poe-profile-media-group');
    const uploadInputEl = document.getElementById('poe-profile-image-upload');
    const previewContainerEl = document.getElementById('poe-profile-preview-container');
    const poeLogsEl = document.getElementById('profile-poe-logs');

    if (gpsCheckboxEl) gpsCheckboxEl.checked = false;
    if (ocrCheckboxEl) ocrCheckboxEl.checked = false;
    if (mediaGroupEl) mediaGroupEl.classList.add('hidden');
    if (uploadInputEl) uploadInputEl.value = '';
    if (previewContainerEl) previewContainerEl.innerHTML = '';
    profileUploadedFiles = [];
    setTimeout(() => {
      if (poeLogsEl) poeLogsEl.classList.add('hidden');
    }, 2000);

    const existingRadio = document.querySelector('input[name="review-node-mode"][value="existing"]');
    if (existingRadio) {
      existingRadio.checked = true;
      existingRadio.dispatchEvent(new Event('change'));
    }

    renderMyReviewsFeed();
    showToastNotification("Review Posted Successfully!");
  };

  // Run sequential pipeline
  if (pipeline.length > 0) {
    let currentStep = 0;
    const next = () => {
      if (currentStep < pipeline.length) {
        pipeline[currentStep++](next);
      } else {
        runPostReviewTransaction();
      }
    };
    next();
  } else {
    runPostReviewTransaction();
  }
});

// ----------------------------------------------------
// 5. Cross-Client Multi-Tab Syncing
// ----------------------------------------------------
window.addEventListener('storage', (e) => {
  if (e.key === 'review_network_db') {
    try {
      db = JSON.parse(e.newValue);

      // If our profile was revoked in another window, log us out immediately!
      if (currentUser) {
        const freshProfile = db.profiles.find(p => p.id === currentUser.id);
        if (!freshProfile || !freshProfile.is_active) {
          alert("Security Alert: Your account has been revoked in the network lineage. Logging out.");
          showLoginGate();
          return;
        }
        currentUser = freshProfile; // update in-memory object
      }
      
      if (currentUser) {
        showDashboard();
      } else {
        showLoginGate();
      }
      console.log('Profile DB successfully synced via storage event.');
    } catch (err) {
      console.error('Failed to sync DB in profile.js:', err);
    }
  }
});

// Searchable Dropdown Helper Function
function makeSelectSearchable(selectId, placeholderText = "Search options...") {
  const select = document.getElementById(selectId);
  if (!select) return;

  let wrapper = select.closest('.searchable-select-wrapper');
  if (wrapper) {
    // Already initialized. Just update input text to match selected index
    const input = wrapper.querySelector('.searchable-select-input');
    if (select.selectedIndex >= 0 && input) {
      input.value = select.options[select.selectedIndex].text;
    }
    return;
  }

  // Create wrapper
  wrapper = document.createElement('div');
  wrapper.className = 'searchable-select-wrapper';
  wrapper.style.position = 'relative';
  wrapper.style.width = '100%';

  // Hide select and insert wrapper
  select.style.display = 'none';
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  // Create input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'searchable-select-input';
  input.placeholder = placeholderText;
  input.style.width = '100%';
  input.style.borderRadius = 'var(--radius-sm)';
  input.style.border = '1px solid var(--border-color)';
  input.style.padding = '0.75rem';
  input.style.background = 'rgba(0,0,0,0.2)';
  input.style.color = '#e2e8f0';
  input.style.boxSizing = 'border-box';
  input.style.fontFamily = 'var(--font-body)';
  input.style.fontSize = '0.95rem';
  input.autocomplete = 'off';
  wrapper.appendChild(input);

  // Create dropdown menu
  const menu = document.createElement('div');
  menu.className = 'searchable-select-menu hidden';
  menu.style.position = 'absolute';
  menu.style.top = '105%';
  menu.style.left = '0';
  menu.style.width = '100%';
  menu.style.maxHeight = '250px';
  menu.style.overflowY = 'auto';
  menu.style.background = '#12141c';
  menu.style.border = '1px solid var(--border-color)';
  menu.style.borderRadius = 'var(--radius-sm)';
  menu.style.zIndex = '1000';
  menu.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
  wrapper.appendChild(menu);

  // Function to populate/filter dropdown options
  const updateOptions = () => {
    menu.innerHTML = '';
    const query = input.value.toLowerCase();
    let count = 0;

    Array.from(select.options).forEach((opt, idx) => {
      const text = opt.text;
      if (text.toLowerCase().includes(query)) {
        const item = document.createElement('div');
        item.className = 'searchable-select-item';
        item.innerText = text;
        item.style.padding = '0.75rem';
        item.style.cursor = 'pointer';
        item.style.fontSize = '0.9rem';
        item.style.color = '#e2e8f0';
        item.style.borderBottom = '1px solid rgba(255,255,255,0.02)';
        item.style.transition = 'background 0.2s';
        
        // Highlight selected
        if (select.selectedIndex === idx) {
          item.style.background = 'rgba(16, 185, 129, 0.1)';
          item.style.color = 'var(--color-primary)';
          item.style.fontWeight = '500';
        }

        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(255,255,255,0.05)';
        });
        item.addEventListener('mouseleave', () => {
          if (select.selectedIndex === idx) {
            item.style.background = 'rgba(16, 185, 129, 0.1)';
          } else {
            item.style.background = 'transparent';
          }
        });

        item.addEventListener('click', () => {
          select.selectedIndex = idx;
          input.value = text;
          menu.classList.add('hidden');
          select.dispatchEvent(new Event('change'));
        });

        menu.appendChild(item);
        count++;
      }
    });

    if (count === 0) {
      const noRes = document.createElement('div');
      noRes.innerText = 'No matches found';
      noRes.style.padding = '0.75rem';
      noRes.style.color = 'var(--color-text-dim)';
      noRes.style.fontSize = '0.85rem';
      noRes.style.textAlign = 'center';
      menu.appendChild(noRes);
    }
  };

  // Sync initial input value
  if (select.selectedIndex >= 0) {
    input.value = select.options[select.selectedIndex].text;
  }

  // Toggle menu on focus
  input.addEventListener('focus', () => {
    menu.classList.remove('hidden');
    updateOptions();
  });

  input.addEventListener('input', () => {
    menu.classList.remove('hidden');
    updateOptions();
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      menu.classList.add('hidden');
      if (select.selectedIndex >= 0) {
        input.value = select.options[select.selectedIndex].text;
      }
    }
  });

  // Sync value when original select updates
  select.addEventListener('change', () => {
    if (select.selectedIndex >= 0) {
      input.value = select.options[select.selectedIndex].text;
    }
  });
}

// Search-First Autocomplete Selector for locations
function initSearchFirstLocationSelector() {
  const searchInput = document.getElementById('review-target-search');
  const autocompleteMenu = document.getElementById('review-target-autocomplete-menu');
  const breadcrumbPreview = document.getElementById('review-target-breadcrumb-preview');
  const breadcrumbText = document.getElementById('review-target-breadcrumb-text');
  const targetNodeSelect = document.getElementById('review-target-node');

  if (!searchInput || !autocompleteMenu || !targetNodeSelect) return;

  const updateSuggestions = () => {
    autocompleteMenu.innerHTML = '';
    const query = searchInput.value.trim().toLowerCase();
    
    const filteredNodes = db.nodes.filter(node => {
      if (!query) return true;
      return node.name && node.name.toLowerCase().includes(query);
    });

    const limitedNodes = filteredNodes.slice(0, 50);

    if (limitedNodes.length === 0) {
      const noRes = document.createElement('div');
      noRes.innerText = 'No matches found';
      noRes.style.padding = '0.75rem';
      noRes.style.color = 'var(--color-text-dim)';
      noRes.style.fontSize = '0.85rem';
      noRes.style.textAlign = 'center';
      autocompleteMenu.appendChild(noRes);
      return;
    }

    limitedNodes.forEach(node => {
      const item = document.createElement('div');
      item.className = 'searchable-select-item';
      item.innerText = node.name; // Only show the location name
      item.style.padding = '0.75rem';
      item.style.cursor = 'pointer';
      item.style.fontSize = '0.9rem';
      item.style.color = '#e2e8f0';
      item.style.borderBottom = '1px solid rgba(255,255,255,0.02)';
      item.style.transition = 'background 0.2s';

      if (parseInt(targetNodeSelect.value) === node.id) {
        item.style.background = 'rgba(16, 185, 129, 0.1)';
        item.style.color = 'var(--color-primary)';
        item.style.fontWeight = '500';
      }

      item.addEventListener('mouseenter', () => {
        item.style.background = 'rgba(255,255,255,0.05)';
      });
      item.addEventListener('mouseleave', () => {
        if (parseInt(targetNodeSelect.value) === node.id) {
          item.style.background = 'rgba(16, 185, 129, 0.1)';
        } else {
          item.style.background = 'transparent';
        }
      });

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        searchInput.value = node.name;
        targetNodeSelect.value = node.id;
        
        const pathString = getNodePathString(node).split(' / ').join(' > ');
        if (breadcrumbText && breadcrumbPreview) {
          breadcrumbText.innerText = pathString;
          breadcrumbPreview.classList.remove('hidden');
        }
        
        autocompleteMenu.classList.add('hidden');
        targetNodeSelect.dispatchEvent(new Event('change'));
      });

      autocompleteMenu.appendChild(item);
    });
  };

  const syncInitialSelection = () => {
    const selectedId = parseInt(targetNodeSelect.value);
    if (!isNaN(selectedId)) {
      const selectedNode = db.nodes.find(n => n.id === selectedId);
      if (selectedNode) {
        searchInput.value = selectedNode.name;
        const pathString = getNodePathString(selectedNode).split(' / ').join(' > ');
        if (breadcrumbText && breadcrumbPreview) {
          breadcrumbText.innerText = pathString;
          breadcrumbPreview.classList.remove('hidden');
        }
      }
    }
  };

  syncInitialSelection();

  searchInput.addEventListener('focus', () => {
    const mode = document.querySelector('input[name="review-node-mode"]:checked')?.value || 'existing';
    if (mode === 'new') return;
    autocompleteMenu.classList.remove('hidden');
    updateSuggestions();
  });

  searchInput.addEventListener('input', () => {
    const mode = document.querySelector('input[name="review-node-mode"]:checked')?.value || 'existing';
    if (mode === 'new') {
      autocompleteMenu.classList.add('hidden');
      return;
    }
    
    // Clear select value if doesn't match selected node name
    const selectedId = parseInt(targetNodeSelect.value);
    const selectedNode = db.nodes.find(n => n.id === selectedId);
    if (!selectedNode || searchInput.value !== selectedNode.name) {
      targetNodeSelect.value = '';
      if (breadcrumbPreview) breadcrumbPreview.classList.add('hidden');
    }

    autocompleteMenu.classList.remove('hidden');
    updateSuggestions();
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      autocompleteMenu.classList.add('hidden');
    }, 150);
  });

  targetNodeSelect.addEventListener('change', () => {
    const selectedId = parseInt(targetNodeSelect.value);
    if (!isNaN(selectedId)) {
      const selectedNode = db.nodes.find(n => n.id === selectedId);
      if (selectedNode) {
        searchInput.value = selectedNode.name;
        const pathString = getNodePathString(selectedNode).split(' / ').join(' > ');
        if (breadcrumbText && breadcrumbPreview) {
          breadcrumbText.innerText = pathString;
          breadcrumbPreview.classList.remove('hidden');
        }
      } else {
        searchInput.value = '';
        if (breadcrumbPreview) breadcrumbPreview.classList.add('hidden');
      }
    } else {
      searchInput.value = '';
      if (breadcrumbPreview) breadcrumbPreview.classList.add('hidden');
    }
  });
}

function showToastNotification(message) {
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.innerHTML = `<span style="margin-right: 8px;">✓</span> ${message}`;
  
  toast.style.position = 'fixed';
  toast.style.bottom = '24px';
  toast.style.right = '24px';
  toast.style.background = 'rgba(16, 185, 129, 0.9)';
  toast.style.backdropFilter = 'blur(10px)';
  toast.style.border = '1px solid rgba(16, 185, 129, 0.3)';
  toast.style.color = '#ffffff';
  toast.style.padding = '0.75rem 1.5rem';
  toast.style.borderRadius = 'var(--radius-sm, 6px)';
  toast.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)';
  toast.style.zIndex = '9999';
  toast.style.fontFamily = 'var(--font-heading, sans-serif)';
  toast.style.fontSize = '0.9rem';
  toast.style.fontWeight = '500';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(20px)';
  toast.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';

  document.body.appendChild(toast);

  // Trigger reflow to start transition
  toast.offsetHeight;

  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => {
      toast.remove();
    }, 400);
  }, 3000);
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// OpenStreetMap Nominatim verified address autocomplete
function initAddressVerification() {
  const addressInput = document.getElementById('review-new-address');
  const coordsInput = document.getElementById('review-new-coords');
  if (!addressInput) return;
  
  // Check if wrapper already exists
  if (addressInput.parentNode.querySelector('.maps-autocomplete-menu')) {
    return; // Already initialized
  }

  // Create container for maps dropdown
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.width = '100%';
  addressInput.parentNode.insertBefore(wrapper, addressInput);
  wrapper.appendChild(addressInput);

  const menu = document.createElement('div');
  menu.className = 'maps-autocomplete-menu hidden';
  menu.style.position = 'absolute';
  menu.style.top = '105%';
  menu.style.left = '0';
  menu.style.width = '100%';
  menu.style.maxHeight = '200px';
  menu.style.overflowY = 'auto';
  menu.style.background = '#12141c';
  menu.style.border = '1px solid var(--border-color)';
  menu.style.borderRadius = 'var(--radius-sm)';
  menu.style.zIndex = '1100';
  menu.style.boxShadow = '0 10px 25px rgba(0,0,0,0.6)';
  wrapper.appendChild(menu);

  // Status message element
  const statusEl = document.createElement('div');
  statusEl.style.fontSize = '0.75rem';
  statusEl.style.color = 'var(--color-primary)';
  statusEl.style.marginTop = '0.25rem';
  statusEl.style.fontWeight = '500';
  statusEl.className = 'hidden';
  wrapper.parentNode.appendChild(statusEl);

  const updateSuggestions = async () => {
    menu.innerHTML = '';
    const query = addressInput.value.trim();
    if (!query) {
      menu.classList.add('hidden');
      return;
    }

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("OSM request failed");
      const data = await response.json();

      menu.innerHTML = '';
      if (data.length === 0) {
        const item = document.createElement('div');
        item.style.padding = '0.65rem 0.75rem';
        item.style.fontSize = '0.85rem';
        item.style.color = '#71717a';
        item.innerText = 'No matching addresses found';
        menu.appendChild(item);
      } else {
        data.forEach(item => {
          const lat = parseFloat(item.lat);
          const lon = parseFloat(item.lon);
          const formattedCoords = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;

          const div = document.createElement('div');
          div.style.padding = '0.65rem 0.75rem';
          div.style.cursor = 'pointer';
          div.style.fontSize = '0.85rem';
          div.style.display = 'flex';
          div.style.alignItems = 'center';
          div.style.gap = '0.5rem';
          div.style.borderBottom = '1px solid rgba(255,255,255,0.02)';
          div.style.transition = 'background 0.2s';
          div.style.color = '#e2e8f0';

          div.innerHTML = `
            <span style="color: var(--color-primary); font-size: 0.95rem;">📍</span>
            <div style="display: flex; flex-direction: column;">
              <strong>${item.display_name}</strong>
              <span style="font-size: 0.7rem; color: var(--color-text-muted);">OSM Verified &bull; ${formattedCoords}</span>
            </div>
          `;

          div.addEventListener('mouseenter', () => {
            div.style.background = 'rgba(255,255,255,0.04)';
          });
          div.addEventListener('mouseleave', () => {
            div.style.background = 'transparent';
          });

          div.addEventListener('click', () => {
            addressInput.value = item.display_name;
            if (coordsInput) {
              coordsInput.value = formattedCoords;
              coordsInput.style.borderColor = 'var(--color-primary)';
            }
            menu.classList.add('hidden');
            statusEl.innerText = `✓ Address and GPS coordinates verified via OpenStreetMap`;
            statusEl.classList.remove('hidden');
            setTimeout(() => {
              statusEl.classList.add('hidden');
            }, 4000);
          });

          menu.appendChild(div);
        });
      }
      menu.classList.remove('hidden');
    } catch (err) {
      console.error("OSM geocoding error:", err);
    }
  };

  const debouncedUpdate = debounce(updateSuggestions, 300);

  addressInput.addEventListener('input', debouncedUpdate);
  addressInput.addEventListener('focus', debouncedUpdate);

  // Hide autocomplete menu when clicking outside
  document.addEventListener('click', (e) => {
    if (e.target !== addressInput && !menu.contains(e.target)) {
      menu.classList.add('hidden');
    }
  });
}

// parseCoords and getHaversineDistance are loaded from services.js

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

// Main-thread fuzzyMatchText removed. Offloaded to worker.js.

// ----------------------------------------------------
// 6. Admin Panel Operations
// ----------------------------------------------------
let selectedAdminProfileId = null;

function populateAdminInviterDropdown() {
  const selectEl = document.getElementById('select-admin-create-inviter');
  if (!selectEl) return;
  selectEl.innerHTML = '';

  // Sort profiles by username for easy lookup
  const sortedProfiles = [...db.profiles].sort((a, b) => a.username.localeCompare(b.username));

  sortedProfiles.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.innerText = `@${p.username} (Rep: ${formatRep(p.reputation_score)})`;
    selectEl.appendChild(option);
  });

  makeSelectSearchable('select-admin-create-inviter', 'Type to search inviter...');
}

function populateAdminManageUserDropdown() {
  const selectEl = document.getElementById('select-admin-manage-user');
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">-- Choose Profile to Edit --</option>';

  // Sort profiles by username for easy lookup
  const sortedProfiles = [...db.profiles].sort((a, b) => a.username.localeCompare(b.username));

  sortedProfiles.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.innerText = `@${p.username} (${p.is_active ? 'Active' : 'Suspended'}, Rep: ${formatRep(p.reputation_score)})`;
    selectEl.appendChild(option);
  });
  
  makeSelectSearchable('select-admin-manage-user', 'Type to search profile...');
}

function initAdminPanel() {
  const alphaVal = getLineageAlpha();
  const slider = document.getElementById('admin-lineage-alpha');
  const display = document.getElementById('admin-alpha-value');
  if (slider && display) {
    slider.value = alphaVal;
    display.innerText = alphaVal.toFixed(2);
  }
  
  // Hide System Invite generator for standard moderators (only root moderator is authorized)
  const isRoot = currentUser.id === '00000000-0000-0000-0000-000000000001';
  const systemInviteSection = document.getElementById('admin-system-invite-section');
  if (systemInviteSection) {
    if (isRoot) {
      systemInviteSection.classList.remove('hidden');
    } else {
      systemInviteSection.classList.add('hidden');
    }
  }

  populateAdminInviterDropdown();
  populateAdminManageUserDropdown();
  renderAdminInviteGraph();
  resetAdminProfileDetails();
  renderAdminReleasedList();
}

function renderAdminReleasedList() {
  const container = document.getElementById('admin-released-list');
  if (!container) return;
  container.innerHTML = '';

  // Get all accounts that were originally invited by a moderator, and released by a moderator
  const isModProfile = (profileId) => {
    if (!profileId) return false;
    const parent = db.profiles.find(p => p.id === profileId);
    return parent && (parent.role === 'key_root_moderator' || parent.role === 'moderator');
  };

  const releasedProfiles = db.profiles.filter(p => p.released_by && isModProfile(p.released_by));

  if (releasedProfiles.length === 0) {
    container.innerHTML = '<div class="details-placeholder" style="text-align:center; padding:1rem 0; font-size: 0.8rem;">No released standalone accounts.</div>';
  } else {
    releasedProfiles.forEach(p => {
      const originalInviter = db.profiles.find(inv => inv.id === p.originally_invited_by);
      const releaser = db.profiles.find(rel => rel.id === p.released_by);
      
      const originalInviterName = originalInviter ? '@' + originalInviter.username : 'Unknown';
      const releaserName = releaser ? '@' + releaser.username : 'Unknown';

      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.style.padding = '0.5rem 0.75rem';
      item.style.background = 'rgba(255,255,255,0.02)';
      item.style.border = '1px solid var(--border-color)';
      item.style.borderRadius = 'var(--radius-sm)';

      item.innerHTML = `
        <div>
          <div style="font-size: 0.85rem; font-weight: 600; color: white;">@${p.username} (Standalone)</div>
          <div style="font-size: 0.72rem; color: var(--color-text-dim);">Originally Invited by: ${originalInviterName} &bull; Released by: ${releaserName}</div>
        </div>
        <div>
          <span class="badge privacy-badge" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">Released</span>
        </div>
      `;
      container.appendChild(item);
    });
  }
}

function resetAdminProfileDetails() {
  selectedAdminProfileId = null;
  const content = document.getElementById('admin-user-details-content');
  const placeholder = document.querySelector('#admin-user-details-panel .details-placeholder');
  if (content && placeholder) {
    content.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }
  const selectEl = document.getElementById('select-admin-manage-user');
  if (selectEl) {
    selectEl.value = '';
    makeSelectSearchable('select-admin-manage-user', 'Type to search profile...');
  }
}

function renderAdminInviteGraph() {
  const container = document.getElementById('admin-invite-graph');
  if (!container) return;
  container.innerHTML = '';

  const buildTreeHTML = (parentId, depth) => {
    let children = db.profiles.filter(p => p.invited_by === parentId);
    if (children.length === 0) return '';

    let html = '<div class="node-tree">';
    children.forEach(child => {
      let isSelected = child.id === selectedAdminProfileId ? 'selected' : '';
      let isActiveClass = child.is_active ? 'active' : 'inactive';
      let padding = depth * 15;
      
      html += `
        <div class="node-row" style="margin-left: ${padding}px">
          <div class="node-item ${isSelected} ${isActiveClass}" onclick="selectAdminProfile('${child.id}')">
            <span class="node-dot"></span>
            <span class="node-name">${child.username}</span>
            <span class="node-rep">${formatRep(child.reputation_score)}</span>
          </div>
        </div>
      `;
      html += buildTreeHTML(child.id, depth + 1);
    });
    html += '</div>';
    return html;
  };

  let rootProfiles = db.profiles.filter(p => p.invited_by === null);
  let graphHTML = '<div class="node-tree">';
  rootProfiles.forEach(root => {
    let isSelected = root.id === selectedAdminProfileId ? 'selected' : '';
    let isActiveClass = root.is_active ? 'active' : 'inactive';
    graphHTML += `
      <div class="node-row">
        <div class="node-item ${isSelected} ${isActiveClass}" onclick="selectAdminProfile('${root.id}')">
          <span class="node-dot"></span>
          <span class="node-name">${root.username}</span>
          <span class="node-rep">${formatRep(root.reputation_score)}</span>
        </div>
      </div>
    `;
    graphHTML += buildTreeHTML(root.id, 1);
  });
  graphHTML += '</div>';

  container.innerHTML = graphHTML;
  const countEl = document.getElementById('admin-user-count');
  if (countEl) {
    countEl.innerText = `${db.profiles.length} Profiles`;
  }
}

window.selectAdminProfile = function(profileId) {
  selectedAdminProfileId = profileId;
  renderAdminInviteGraph();
  
  const selectEl = document.getElementById('select-admin-manage-user');
  if (selectEl && selectEl.value !== profileId) {
    selectEl.value = profileId;
    makeSelectSearchable('select-admin-manage-user', 'Type to search profile...');
  }
  
  const content = document.getElementById('admin-user-details-content');
  const placeholder = document.querySelector('#admin-user-details-panel .details-placeholder');
  
  const profile = db.profiles.find(p => p.id === profileId);
  if (!profile) {
    if (content) content.classList.add('hidden');
    if (placeholder) placeholder.classList.remove('hidden');
    return;
  }

  if (placeholder) placeholder.classList.add('hidden');
  if (content) content.classList.remove('hidden');

  document.getElementById('admin-detail-username').innerText = '@' + profile.username;
  
  const statusBadge = document.getElementById('admin-detail-status');
  if (profile.is_active) {
    statusBadge.innerText = 'Active';
    statusBadge.className = 'status-indicator';
  } else {
    statusBadge.className = 'status-indicator inactive';
    if (profile.suspended_until) {
      const timeLeft = Math.max(0, profile.suspended_until - Date.now());
      const hoursLeft = (timeLeft / (1000 * 60 * 60)).toFixed(1);
      statusBadge.innerText = `Suspended (${hoursLeft}h left)`;
    } else {
      statusBadge.innerText = 'Suspended (Permanent)';
    }
  }

  document.getElementById('admin-detail-reputation').innerText = formatRep(profile.reputation_score);
  
  const inviter = db.profiles.find(p => p.id === profile.invited_by);
  document.getElementById('admin-detail-invited-by').innerText = inviter ? inviter.username : 'Root Network Admin';

  // Pre-populate base reputation input and set toggle status button text
  const inputBaseRep = document.getElementById('input-admin-base-rep');
  if (inputBaseRep) {
    inputBaseRep.value = formatRep(profile.base_reputation);
  }

  const btnToggleStatus = document.getElementById('btn-admin-toggle-status');
  if (btnToggleStatus) {
    btnToggleStatus.innerText = profile.is_active ? 'Suspend User' : 'Reactivate User';
  }

  // Safety controls configuration for root moderator & role hierarchy
  const targetIsMod = profile.role === 'key_root_moderator' || profile.role === 'moderator';
  const currentUserIsRoot = currentUser.role === 'key_root_moderator';
  const disableModActions = targetIsMod && !currentUserIsRoot;
  
  const isRootUser = profile.role === 'key_root_moderator';
  const shouldDisable = isRootUser || disableModActions;

  // Populate the role dropdown and apply button status
  const selectRoleRelation = document.getElementById('select-admin-role-relation');
  if (selectRoleRelation) {
    if (profile.role === 'key_root_moderator' || profile.role === 'moderator') {
      selectRoleRelation.value = 'moderator';
    } else if (profile.role === 'user' && profile.invited_by === null) {
      selectRoleRelation.value = 'released';
    } else {
      selectRoleRelation.value = 'user';
    }
  }
  
  const btnRevoke = document.getElementById('btn-admin-revoke-user');
  if (btnRevoke) btnRevoke.disabled = false;
  
  const btnDelete = document.getElementById('btn-admin-delete-user');
  if (btnDelete) btnDelete.disabled = false;
  
  if (btnToggleStatus) btnToggleStatus.disabled = false;
  
  const btnUpdateRep = document.getElementById('btn-admin-update-rep');
  if (btnUpdateRep) btnUpdateRep.disabled = false;

  // Render selected user's reviews in details panel
  const userReviewsContainer = document.getElementById('admin-user-reviews-container');
  const userReviewsList = document.getElementById('admin-user-reviews-list');
  
  if (userReviewsContainer && userReviewsList) {
    userReviewsList.innerHTML = '';
    const userReviews = db.reviews.filter(r => r.author_id === profile.id);
    
    if (userReviews.length === 0) {
      userReviewsList.innerHTML = '<div style="font-size: 0.8rem; color: var(--color-text-dim); text-align: center; padding: 0.5rem 0;">No reviews posted yet.</div>';
    } else {
      userReviews.forEach(r => {
        const node = db.nodes.find(n => n.id === r.node_id);
        const nodeName = node ? node.name : 'Unknown Node';
        
        const item = document.createElement('div');
        item.style.background = 'rgba(255,255,255,0.02)';
        item.style.border = '1px solid var(--border-color)';
        item.style.borderRadius = 'var(--radius-sm)';
        item.style.padding = '0.5rem';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.gap = '0.5rem';
        
        item.innerHTML = `
          <div style="flex: 1; min-width: 0; text-align: left;">
            <div style="font-size: 0.8rem; font-weight: 600; color: white; word-wrap: break-word;">${nodeName}</div>
            <div style="font-size: 0.72rem; color: var(--color-text-dim); white-space: normal; word-wrap: break-word; margin-top: 0.25rem;">${r.raw_content}</div>
          </div>
          <button class="btn btn-danger" onclick="deleteReviewFromConsole('${r.id}')" style="padding: 0.25rem 0.5rem; font-size: 0.72rem; width: auto; background: transparent; border: 1px solid var(--color-danger); color: var(--color-danger); border-radius: var(--radius-sm); align-self: flex-start;">Delete</button>
        `;
        userReviewsList.appendChild(item);
      });
    }
    userReviewsContainer.classList.remove('hidden');
  }
};

window.deleteReviewFromConsole = async function(reviewId) {
  if (!(await showConfirm("Are you sure you want to permanently delete this review?", "Delete Review"))) {
    return;
  }
  
  db.reviews = db.reviews.filter(r => r.id !== reviewId);
  db.vouches_disputes = db.vouches_disputes.filter(v => v.review_id !== reviewId);
  db.review_tags = db.review_tags.filter(rt => rt.review_id !== reviewId);

  await saveDbState();
  populateAdminInviterDropdown();
  populateAdminManageUserDropdown();
  renderAdminInviteGraph();
  if (selectedAdminProfileId) {
    selectAdminProfile(selectedAdminProfileId);
  }
  renderGlobalReviewsManager();
  window.dispatchEvent(new Event('storage'));

  // Delete from database
  fetch('https://api.inviteonlyreviews.com/api/reviews', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({
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
  
  alert("Review successfully deleted.");
};

function renderGlobalReviewsManager() {
  const listEl = document.getElementById('admin-global-reviews-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const reviews = [...db.reviews].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  if (reviews.length === 0) {
    listEl.innerHTML = '<div style="font-size: 0.85rem; color: var(--color-text-dim); text-align: center; padding: 1.5rem 0;">No reviews published in the network yet.</div>';
    return;
  }

  reviews.forEach(r => {
    const author = db.profiles.find(p => p.id === r.author_id);
    const authorName = author ? author.username : 'deactivated_user';
    const node = db.nodes.find(n => n.id === r.node_id);
    const nodeName = node ? node.name : 'Unknown Space';
    
    const card = document.createElement('div');
    card.style.background = 'rgba(255,255,255,0.02)';
    card.style.border = '1px solid var(--border-color)';
    card.style.borderRadius = 'var(--radius-md)';
    card.style.padding = '0.75rem 1rem';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '0.4rem';
    
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.25rem;">
        <span style="font-size: 0.72rem; color: var(--color-primary); font-family: var(--font-mono);">${nodeName}</span>
        <span style="font-size: 0.72rem; color: var(--color-text-dim);">${new Date(r.created_at || Date.now()).toLocaleDateString()}</span>
      </div>
      <div style="font-size: 0.8rem; color: white; line-height: 1.4; text-align: left;">
        <strong>@${authorName}</strong>: ${r.raw_content}
      </div>
      <div style="display: flex; justify-content: flex-end; margin-top: 0.25rem;">
        <button class="btn btn-danger" onclick="deleteReviewFromGlobal('${r.id}')" style="padding: 0.2rem 0.6rem; font-size: 0.7rem; width: auto; background: transparent; border: 1px solid var(--color-danger); color: var(--color-danger); border-radius: var(--radius-sm);">🗑&nbsp;Purge Post</button>
      </div>
    `;
    listEl.appendChild(card);
  });
}

window.deleteReviewFromGlobal = async function(reviewId) {
  if (!(await showConfirm("Are you sure you want to permanently delete this post from the network?", "Delete Review"))) {
    return;
  }
  
  db.reviews = db.reviews.filter(r => r.id !== reviewId);
  db.vouches_disputes = db.vouches_disputes.filter(v => v.review_id !== reviewId);
  db.review_tags = db.review_tags.filter(rt => rt.review_id !== reviewId);

  await saveDbState();
  
  // Refresh views
  populateAdminInviterDropdown();
  populateAdminManageUserDropdown();
  renderAdminInviteGraph();
  renderGlobalReviewsManager();
  
  if (selectedAdminProfileId) {
    selectAdminProfile(selectedAdminProfileId);
  }
  
  window.dispatchEvent(new Event('storage'));

  // Delete from database
  fetch('https://api.inviteonlyreviews.com/api/reviews', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({
      reviewId: reviewId
    })
  }).then(res => {
    if (res.ok) {
      syncLiveReviews();
    } else {
      res.json().then(data => alert("Warning: Post deleted locally but failed to sync from database: " + (data.error || "Unknown error")));
    }
  }).catch(err => {
    console.error("Failed to delete review:", err);
  });
  
  alert("Post successfully deleted.");
};

// Event Listeners for Admin operations
document.getElementById('btn-admin-revoke-user')?.addEventListener('click', async () => {
  if (!selectedAdminProfileId) return;
  const target = db.profiles.find(p => p.id === selectedAdminProfileId);
  if (!target || !target.is_active) return;

  const targetIsMod = target.role === 'key_root_moderator' || target.role === 'moderator';
  const currentUserIsRoot = currentUser.role === 'key_root_moderator';
  if (targetIsMod && !currentUserIsRoot) {
    alert("Safety constraint: Standard moderators cannot revoke or modify other moderator profiles.");
    return;
  }

  if (target.id === '00000000-0000-0000-0000-000000000001') {
    alert("Safety constraint: Cannot revoke root moderator.");
    return;
  }

  if (!(await showConfirm(`Are you sure you want to cascade-revoke ${target.username} and ALL accounts spawned in their invitation branch?`, "Cascade Revoke Branch"))) {
    return;
  }

  const snapshot = getDbProfilesSnapshot();

  let revokedList = [];
  const gatherDescendants = (id) => {
    let children = db.profiles.filter(p => p.invited_by === id && p.is_active);
    children.forEach(c => {
      revokedList.push(c);
      gatherDescendants(c.id);
    });
  };

  revokedList.push(target);
  gatherDescendants(target.id);

  revokedList.forEach(p => {
    p.is_active = false;
    p.reputation_score = 0.0000;
    p.suspended_until = null;
  });

  await saveDbState();

  // Sync to Supabase via CF Worker

  populateAdminInviterDropdown();
  populateAdminManageUserDropdown();
  renderAdminInviteGraph();
  selectAdminProfile(selectedAdminProfileId);
  
  // Update other views via event trigger
  window.dispatchEvent(new Event('storage'));
  
  alert(`Successfully cascade-revoked ${revokedList.length} profiles: ${revokedList.map(r => '@' + r.username).join(', ')}`);
});

document.getElementById('btn-admin-create-system-invite')?.addEventListener('click', async () => {
  const rawToken = 'tkn_system_' + Math.random().toString(36).substr(2, 16);
  if (!currentUser) {
    alert('Error: You must be logged in to generate invite tokens.');
    return;
  }

  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/generate-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        rawToken: rawToken,
        inviterUsername: 'root_moderator'
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to generate system token on Cloudflare Worker.');
    }

    const encoder = new TextEncoder();
    const tokenData = encoder.encode(rawToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', tokenData);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    db.invite_tokens.push({
      token: hashHex,
      inviter_id: '00000000-0000-0000-0000-000000000001',
      is_used: false,
      expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
      rawToken: rawToken
    });

    await saveDbState();

    const outputDiv = document.getElementById('admin-invite-token-output');
    if (outputDiv) outputDiv.classList.remove('hidden');
    const genToken = document.getElementById('admin-generated-token');
    if (genToken) genToken.innerText = rawToken;

    alert(`✓ Root/Moderator invite token generated: ${rawToken}`);
  } catch (err) {
    alert('Error generating system invite: ' + err.message);
  }
});

document.getElementById('btn-admin-create-behalf-invite')?.addEventListener('click', async () => {
  if (!selectedAdminProfileId) return;
  const profile = db.profiles.find(p => p.id === selectedAdminProfileId);
  if (!profile || !profile.is_active) return;

  const myTokens = db.invite_tokens.filter(t => t.inviter_id === profile.id);
  const isTargetMod = profile.role === 'key_root_moderator' || profile.role === 'moderator';
  if (myTokens.length >= 5 && !isTargetMod) {
    alert(`Quota reached: @${profile.username} cannot generate more than 5 invite tokens.`);
    return;
  }

  const rawToken = 'tkn_' + Math.random().toString(36).substr(2, 16);
  if (!currentUser) {
    alert('Error: You must be logged in to generate invite tokens.');
    return;
  }

  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/generate-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        rawToken: rawToken,
        inviterUsername: profile.username
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to generate token on Cloudflare Worker.');
    }

    const encoder = new TextEncoder();
    const tokenData = encoder.encode(rawToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', tokenData);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    db.invite_tokens.push({
      token: hashHex,
      inviter_id: profile.id,
      is_used: false,
      expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
      rawToken: rawToken
    });

    await saveDbState();

    const outputDiv = document.getElementById('admin-invite-token-output');
    if (outputDiv) outputDiv.classList.remove('hidden');
    const genToken = document.getElementById('admin-generated-token');
    if (genToken) genToken.innerText = rawToken;

    alert(`✓ Invite token generated on behalf of @${profile.username}: ${rawToken}`);
  } catch (err) {
    alert('Error generating invite: ' + err.message);
  }
});

document.getElementById('btn-admin-copy-token')?.addEventListener('click', () => {
  const codeText = document.getElementById('admin-generated-token').innerText;
  navigator.clipboard.writeText(codeText);
  alert(`Invite token copied: ${codeText}`);
});

document.getElementById('admin-lineage-alpha')?.addEventListener('input', async (e) => {
  const val = parseFloat(e.target.value);
  document.getElementById('admin-alpha-value').innerText = val.toFixed(2);
  
  await window.saveSettings({ lineageAlpha: val });

  renderAdminInviteGraph();
  if (selectedAdminProfileId) {
    selectAdminProfile(selectedAdminProfileId);
  }
  
  window.dispatchEvent(new Event('storage'));
});

// Direct user profile creation from admin console
document.getElementById('btn-admin-create-user')?.addEventListener('click', async () => {
  const usernameInput = document.getElementById('input-admin-create-username').value.trim();
  const baseRepInput = document.getElementById('input-admin-create-base-rep').value.trim();
  const parentId = document.getElementById('select-admin-create-inviter').value;
  const suffixInput = document.getElementById('input-admin-create-key-suffix').value.trim();

  if (!usernameInput) {
    alert("Error: Username cannot be empty.");
    return;
  }

  const regex = /^[A-Za-z0-9_]{3,15}$/;
  if (!regex.test(usernameInput)) {
    alert("Error: Username must be 3-15 chars (alphanumeric/underline).");
    return;
  }

  if (db.profiles.some(p => p.username.toLowerCase() === usernameInput.toLowerCase())) {
    alert("Error: Username is already taken.");
    return;
  }

  const baseRep = parseFloat(baseRepInput);
  if (isNaN(baseRep) || baseRep < 0) {
    alert("Error: Base Reputation must be a valid number >= 0.");
    return;
  }

  const parentProfile = db.profiles.find(p => p.id === parentId);
  if (!parentProfile) {
    alert("Error: Selected parent profile does not exist.");
    return;
  }

  let suffix = suffixInput;
  if (!suffix) {
    // Generate secure random suffix (16 hex chars)
    const randomArray = new Uint32Array(2);
    window.crypto.getRandomValues(randomArray);
    suffix = Array.from(randomArray).map(n => n.toString(16).padStart(8, '0')).join('');
  } else {
    const alphanumericRegex = /^[a-zA-Z0-9]+$/;
    if (suffix.length < 6) {
      alert("Error: Custom key suffix must be at least 6 characters long.");
      return;
    }
    if (!alphanumericRegex.test(suffix)) {
      alert("Error: Custom key suffix must be alphanumeric only (letters and numbers, no spaces).");
      return;
    }
  }

  const newId = crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-0000-0000-000000' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  const accessKey = `key_${usernameInput}_${suffix}`;

  const newProfile = {
    id: newId,
    username: usernameInput,
    reputation_score: baseRep,
    base_reputation: baseRep,
    invited_by: parentProfile.id,
    is_active: true,
    access_key: accessKey,
    demographic_group: document.getElementById('select-admin-create-demographic')?.value || 'urban_affluent'
  };

  // Sync direct profile creation to Supabase
  await createProfileOnEdge({
    id: newId,
    username: usernameInput,
    reputation_score: baseRep,
    invited_by: parentProfile.id,
    is_active: true,
    access_key: accessKey,
    demographic_group: newProfile.demographic_group
  });

  const snapshot = getDbProfilesSnapshot();

  db.profiles.push(newProfile);

  saveDbState();

  // Sync downstream reputation changes

  // Clear form fields
  document.getElementById('input-admin-create-username').value = '';
  document.getElementById('input-admin-create-base-rep').value = '1.0';
  document.getElementById('input-admin-create-key-suffix').value = '';

  populateAdminInviterDropdown();
  populateAdminManageUserDropdown();
  renderAdminInviteGraph();
  
  // Update other views via event trigger
  window.dispatchEvent(new Event('storage'));

  showAccessKeyModal('✓ Profile successfully created directly!', `Username: @${usernameInput}\n\nPlease copy and save the Access Key below:`, accessKey);
});

// Toggle user status (suspend / reactivate)
document.getElementById('btn-admin-toggle-status')?.addEventListener('click', async () => {
  if (!selectedAdminProfileId) return;
  const target = db.profiles.find(p => p.id === selectedAdminProfileId);
  if (!target) return;

  const targetIsMod = target.role === 'key_root_moderator' || target.role === 'moderator';
  const currentUserIsRoot = currentUser.role === 'key_root_moderator';
  if (targetIsMod && !currentUserIsRoot) {
    alert("Safety constraint: Standard moderators cannot revoke or modify other moderator profiles.");
    return;
  }

  if (target.id === '00000000-0000-0000-0000-000000000001') {
    alert("Safety constraint: Cannot suspend root moderator.");
    return;
  }

  const snapshot = getDbProfilesSnapshot();

  const newStatus = !target.is_active;
  target.is_active = newStatus;
  
  if (!newStatus) {
    target.reputation_score = 0.0000;
    const durationSelect = document.getElementById('select-admin-suspend-duration');
    const duration = durationSelect ? durationSelect.value : 'permanent';
    if (duration === '1h') {
      target.suspended_until = Date.now() + 60 * 60 * 1000;
    } else if (duration === '24h') {
      target.suspended_until = Date.now() + 24 * 60 * 60 * 1000;
    } else if (duration === '7d') {
      target.suspended_until = Date.now() + 7 * 24 * 60 * 60 * 1000;
    } else {
      target.suspended_until = null; // permanent
    }
  } else {
    target.suspended_until = null;
  }

  saveDbState();

  // Sync state & downstream reputation decay changes

  populateAdminInviterDropdown();
  populateAdminManageUserDropdown();
  renderAdminInviteGraph();
  selectAdminProfile(selectedAdminProfileId);

  // Update other views via event trigger
  window.dispatchEvent(new Event('storage'));

  let alertMsg = '';
  if (newStatus) {
    alertMsg = `✓ Account @${target.username} has been reactivated.`;
  } else {
    const durationSelect = document.getElementById('select-admin-suspend-duration');
    const durationText = durationSelect ? durationSelect.options[durationSelect.selectedIndex].text : 'Permanent';
    alertMsg = `✓ Account @${target.username} has been suspended (${durationText}).`;
  }
  alert(alertMsg);
});

// Manual base reputation override
document.getElementById('btn-admin-update-rep')?.addEventListener('click', async () => {
  if (!selectedAdminProfileId) return;
  const target = db.profiles.find(p => p.id === selectedAdminProfileId);
  if (!target) return;

  const targetIsMod = target.role === 'key_root_moderator' || target.role === 'moderator';
  const currentUserIsRoot = currentUser.role === 'key_root_moderator';
  if (targetIsMod && !currentUserIsRoot) {
    alert("Safety constraint: Standard moderators cannot revoke or modify other moderator profiles.");
    return;
  }

  const newRepVal = parseFloat(document.getElementById('input-admin-base-rep').value);
  if (isNaN(newRepVal) || newRepVal < 0) {
    alert("Error: Base reputation must be a valid number >= 0.");
    return;
  }

  const snapshot = getDbProfilesSnapshot();

  target.base_reputation = newRepVal;

  saveDbState();

  // Sync manual reputation and cascading decay updates to Supabase

  populateAdminInviterDropdown();
  renderAdminInviteGraph();
  selectAdminProfile(selectedAdminProfileId);

  // Update other views via event trigger
  window.dispatchEvent(new Event('storage'));

  alert(`✓ Base reputation for @${target.username} successfully updated to ${newRepVal.toFixed(4)}.`);
});

// Purge profile and re-link children to parent inviter
document.getElementById('btn-admin-delete-user')?.addEventListener('click', async () => {
  if (!selectedAdminProfileId) return;
  const target = db.profiles.find(p => p.id === selectedAdminProfileId);
  if (!target) return;

  const targetIsMod = target.role === 'key_root_moderator' || target.role === 'moderator';
  const currentUserIsRoot = currentUser.role === 'key_root_moderator';
  if (targetIsMod && !currentUserIsRoot) {
    alert("Safety constraint: Standard moderators cannot revoke or modify other moderator profiles.");
    return;
  }

  if (target.id === '00000000-0000-0000-0000-000000000001') {
    alert("Safety constraint: Cannot purge root moderator.");
    return;
  }

  if (!(await showConfirm(`Are you sure you want to permanently purge the profile @${target.username}? This action is irreversible.\nDownstream profiles will be re-linked to @${target.username}'s inviter to preserve graph integrity.`, "Purge Profile"))) {
    return;
  }

  const parentInviterId = target.invited_by;
  const snapshot = getDbProfilesSnapshot();

  // Re-link direct downstream children to target's parent
  db.profiles.forEach(p => {
    if (p.invited_by === target.id) {
      p.invited_by = parentInviterId;
    }
  });

  // Purge profile locally
  db.profiles = db.profiles.filter(p => p.id !== target.id);

  // Purge unused tokens generated by target locally
  db.invite_tokens = db.invite_tokens.filter(t => t.inviter_id !== target.id || t.is_used);

  // Sync deletion and re-linking changes to Supabase

  await deleteProfileOnEdge(target.id);

  resetAdminProfileDetails();

  saveDbState();
  populateAdminInviterDropdown();
  populateAdminManageUserDropdown();
  renderAdminInviteGraph();

  // Update other views via event trigger
  window.dispatchEvent(new Event('storage'));

  alert(`✓ Profile @${target.username} has been permanently purged and descendants re-linked.`);
});

// Quick select manage user dropdown change listener
document.getElementById('select-admin-manage-user')?.addEventListener('change', (e) => {
  const profileId = e.target.value;
  if (profileId) {
    selectAdminProfile(profileId);
  } else {
    resetAdminProfileDetails();
  }
});

// Apply user role & relation change
document.getElementById('btn-admin-apply-role-relation')?.addEventListener('click', async () => {
  if (!selectedAdminProfileId) return;
  const target = db.profiles.find(p => p.id === selectedAdminProfileId);
  if (!target) return;

  const targetIsMod = target.role === 'key_root_moderator' || target.role === 'moderator';
  const currentUserIsRoot = currentUser.role === 'key_root_moderator';
  if (targetIsMod && !currentUserIsRoot) {
    alert("Safety constraint: Standard moderators cannot modify other moderator profiles.");
    return;
  }

  if (target.id === '00000000-0000-0000-0000-000000000001') {
    alert("Safety constraint: Cannot modify root moderator.");
    return;
  }

  const selectRoleRelation = document.getElementById('select-admin-role-relation');
  if (!selectRoleRelation) return;
  const selectedVal = selectRoleRelation.value;

  const snapshot = getDbProfilesSnapshot();

  let successMsg = '';

  if (selectedVal === 'user') {
    target.role = 'user';
    // If they were released, re-link back to their original inviter or the current admin
    if (target.invited_by === null || target.invited_by === 'null') {
      target.invited_by = target.originally_invited_by || target.released_by || currentUser.id;
    }
    target.released_by = null;
    successMsg = `✓ Account @${target.username} role updated to Standard User.`;
  } else if (selectedVal === 'moderator') {
    if (!currentUserIsRoot) {
      alert("Only Root Network Admin can promote users to moderator.");
      return;
    }
    target.role = 'moderator';
    // Ensure they have an inviter even if they were released previously
    if (target.invited_by === null || target.invited_by === 'null') {
      target.invited_by = target.originally_invited_by || target.released_by || currentUser.id;
    }
    target.released_by = null;
    successMsg = `✓ Account @${target.username} role updated to Moderator.`;
  } else if (selectedVal === 'released') {
    target.role = 'user';
    if (target.invited_by !== null && target.invited_by !== 'null') {
      target.originally_invited_by = target.invited_by;
      target.released_by = currentUser.id;
    }
    target.invited_by = null;
    successMsg = `✓ Account @${target.username} has been freed (released) as a standalone account.`;
  }

  saveDbState();

  // Sync changes to Supabase
  try {

  } catch (err) {
    alert("Warning: Failed to sync changes to database: " + err.message);
  }

  populateAdminInviterDropdown();
  populateAdminManageUserDropdown();
  renderAdminInviteGraph();
  renderAdminReleasedList();
  selectAdminProfile(selectedAdminProfileId);

  // Update other views via event trigger
  window.dispatchEvent(new Event('storage'));

  alert(successMsg);
});

// Toggle global reviews manager visibility
document.getElementById('btn-toggle-global-reviews')?.addEventListener('click', () => {
  const section = document.getElementById('admin-global-reviews-section');
  if (section) {
    const isHidden = section.classList.toggle('hidden');
    const toggleBtn = document.getElementById('btn-toggle-global-reviews');
    if (toggleBtn) {
      toggleBtn.innerHTML = isHidden ? '<span>📝</span> View All Posts' : '<span>📝</span> Hide All Posts';
    }
    if (!isHidden) {
      renderGlobalReviewsManager();
    }
  }
});

document.getElementById('btn-close-global-reviews')?.addEventListener('click', () => {
  const section = document.getElementById('admin-global-reviews-section');
  if (section) {
    section.classList.add('hidden');
  }
  const toggleBtn = document.getElementById('btn-toggle-global-reviews');
  if (toggleBtn) {
    toggleBtn.innerHTML = '<span>📝</span> View All Posts';
  }
});

// Initialize profile PoE media upload listeners and visibility toggles
const gpsCheckbox = document.getElementById('chk-profile-gps');
const ocrCheckbox = document.getElementById('chk-profile-ocr');
const mediaGroup = document.getElementById('poe-profile-media-group');
const uploadInput = document.getElementById('poe-profile-image-upload');
const previewContainer = document.getElementById('poe-profile-preview-container');

if (gpsCheckbox && ocrCheckbox && mediaGroup) {
  const updatePoeMediaVisibility = () => {
    if (gpsCheckbox.checked || ocrCheckbox.checked) {
      mediaGroup.classList.remove('hidden');
      if (gpsCheckbox.checked) {
        uploadInput.setAttribute('accept', 'image/jpeg, image/jpg, image/heic, image/heif');
        if (profileUploadedFiles && profileUploadedFiles.length > 0) {
          const allowedExifTypes = ['image/jpeg', 'image/jpg', 'image/heic', 'image/heif'];
          const nonExifFiles = profileUploadedFiles.filter(f => {
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
      profileUploadedFiles = [];
    }
  };

  gpsCheckbox.addEventListener('change', updatePoeMediaVisibility);
  ocrCheckbox.addEventListener('change', updatePoeMediaVisibility);
}

if (uploadInput && previewContainer) {
  uploadInput.addEventListener('change', (e) => {
    previewContainer.innerHTML = '';
    profileUploadedFiles = Array.from(e.target.files);
    
    const allowedExifTypes = ['image/jpeg', 'image/jpg', 'image/heic', 'image/heif'];
    const nonExifFiles = profileUploadedFiles.filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      const isAllowedExt = ['jpeg', 'jpg', 'heic', 'heif'].includes(ext);
      const isAllowedMime = allowedExifTypes.includes(f.type);
      return !isAllowedExt && !isAllowedMime;
    });

    if (gpsCheckbox && gpsCheckbox.checked && nonExifFiles.length > 0) {
      alert("Warning: For GPS proximity verification, formats like .webp, .png, and .gif rarely contain native EXIF GPS data. Please ensure you are uploading original, unedited photos directly from your phone (.JPG or .HEIC).");
    }
    
    profileUploadedFiles.forEach((file) => {
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

// Initial boot
async function initPage() {
  await loadDbState();
  await window.loadSettings();
  await window.loadFollows();

  try {
    const res = await fetch('https://api.inviteonlyreviews.com/api/auth/verify', {
      method: 'POST',
      credentials: 'include'
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.profile && data.profile.is_active) {
        currentUser = data.profile;
      } else {
        currentUser = null;
      }
    } else {
      currentUser = null;
    }
  } catch (err) {
    console.error("Session verification failed on startup:", err);
    currentUser = null;
  }

  checkAuthentication();
}

initPage();
