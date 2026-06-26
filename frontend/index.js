// index.js - Production Portal Logic
// Handles tab navigation, forum feed rendering, tag filtering, directory explorer, and user settings

// Background worker for CPU-heavy tasks is initialized in services.js

// db and currentUser are defined globally in services.js
let activeTagFilter = null;
let currentDirectoryPath = []; // Array of node objects representing breadcrumb trail
let selectedUserId = null;
let uploadedFiles = [];
window.managementModeActive = false;

function loadFollows() {
  return window.follows || [];
}

async function saveFollows(follows) {
  await window.saveFollows(follows);
}

window.toggleFollowUser = async function(userId, event) {
  if (event) event.stopPropagation();
  let follows = loadFollows();
  const idx = follows.indexOf(userId);
  if (idx > -1) {
    follows.splice(idx, 1);
  } else {
    follows.push(userId);
  }
  await saveFollows(follows);
  
  // Re-render active views
  const activeTab = document.querySelector('.nav-tab-btn.active')?.getAttribute('data-tab');
  if (activeTab === 'feed-view') {
    renderFeedReviews();
  } else if (activeTab === 'following-view') {
    renderFollowingFeed();
  }
};

// syncLiveReviews, syncLiveProfiles, and checkSuspensions are imported from services.js
window.refreshActiveViews = function() {
  const activeTab = document.querySelector('.nav-tab-btn.active')?.getAttribute('data-tab');
  if (activeTab === 'feed-view') {
    renderFeedReviews();
  } else if (activeTab === 'following-view') {
    renderFollowingFeed();
  } else if (activeTab === 'browse-view') {
    renderDirectoryExplorer();
  }
};

