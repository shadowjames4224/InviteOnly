// assistant.js - InviteOnly Network Assistant Chat Widget
// Dynamically creates and injects a floating glassmorphic chat helper agent.

(function() {
  // Wait until DOM is fully loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initChatWidget);
  } else {
    initChatWidget();
  }

  function initChatWidget() {
    // 1. Check if widget already exists
    if (document.getElementById('floating-assistant-widget')) return;

    // 2. Inject HTML structure
    const widget = document.createElement('div');
    widget.id = 'floating-assistant-widget';
    widget.className = 'floating-chat-widget';
    widget.innerHTML = `
      <div class="chat-bubble-toggle" id="chat-toggle-bubble" title="InviteOnly Assistant">
        💬
      </div>
      <div class="chat-window hidden" id="chat-widget-window">
        <div class="chat-header">
          <h3>✦ InviteOnly Assistant</h3>
          <button class="chat-close-btn" id="btn-close-chat">&times;</button>
        </div>
        <div class="chat-messages" id="chat-messages-container">
          <div class="chat-message agent">
            <div class="chat-message-text">Hello! I am the InviteOnly Network Assistant. I can help you search the database ledger or show you how to properly file a review.

Ask me things like:
- *"where can I get a good cup of coffee in Austin TX"*
- *"how do I file a review"*
- *"what is our consensus formula"*</div>
          </div>
        </div>
        <div class="chat-input-area">
          <input type="text" class="chat-input-field" id="chat-input-message" placeholder="Ask the Assistant..." autocomplete="off">
          <button class="chat-send-btn" id="btn-send-chat">Send</button>
        </div>
      </div>
    `;

    document.body.appendChild(widget);

    // 3. Bind UI interactions
    const toggle = document.getElementById('chat-toggle-bubble');
    const win = document.getElementById('chat-widget-window');
    const closeBtn = document.getElementById('btn-close-chat');
    const sendBtn = document.getElementById('btn-send-chat');
    const input = document.getElementById('chat-input-message');
    const container = document.getElementById('chat-messages-container');

    toggle.addEventListener('click', () => {
      win.classList.toggle('hidden');
      if (!win.classList.contains('hidden')) {
        input.focus();
        container.scrollTop = container.scrollHeight;
      }
    });

    closeBtn.addEventListener('click', () => {
      win.classList.add('hidden');
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        win.classList.add('hidden');
      }
    });

    const sendMessage = () => {
      const text = input.value.trim();
      if (!text) return;

      // Add user message
      appendMessage(text, 'user');
      input.value = '';

      // Show typing indicator
      const typingInd = showTypingIndicator();

      setTimeout(() => {
        // Remove typing indicator
        typingInd.remove();

        // Generate response
        const response = getAgentResponse(text);
        appendMessage(response, 'agent');
      }, 700 + Math.random() * 500);
    };

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });

    function appendMessage(msgText, sender) {
      const msg = document.createElement('div');
      msg.className = `chat-message ${sender}`;
      msg.innerHTML = `<div class="chat-message-text"></div>`;
      
      const formatted = msgText
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 3px; font-family: monospace; font-size: 0.8em; color: var(--color-primary);">$1</code>')
        .replace(/\n/g, '<br>');

      msg.querySelector('.chat-message-text').innerHTML = formatted;
      container.appendChild(msg);
      container.scrollTop = container.scrollHeight;
    }

    function showTypingIndicator() {
      const indicator = document.createElement('div');
      indicator.className = 'chat-message agent';
      indicator.innerHTML = `
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      `;
      container.appendChild(indicator);
      container.scrollTop = container.scrollHeight;
      return indicator;
    }
  }

  // 4. Assistant NLP Search Response Generator
  function getAgentResponse(query) {
    // Dynamically retrieve latest db state if available in window or localStorage
    let currentDb = window.db;
    if (!currentDb) {
      const stored = localStorage.getItem('review_network_db');
      if (stored) {
        try { currentDb = JSON.parse(stored); } catch(e) {}
      }
    }

    const q = query.toLowerCase();
    
    // Check for review guides
    if (q.includes("file a review") || q.includes("post a review") || q.includes("how to review") || q.includes("write a review") || q.includes("how do i review")) {
      return `To file a review on the network:
1. Navigate to the **My Profile** portal.
2. Select your target: choose **Existing Location** or select **Create New Path** to add a new category/item.
3. Select a **Global Entity Blueprint** matching the item (e.g. coffee, GPU-X, or fishing spot) to enter specific telemetry parameters (espresso weights, temperatures, voltage).
4. Add a **Proof-of-Experience (PoE)** check (EXIF GPS maps proximity, WASM receipt OCR, or Secure Enclave platform signature) to bypass disputes.
5. Write your review content and click **Post Immutable Review**.`;
    }
    
    // Check for consensus formula
    if (q.includes("formula") || q.includes("consensus") || q.includes("theta") || q.includes("calculate") || q.includes("ipw")) {
      return `InviteOnly calculates trust consensus using community weights:
- **Consensus Score (θ)**: Computed as θ = Wv / (Wv + Wd) where Wv represents sum of vouches and Wd is disputes.
- **Social Proximity Discount**: Voting on reviews written by users in your invite lineage discounts your vote's weight by 50% to mitigate collusion.
- **Causal IPW**: Voter rep is normalized by Inverse Probability Weighting on demographics (Urban propensity 0.75, Rural 0.25) to neutralize voter privileges.`;
    }

    if (q.includes("reputation") || q.includes("decay") || q.includes("revoke") || q.includes("blast-radius")) {
      return `InviteOnly leverages directed invite lineages to quarantine malicious actors:
- **Cascading Penalty**: If an invitee has their reviews heavily disputed, the lineage penalty decays their parent's reputation score.
- **Cascade Revocation**: A moderator can revoke a compromised profile, cascade-deactivating all downstream accounts (setting rep to 0.0000).`;
    }

    if (!currentDb || !currentDb.nodes) {
      return `I am here to help you search the database or file reviews, but the database state is currently offline. Please open the Simulator or Profile portal first!`;
    }

    // City & Category search
    let recommendations = [];
    currentDb.nodes.forEach(node => {
      // Match both geographical/regional containers and leaf nodes
      const allowedTypes = [
        'root', 'continent', 'country', 'state', 'city', 'neighborhood',
        'merchant', 'item', 'fishing_spot', 'point_of_interest', 'execution_instance'
      ];
      if (allowedTypes.includes(node.node_type)) {
        // Build breadcrumb string
        let parts = [];
        let curr = node;
        while (curr) {
          parts.unshift(curr.name);
          curr = currentDb.nodes.find(n => n.id === curr.parent_id);
        }
        const pathStr = parts.join(' / ').toLowerCase();
        
        // Match query terms
        const words = q.replace(/[?,.!]/g, '').split(/\s+/).filter(w => w.length > 2);
        let matchCount = 0;
        words.forEach(w => {
          if (node.name.toLowerCase().includes(w) || pathStr.includes(w)) {
            matchCount++;
          }
        });

        if (matchCount > 0) {
          // Fetch reviews & consensus ratio
          const nodeReviews = currentDb.reviews.filter(r => r.node_id === node.id);
          let avgTheta = 1.0;
          let wvTotal = 0;
          let wdTotal = 0;

          nodeReviews.forEach(r => {
            let votes = currentDb.vouches_disputes.filter(v => v.review_id === r.id);
            let wv = 0, wd = 0;
            votes.forEach(vote => {
              let voter = currentDb.profiles.find(p => p.id === vote.user_id);
              if (voter && voter.is_active) {
                let w = voter.reputation_score;
                if (vote.type === 'vouch') wv += w; else wd += w;
              }
            });
            wvTotal += wv;
            wdTotal += wd;
          });

          if (nodeReviews.length > 0) {
            avgTheta = wvTotal + wdTotal > 0 ? wvTotal / (wvTotal + wdTotal) : 1.0;
          }

          recommendations.push({
            node: node,
            path: parts.join(' / '),
            avgTheta: avgTheta,
            reviewsCount: nodeReviews.length,
            matchCount: matchCount
          });
        }
      }
    });

    if (recommendations.length > 0) {
      recommendations.sort((a,b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        return b.avgTheta - a.avgTheta;
      });

      let resp = `I parsed the InviteOnly ledger and found these recommendations matching your query:\n\n`;
      recommendations.slice(0, 3).forEach(rec => {
        const thetaText = rec.reviewsCount > 0 ? `consensus θ = ${rec.avgTheta.toFixed(2)}` : 'no votes yet';
        const poeText = currentDb.reviews.some(r => r.node_id === rec.node.id && r.is_verified_experience) ? '✓ PoE Verified' : 'pending verification';
        
        resp += `✦ **${rec.node.name}** (${rec.node.node_type.toUpperCase().replace('_', ' ')})\n`;
        resp += `  Path: \`${rec.path}\`\n`;
        if (rec.node.address) resp += `  📍 Address: ${rec.node.address}\n`;
        resp += `  Trust: ${thetaText} (${rec.reviewsCount} reviews, ${poeText})\n\n`;
      });

      // Show Cpk/CI stats if first match has execution_instance
      const top = recommendations[0];
      const instId = top.node.execution_instance_id;
      if (instId && currentDb.execution_instances) {
        const inst = currentDb.execution_instances.find(ei => ei.id === instId);
        const ge = inst ? currentDb.global_entities.find(g => g.id === inst.global_entity_id) : null;
        const verifiedReviews = currentDb.reviews.filter(r => r.execution_instance_id === instId && r.is_verified_experience);

        if (ge && verifiedReviews.length >= 2) {
          if (ge.category === 'Physical Consumer Good') {
            const thermals = verifiedReviews.map(r => r.param_val_1).filter(v => v !== null && v !== undefined);
            if (thermals.length >= 2) {
              const mean = thermals.reduce((a,b)=>a+b, 0) / thermals.length;
              const varVal = thermals.reduce((a,b)=>a + Math.pow(b - mean, 2), 0) / thermals.length;
              const std = Math.sqrt(varVal);
              const cpk = Math.min((85.0 - mean)/(3*std), (mean - 60.0)/(3*std));
              resp += `📊 **Process Capability (Cpk):** ${cpk.toFixed(2)} (${cpk > 1.33 ? 'Stable' : 'Marginal'}) with verified mean thermal of ${mean.toFixed(1)}°C.\n`;
            }
          } else {
            const vals = verifiedReviews.map(r => r.param_val_1).filter(v => v !== null && v !== undefined);
            if (vals.length >= 2) {
              const mean = vals.reduce((a,b)=>a+b, 0) / vals.length;
              const varVal = vals.reduce((a,b)=>a + Math.pow(b - mean, 2), 0) / vals.length;
              const std = Math.sqrt(varVal);
              const cv = std / mean;
              const ci = 100 * (1.0 - 0.25 * cv);
              resp += `📈 **Consistency Index (CI):** ${ci.toFixed(1)}% (${ci >= 75 ? 'Exceptional' : 'Marginal'}) based on verified runs.\n`;
            }
          }
        }
      }

      return resp;
    }

    if (q.includes("coffee") || q.includes("cafe")) {
      return `I searched for coffee recommendations, but I couldn't find any coffee nodes matching your keywords in the current ledger.
      
If you know a good spot, log in to **My Profile**, create a new path (e.g. \`Coffee Shops / My Spot\`), submit a review, and verify it using WASM receipt OCR!`;
    }

    return `Hello! I am the InviteOnly assistant. I didn't find any nodes matching "${query}" in the active database.

Try asking:
- *"where can I get a good cup of coffee in Austin TX"*
- *"how do I file a review"*
- *"what is our consensus formula"*`;
  }
})();