// ----------------------------------------------------
// 2. Identity and Authentication State
// ----------------------------------------------------
function syncCurrentUser() {
  loadDb();
  const userDot = document.querySelector('.user-status-dot');
  const userLabel = document.querySelector('.username-display');
  const guestGate = document.getElementById('submit-guest-gate');
  const submitForm = document.getElementById('submit-form-card');
  const settingsInfo = document.getElementById('settings-user-info');
  const settingsGroup = document.getElementById('settings-user-group');
  const submitRep = document.getElementById('submit-reputation-badge');

  const adminElements = document.querySelectorAll('.admin-only');
  const isAdmin = currentUser && (currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator');
  adminElements.forEach(el => {
    if (isAdmin) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  initializeManagementUI();

  if (currentUser) {
    // Offline safeguard check (deactivated in sandbox)
    if (!currentUser.is_active) {
        fetch('https://api.inviteonlyreviews.com/api/auth/logout', { method: 'POST', credentials: 'include' }).then(() => {
          currentUser = null;
          syncCurrentUser();
        });
        return;
      }

      // Update Header
      if (typeof window.syncSidebarFooter === 'function') {
        window.syncSidebarFooter();
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
              <code style="display:block; font-family:var(--font-mono); color:var(--color-primary); word-break:break-all; font-size:0.85rem; margin-top:0.25rem;">[Protected HttpOnly Session]</code>
            </div>
            <button class="btn btn-secondary" id="btn-settings-logout" style="margin-top:0.5rem;">Sign Out from Device</button>
          </div>
        `;
        document.getElementById('btn-settings-logout').addEventListener('click', async () => {
          try {
            await fetch('https://api.inviteonlyreviews.com/api/auth/logout', { method: 'POST', credentials: 'include' });
          } catch(e) {}
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
              const res = await fetch('https://api.inviteonlyreviews.com/api/profile/update-username', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
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

              // Update local DB profile
              const profile = db.profiles.find(p => p.id === currentUser.id);
              if (profile) {
                profile.username = newUsername;
              }

              await saveDbState();
              currentUser = profile;

              changeNameInput.value = '';

              alert(`✓ Username updated successfully to @${newUsername}!`);
              location.reload();
            } catch (err) {
              console.error(err);
              alert("An error occurred updating username: " + err.message);
            }
          });
          // Demographic cohort update handler
          const demographicSelect = document.getElementById('settings-demographic-select');
          const demographicBtn = document.getElementById('btn-settings-update-demographic');
          const demographicStatus = document.getElementById('demographic-update-status');

          if (demographicSelect && currentUser) {
            // Pre-select current user's cohort
            demographicSelect.value = currentUser.demographic_group || 'urban_affluent';

            if (demographicBtn) {
              // Clone to avoid stacking duplicate listeners across calls
              const newDemographicBtn = demographicBtn.cloneNode(true);
              demographicBtn.parentNode.replaceChild(newDemographicBtn, demographicBtn);

              newDemographicBtn.addEventListener('click', async () => {
                const newGroup = demographicSelect.value;
                if (demographicStatus) {
                  demographicStatus.innerText = 'Updating...';
                  demographicStatus.className = 'signup-status-message info';
                  demographicStatus.classList.remove('hidden');
                }

                try {
                  const res = await fetch('https://api.inviteonlyreviews.com/api/profile/update-demographic', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                      demographicGroup: newGroup
                    })
                  });

                  const data = await res.json();
                  if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Failed to update demographic cohort.');
                  }

                  // Update local state
                  const profile = db.profiles.find(p => p.id === currentUser.id);
                  if (profile) {
                    profile.demographic_group = newGroup;
                    currentUser.demographic_group = newGroup;
                  }
                  saveDbState();

                  if (demographicStatus) {
                    const label = newGroup === 'urban_affluent' ? 'Urban / High Density' : 'Rural / Low Density';
                    demographicStatus.innerText = `✓ Cohort updated to: ${label}`;
                    demographicStatus.className = 'signup-status-message success';
                  }
                } catch (err) {
                  if (demographicStatus) {
                    demographicStatus.innerText = 'Error: ' + err.message;
                    demographicStatus.className = 'signup-status-message error';
                  }
                }
              });
            }
          }
        }
      }
      return;
    }

  // Guest State
  currentUser = null;
  if (typeof window.syncSidebarFooter === 'function') {
    window.syncSidebarFooter();
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

// calculateReviewConsensus, getReviewTags, and checkLineageCollusion are imported from services.js

// ----------------------------------------------------
// 4. Forum Feed Rendering & Search
// ----------------------------------------------------
let feedLimit = 10;
let feedOffset = 0;
let feedHasMore = true;
let isFetchingFeed = false;
let feedObserver = null;

function setupFeedSentinelObserver(sentinel) {
  if (feedObserver) {
    feedObserver.disconnect();
  }
  feedObserver = new IntersectionObserver(async (entries) => {
    if (entries[0].isIntersecting && feedHasMore && !isFetchingFeed) {
      isFetchingFeed = true;
      try {
        await syncLiveReviews(feedLimit, feedOffset);
      } catch (e) {
        console.error("Scroll sync failed:", e);
      }
      isFetchingFeed = false;
      renderFeedReviews(true);
    }
  }, { rootMargin: '150px' });
  feedObserver.observe(sentinel);
}

function renderFeedReviews(append = false) {
  const searchInput = document.getElementById('feed-search-input');
  const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const sortSelect = document.getElementById('feed-sort-select');
  const sortBy = sortSelect ? sortSelect.value : 'latest';
  const feedList = document.getElementById('portal-feed-list');
  const popularTagsWrapper = document.getElementById('feed-popular-tags');
  const settingsRevealConsent = document.getElementById('chk-settings-reveal-low')?.checked || false;

  if (!feedList) return;

  if (!append) {
    feedOffset = 0;
    feedHasMore = true;
    feedList.innerHTML = '';
    if (feedObserver) {
      feedObserver.disconnect();
      feedObserver = null;
    }
  }

  // 1. Populate popular tags filter bar (only on full load, not on append)
  if (!append && popularTagsWrapper) {
    popularTagsWrapper.innerHTML = '';
    
    // Add "All" chip
    const allChip = document.createElement('span');
    allChip.className = !activeTagFilter ? 'tag-chip active' : 'tag-chip';
    allChip.innerText = '#all';
    allChip.addEventListener('click', () => {
      activeTagFilter = null;
      document.getElementById('active-tag-indicator').classList.add('hidden');
      renderFeedReviews(false);
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
        renderFeedReviews(false);
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
  if (sortBy === 'newest' || sortBy === 'latest') {
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

  // Remove existing sentinel if any before rendering new page
  const oldSentinel = document.getElementById('feed-sentinel');
  if (oldSentinel) {
    oldSentinel.remove();
  }

  // Slice for pagination
  const pageReviews = reviews.slice(feedOffset, feedOffset + feedLimit);
  
  if (pageReviews.length === 0 && !append) {
    feedList.innerHTML = `
      <div class="empty-feed-placeholder">
        <p>No reviews found matching filters.</p>
      </div>
    `;
    return;
  }

  // 4. Render page reviews
  const fragment = document.createDocumentFragment();
  pageReviews.forEach(r => {
    renderReviewCard(r, fragment, settingsRevealConsent);
  });
  feedList.appendChild(fragment);

  // Update offset
  feedOffset += pageReviews.length;
  if (reviews.length <= feedOffset) {
    feedHasMore = false;
  }

  // Append new sentinel if more reviews remain
  if (feedHasMore) {
    const sentinel = document.createElement('div');
    sentinel.id = 'feed-sentinel';
    sentinel.style.height = '40px';
    sentinel.style.display = 'flex';
    sentinel.style.justifyContent = 'center';
    sentinel.style.alignItems = 'center';
    sentinel.innerHTML = '<span style="color:#71717a; font-size:0.8rem; font-family:var(--font-sans);">Loading more reviews...</span>';
    feedList.appendChild(sentinel);
    
    setupFeedSentinelObserver(sentinel);
  }
}

function renderReviewCard(r, parentContainer, settingsRevealConsent) {
  const cardContainer = document.createElement('div');
  cardContainer.className = 'review-card-container';
  cardContainer.setAttribute('data-review-id', r.id);
  cardContainer.style.marginBottom = '1.25rem';

  // Target parent directory categories
  let pathString = 'Directory Space';
  if (r.node) {
    const pathParts = [];
    const tracePath = (nodeId) => {
      const n = db.nodes.find(item => item.id === nodeId);
      if (n) {
        pathParts.unshift(sanitizeHTML(n.name));
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
        ${r.tags.map(t => `<span class="tag-chip" style="font-size:0.75rem; padding: 2px 8px; background: rgba(255,255,255,0.04); border: 1px solid var(--border-color); cursor:pointer;" onclick="setFeedTagFilter(${t.id}, '${sanitizeHTML(t.name).replace(/'/g, "\\'")}')">#${sanitizeHTML(t.name)}</span>`).join('')}
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

  // Edit button HTML
  let editBtnHtml = '';
  if (currentUser && r.author_id === currentUser.id) {
    editBtnHtml = `<button class="btn-edit-review" onclick="editReviewInline('${r.id}')" style="background: transparent; border: none; color: var(--color-primary); cursor: pointer; font-size: 0.8rem; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px; border: 1px solid rgba(16, 185, 129, 0.2); background: rgba(16, 185, 129, 0.05); margin-right: 0.25rem;" onmouseenter="this.style.background='rgba(16, 185, 129, 0.15)'" onmouseleave="this.style.background='rgba(16, 185, 129, 0.05)'">✏️ Edit</button>`;
  }

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
            <h3 class="post-author" style="margin: 0.15rem 0; font-size: 0.95rem;">@${sanitizeHTML(r.author?.username || 'deactivated_user')}</h3>
            ${followBtnHtml}
          </div>
        </div>
        <div style="display:flex; gap:0.5rem; align-items:center;">
          ${verifyBadge}
          <span class="post-date" style="font-size:0.75rem; color:#71717a;">${new Date(r.created_at).toLocaleDateString()}</span>
          ${editBtnHtml}
          ${deleteBtnHtml}
        </div>
      </div>
      <p class="post-body-text" style="font-size:0.9rem; line-height:1.45; color:#e4e4e7;">${sanitizeHTML(r.raw_content)}</p>
      ${paramsHtml}
      ${tagsHtml}
      ${changelogBtnHtml}
      
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
      ${commentsSectionHtml}
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

  const fragment = document.createDocumentFragment();
  reviews.forEach(r => {
    renderReviewCard(r, fragment, settingsRevealConsent);
  });
  feedList.appendChild(fragment);
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
        <span class="user-meta-value" style="font-size: 0.95rem; font-weight: 500;">${profile.demographic_group === 'remote_rural' ? 'Rural / Low Density' : 'Urban / High Density'}</span>
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

window.updateReviewCardUI = function(reviewId) {
  const cardContainer = document.querySelector(`[data-review-id="${reviewId}"]`);
  if (!cardContainer) return;

  const consensus = calculateReviewConsensus(reviewId);
  const settingsRevealConsent = document.getElementById('chk-settings-reveal-low')?.checked || false;

  // 1. Update Vouch and Dispute weights
  const summaryEl = cardContainer.querySelector('.post-votes-summary');
  if (summaryEl) {
    const strongs = summaryEl.querySelectorAll('strong');
    if (strongs.length >= 2) {
      strongs[0].innerText = consensus.vouches.toFixed(1);
      strongs[1].innerText = consensus.disputes.toFixed(1);
    }
  }

  // 2. Update button classes
  const hasVotedVouch = currentUser ? db.vouches_disputes.some(v => v.review_id === reviewId && v.user_id === currentUser.id && v.type === 'vouch') : false;
  const hasVotedDispute = currentUser ? db.vouches_disputes.some(v => v.review_id === reviewId && v.user_id === currentUser.id && v.type === 'dispute') : false;

  const vouchBtn = cardContainer.querySelector('.post-vote-actions button:first-child');
  const disputeBtn = cardContainer.querySelector('.post-vote-actions button:last-child');
  if (vouchBtn) vouchBtn.className = hasVotedVouch ? 'vote-btn vouch-active' : 'vote-btn';
  if (disputeBtn) disputeBtn.className = hasVotedDispute ? 'vote-btn dispute-active' : 'vote-btn';

  // 3. Update warning banner and blur overlay
  const cardEl = cardContainer.querySelector('.review-card');
  if (cardEl) {
    // Remove existing warning banners
    const existingBanner = cardEl.querySelector('.review-warning-banner');
    if (existingBanner) existingBanner.remove();

    const thetaPct = Math.round(consensus.theta * 100);
    cardEl.classList.remove('disputed-mid', 'disputed-heavy');

    let warningBannerHtml = '';
    let cardClassAdd = '';
    if (consensus.theta >= 0.40 && consensus.theta < 0.70) {
      cardClassAdd = 'disputed-mid';
      warningBannerHtml = `<div class="review-warning-banner yellow">⚠️ Contested Feedback: Community consensus is split (${thetaPct}% approve)</div>`;
    } else if (consensus.theta < 0.40) {
      cardClassAdd = 'disputed-heavy';
      warningBannerHtml = `<div class="review-warning-banner red">🛑 LOW CONSENSUS: This review has failed community guidelines (${thetaPct}% approve)</div>`;
    }

    if (cardClassAdd) cardEl.classList.add(cardClassAdd);
    if (warningBannerHtml) {
      cardEl.insertAdjacentHTML('afterbegin', warningBannerHtml);
    }

    const isContested = consensus.theta < 0.40;
    const isCollapsed = isContested && !settingsRevealConsent;

    // Handle blur and reveal overlay
    const existingOverlay = cardContainer.querySelector('.reveal-overlay');
    if (isCollapsed) {
      cardEl.style.filter = 'blur(4px)';
      cardEl.style.pointerEvents = 'none';
      cardEl.style.opacity = '0.2';

      if (!existingOverlay) {
        const overlay = document.createElement('div');
        overlay.className = 'reveal-overlay';
        overlay.innerHTML = `
          <span style="font-size: 1.5rem; margin-bottom: 0.25rem;">🛑</span>
          <strong style="color: #f43f5e; font-size: 0.85rem;">Review Contested (Guidelines failed)</strong>
          <p style="font-size: 0.72rem; color: #a1a1aa; margin: 0.25rem 1rem; text-align: center;">This post has low community consensus. Click to reveal.</p>
        `;
        overlay.addEventListener('click', () => {
          overlay.style.display = 'none';
          cardEl.style.filter = 'none';
          cardEl.style.opacity = '1';
          cardEl.style.pointerEvents = 'auto';
        });
        cardContainer.appendChild(overlay);
      } else {
        existingOverlay.style.display = 'flex';
      }
    } else {
      cardEl.style.filter = 'none';
      cardEl.style.pointerEvents = 'auto';
      cardEl.style.opacity = '1';
      if (existingOverlay) existingOverlay.remove();
    }
  }
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

  // Sync UI — update in-place if visible to prevent page redraw/flicker
  const activeTab = document.querySelector('.nav-tab-btn.active')?.getAttribute('data-tab');
  if (activeTab === 'feed-view' || activeTab === 'following-view') {
    window.updateReviewCardUI(reviewId);
  } else if (activeTab === 'browse-view') {
    renderDirectoryExplorer();
  } else if (activeTab === 'users-view' && selectedUserId) {
    renderSelectedUserDetails(selectedUserId);
  } else {
    window.updateReviewCardUI(reviewId);
  }

  // Sync vouch to database in background
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


window.deleteReviewFromFeed = async function(reviewId) {
  if (!await showConfirm("Are you sure you want to permanently delete this review from the network?", "Delete Review")) {
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
  
  alert("Review successfully deleted from the network.");
};

// getLineageAlpha is imported from services.js

// ----------------------------------------------------
// 5. Lineage Penalities & Reputation Contagion Engine
// ----------------------------------------------------
// runLineageReputationDecay is imported from services.js

// ----------------------------------------------------
// 6. Hierarchical Directory Browser
// ----------------------------------------------------
function renderDirectoryExplorer() {
  console.log("Rendering Directory. Management Mode Active:", window.managementModeActive);
  if (currentUser) {
    console.log("Checking User Role:", currentUser.role);
  } else {
    console.log("Checking User Role:", null);
  }

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

  const fragment = document.createDocumentFragment();
  children.forEach(child => {
    const card = document.createElement('div');
    card.className = 'directory-card card-hover-effect';
    
    let typeIcon = '📂';
    if (child.node_type === 'merchant') typeIcon = '🏪';
    if (child.node_type === 'item') typeIcon = '📦';
    if (child.node_type === 'fishing_spot') typeIcon = '🎣';
    if (child.node_type === 'point_of_interest') typeIcon = '📍';

    let managementButtonsHtml = '';
    const isModerator = currentUser && (currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator');
    if (window.managementModeActive && isModerator) {
      managementButtonsHtml = `
        <div class="mgmt-actions" style="margin-left: auto; display: flex; gap: 0.25rem;">
          <button class="btn btn-warning btn-sm btn-relocate" style="padding: 0.25rem 0.5rem; font-size: 0.7rem; width: auto; height: auto;">Relocate</button>
          <button class="btn btn-danger btn-sm btn-delete" style="padding: 0.25rem 0.5rem; font-size: 0.7rem; width: auto; height: auto;">Delete</button>
        </div>
      `;
    }

    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.75rem; width: 100%;">
        <span style="font-size:1.5rem;">${typeIcon}</span>
        <div style="display:flex; flex-direction:column;">
          <strong style="font-size:0.95rem; color:#e4e4e7;">${sanitizeHTML(child.name)}</strong>
          <span style="font-size:0.72rem; color:#71717a; text-transform:uppercase; font-family:var(--font-mono);">${child.node_type}</span>
        </div>
        ${managementButtonsHtml}
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

    const btnRelocate = card.querySelector('.btn-relocate');
    const btnDelete = card.querySelector('.btn-delete');

    if (btnRelocate) {
      btnRelocate.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent card navigation click
        
        // Relocate (Merge) Action
        if (!await showConfirm(`Are you sure you want to relocate/merge the space "${child.name}"?`, "Confirm Relocation")) {
          return;
        }
        
        const targetIdStr = prompt(`Enter the ID of the canonical target category/merchant to merge "${child.name}" into:`);
        if (targetIdStr === null) return;
        
        const targetId = parseInt(targetIdStr.trim());
        if (isNaN(targetId)) {
          alert("Error: Target ID must be a valid integer.");
          return;
        }
        
        await window.mergeNodeInDirectory(child.id, targetId);
      });
    }

    if (btnDelete) {
      btnDelete.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent card navigation click
        
        // Delete Action
        if (!await showConfirm(`Are you sure you want to permanently delete the space "${child.name}" and all of its contents?`, "Confirm Deletion")) {
          return;
        }
        
        await window.deleteNodeFromDirectory(child.id);
      });
    }

    fragment.appendChild(card);
  });
  listDeck.appendChild(fragment);

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
      📍 <strong>Address:</strong> ${sanitizeHTML(node.address)}
    </div>
  ` : '';
  const coordsBlock = node.coordinates ? `
    <div style="font-size:0.85rem; margin-top:0.15rem; color:#a1a1aa;">
      🌐 <strong>Coordinates:</strong> <code style="font-family:var(--font-mono); font-size:0.78rem;">${sanitizeHTML(node.coordinates)}</code>
    </div>
  ` : '';

  let consensusBadgeColor = 'var(--color-success)';
  if (avgConsensus < 0.70) consensusBadgeColor = 'var(--color-warning)';
  if (avgConsensus < 0.40) consensusBadgeColor = '#f43f5e';

  const isMod = currentUser && (currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator');
  let modActionsButtonHtml = '';
  if (isMod && (window.managementModeActive || node.parent_id !== null)) {
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
        <h2 style="margin-top:0.25rem;">${sanitizeHTML(node.name)}</h2>
      </div>
      <div style="text-align:right;">
        <div style="font-size:0.7rem; color:#71717a; text-transform:uppercase;">Consensus Rating</div>
        <strong style="font-size:1.35rem; color:${consensusBadgeColor};">${avgPct}%</strong>
      </div>
    </div>
    ${addressBlock}
    ${coordsBlock}
    <div style="display:flex; justify-content:space-between; margin-top:1rem; font-size:0.82rem; color:#71717a;">
      <span>Directory path: <code>${sanitizeHTML(node.path)}</code></span>
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

  const fragment = document.createDocumentFragment();
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
          <strong style="font-size:0.85rem; color:#e4e4e7;">@${sanitizeHTML(r.author?.username || 'deactivated_user')}</strong>
          <div style="display:flex; gap:0.25rem; align-items:center;">
            ${verifyBadge}
            <span style="font-size:0.7rem; color:#71717a;">${new Date(r.created_at).toLocaleDateString()}</span>
            ${deleteBtnHtml}
          </div>
        </div>
        <p style="font-size:0.82rem; line-height:1.4; color:#d4d4d8; margin:0;">${sanitizeHTML(r.raw_content)}</p>
        ${r.tags && r.tags.length > 0 ? `<div style="display:flex; gap:0.25rem; flex-wrap:wrap; margin-top:0.4rem;">${r.tags.map(t => `<span class="tag-chip" style="font-size:0.65rem; padding: 1px 6px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color);">#${sanitizeHTML(t.name)}</span>`).join('')}</div>` : ''}
        
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

    fragment.appendChild(cardContainer);
  });
  detailsReviews.appendChild(fragment);
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
    btnSubmit.addEventListener('click', async () => {
      loadDb();
      if (!currentUser) {
        alert("Authentication Error: You must be logged in to post reviews.");
        return;
      }

      let isNewMode = newRadio.checked;
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

        // Intercept leaf node creation if coordinates already exist nearby
        if (coords) {
          const existingNodeId = await window.checkSpatialDeduplication(coords);
          if (existingNodeId) {
            targetNodeId = existingNodeId;
            isNewMode = false;
          }
        }

        if (isNewMode) {
          // Generate taxonomy nodes recursively
          const pathSegments = newPath.split('/').map(s => s.trim()).filter(Boolean);
          let currentParentId = parentId;
          
          // Helper to generate slug
          const toSlug = (str) => {
            return str.toLowerCase()
                      .replace(/[^a-z0-9_]+/g, '_')
                      .replace(/^_+|_+$/g, '');
          };

          for (let i = 0; i < pathSegments.length; i++) {
            const name = pathSegments[i];
            const slug = toSlug(name);
            if (!slug) {
              alert(`Invalid name component: "${name}"`);
              return;
            }

            // Check if node exists under currentParentId using findNormalizedNode
            let existingNode = window.findNormalizedNode(currentParentId, name);
            const isLeaf = (i === pathSegments.length - 1);

            if (existingNode) {
              currentParentId = existingNode.id;
              if (isLeaf) {
                if (address) existingNode.address = address;
                if (coords) existingNode.coordinates = coords;
                if (aliasesList.length > 0) {
                  if (!existingNode.aliases) existingNode.aliases = [];
                  aliasesList.forEach(a => {
                    if (!existingNode.aliases.includes(a)) {
                      existingNode.aliases.push(a);
                    }
                  });
                }
              }
            } else {
              // Create new node
              const nextId = Math.floor(Math.random() * 100000000) + 1000000;
              const parentNode = db.nodes.find(n => n.id === currentParentId);
              const parentPath = parentNode ? parentNode.path : '';
              const nodePathString = parentPath ? `${parentPath}.${nextId}` : `${nextId}`;

              let type = isLeaf ? leafNodeType : 'category';
              if (!isLeaf) {
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
                path: nodePathString,
                address: isLeaf && address ? address : null,
                coordinates: isLeaf && coords ? coords : null,
                aliases: isLeaf ? aliasesList : [],
                needs_taxonomy_review: (type === 'city')
              };

              db.nodes.push(newNode);
              newNodesList.push(newNode);
              currentParentId = nextId;
            }
          }
          targetNodeId = currentParentId;
        }
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
          node_id: targetNodeId,
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
          credentials: 'include',
          body: JSON.stringify({
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
    // Load from window.settings (already populated from IndexedDB)
    const consent = window.settings ? window.settings.revealLowQualityConsent === true : false;
    chkRevealConsent.checked = consent;

    chkRevealConsent.addEventListener('change', async (e) => {
      await window.saveSettings({ revealLowQualityConsent: e.target.checked });
      // Instantly trigger re-render of feed reviews to update filters!
      renderFeedReviews();
    });
  }
}

window.deleteNodeFromDirectory = async function(nodeId) {
  // NOTE: The Edge Worker / Backend must independently verify the authKey and check for
  // key_root_moderator or moderator role prior to execution. Do not rely solely on frontend client checks.
  if (!currentUser) {
    alert("Error: You must be logged in to perform this operation.");
    return;
  }

  if (!await showConfirm("Are you sure you want to permanently delete this directory space, including all sub-spaces and reviews?", "Delete Directory Space")) {
    return;
  }

  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/nodes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
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

window.mergeNodeInDirectory = async function(nodeId, targetId = null) {
  // NOTE: The Edge Worker / Backend must independently verify the authKey and check for
  // key_root_moderator or moderator role prior to execution. Do not rely solely on frontend client checks.
  if (targetId === null) {
    const targetIdStr = prompt("Enter the ID of the canonical target category/merchant to merge this space into:");
    if (targetIdStr === null) return;
    targetId = parseInt(targetIdStr.trim());
  }
  if (isNaN(targetId)) {
    alert("Error: Target ID must be a number.");
    return;
  }

  if (nodeId === targetId) {
    alert("Error: Cannot merge a space into itself.");
    return;
  }

  if (!currentUser) {
    alert("Error: You must be logged in to perform this operation.");
    return;
  }

  if (!await showConfirm(`Are you sure you want to merge space #${nodeId} into space #${targetId}? All child spaces and reviews will be moved.`, "Merge Directory Space")) {
    return;
  }

  // Perform local database migration before sending payload to the server
  const sourceNode = db.nodes.find(n => n.id === nodeId);
  const targetNode = db.nodes.find(n => n.id === targetId);
  if (sourceNode && targetNode) {
    db.reviews.forEach(r => {
      if (r.node_id === nodeId) {
        r.node_id = targetId;
      }
    });
    db.nodes.forEach(n => {
      if (n.parent_id === nodeId) {
        n.parent_id = targetId;
      }
    });
    if (!targetNode.aliases) {
      targetNode.aliases = [];
    }
    if (!targetNode.aliases.includes(sourceNode.name.toLowerCase())) {
      targetNode.aliases.push(sourceNode.name.toLowerCase());
    }
    if (sourceNode.aliases && Array.isArray(sourceNode.aliases)) {
      sourceNode.aliases.forEach(a => {
        if (!targetNode.aliases.includes(a.toLowerCase())) {
          targetNode.aliases.push(a.toLowerCase());
        }
      });
    }
    db.nodes = db.nodes.filter(n => n.id !== nodeId);
    saveDbState();
  }

  try {
    const response = await fetch('https://api.inviteonlyreviews.com/api/admin/merge-nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        sourceNodeId: nodeId,
        targetNodeId: targetId
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to merge directory spaces.');
    }

    alert("Directory spaces successfully merged on the ledger!");

    // Reset path back to root since structure changed and re-render
    currentDirectoryPath = [];
    renderDirectoryExplorer();

  } catch (err) {
    alert("Error: " + err.message);
  }
};

function initializeManagementUI() {
  console.log("Rendering Directory. Management Mode Active:", window.managementModeActive);
  if (currentUser) {
    console.log("Checking User Role:", currentUser.role);
  } else {
    console.log("Checking User Role:", null);
  }

  let btnToggleMgmt = document.getElementById('btn-toggle-management-mode');
  if (!btnToggleMgmt) {
    const cardHeader = document.querySelector('.directory-nav-card .card-header') || document.querySelector('#browse-view .card-header');
    if (cardHeader) {
      btnToggleMgmt = document.createElement('button');
      btnToggleMgmt.id = 'btn-toggle-management-mode';
      btnToggleMgmt.className = 'btn btn-warning hidden';
      btnToggleMgmt.style.padding = '0.35rem 0.65rem';
      btnToggleMgmt.style.fontSize = '0.75rem';
      btnToggleMgmt.style.width = 'auto';
      btnToggleMgmt.style.height = 'auto';
      btnToggleMgmt.innerText = 'Unlock Management Mode';
      cardHeader.appendChild(btnToggleMgmt);
    }
  }

  if (btnToggleMgmt) {
    const isModerator = currentUser && (currentUser.role === 'key_root_moderator' || currentUser.role === 'moderator');
    if (isModerator) {
      btnToggleMgmt.classList.remove('hidden');
      btnToggleMgmt.style.display = 'inline-block';
    } else {
      btnToggleMgmt.classList.add('hidden');
      btnToggleMgmt.style.display = 'none';
    }

    if (!btnToggleMgmt.dataset.listenerAttached) {
      btnToggleMgmt.addEventListener('click', () => {
        window.managementModeActive = !window.managementModeActive;
        if (window.managementModeActive) {
          btnToggleMgmt.innerText = 'Lock Management Mode';
          btnToggleMgmt.style.background = 'var(--color-primary)';
        } else {
          btnToggleMgmt.innerText = 'Unlock Management Mode';
          btnToggleMgmt.style.background = '';
        }
        renderDirectoryExplorer();
      });
      btnToggleMgmt.dataset.listenerAttached = 'true';
    }
  }
}

// ----------------------------------------------------
// 10. Initialization & Listeners Setup
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await loadDb();
  await window.loadSettings();
  await window.loadFollows();

  let verified = false;
  try {
    const res = await fetch('https://api.inviteonlyreviews.com/api/auth/verify', {
      method: 'POST',
      credentials: 'include'
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.profile && data.profile.is_active) {
        window.currentUser = data.profile;
        verified = true;
      }
    }
  } catch (err) {
    console.error("Session verification failed:", err);
  }

  if (!verified) {
    window.location.href = 'profile.html';
    return;
  }
  syncCurrentUser();

  // Set up Unlock Management Mode button
  initializeManagementUI();

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
  window.addEventListener('storage', async (e) => {
    if (e.key === 'review_network_db' || e.key === 'review_network_settings' || e.key === 'review_network_follows') {
      await loadDb(true);
      await window.loadSettings();
      await window.loadFollows();
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
