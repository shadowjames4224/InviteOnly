/**
 * database/deduplicate.js
 * Automatically merges duplicate "Earth" root nodes without data loss.
 * Must be executed in the browser context of the InviteOnly app (e.g. from the browser developer console).
 */
(async function() {
  if (typeof window === 'undefined' || !window.db || !window.db.nodes) {
    console.error("❌ Error: This script must be executed in a browser environment with an active database state.");
    return;
  }

  // 1. Identification
  const earthNodes = window.db.nodes.filter(n => n.name === 'Earth');
  if (earthNodes.length <= 1) {
    console.log(`✅ No duplicates found. Found ${earthNodes.length} 'Earth' node(s).`);
    return;
  }

  // 2. Canonical Selection
  // Helper to count direct children of each node
  const getChildrenCount = (id) => {
    return window.db.nodes.filter(n => n.parent_id === id).length;
  };

  // Sort duplicate nodes: most children first, then oldest/smallest ID first
  const sortedEarth = [...earthNodes].sort((a, b) => {
    const childrenA = getChildrenCount(a.id);
    const childrenB = getChildrenCount(b.id);
    if (childrenB !== childrenA) {
      return childrenB - childrenA;
    }
    return Number(a.id) - Number(b.id); // Smallest ID (oldest) first
  });

  const canonicalNode = sortedEarth[0];
  const sourceNodes = sortedEarth.slice(1);

  // 3. Pre-Flight Safety Check
  const preFlightMsg = `Found ${earthNodes.length} duplicate Earth nodes. Merging into Canonical ID: ${canonicalNode.id}. Proceed? (y/n)`;
  console.log(preFlightMsg);

  if (typeof window.confirm === 'function') {
    const proceed = window.confirm(preFlightMsg);
    if (!proceed) {
      console.log("❌ Deduplication aborted by user.");
      return;
    }
  }

  // 4. Execution
  // Temporarily stub UI elements used by mergeNodeInDirectory to allow automated execution
  const originalPrompt = window.prompt;
  const originalShowConfirm = window.showConfirm;
  const originalAlert = window.alert;

  window.prompt = () => canonicalNode.id.toString();
  window.showConfirm = async () => true; // Auto-confirm the merge
  window.alert = (msg) => console.log(`[Alert Bypassed] ${msg}`);

  try {
    for (const source of sourceNodes) {
      console.log(`Merging Source Earth (ID: ${source.id}, Children: ${getChildrenCount(source.id)}) into Canonical Earth (ID: ${canonicalNode.id})...`);
      await window.mergeNodeInDirectory(source.id);
    }

    // Force save Db State for transactional integrity
    if (typeof window.saveDbState === 'function') {
      await window.saveDbState();
    }
    console.log("✅ Merging complete. Local DB state persisted.");

  } catch (err) {
    console.error("❌ Error during deduplication merge:", err);
  } finally {
    // Restore original window functions
    window.prompt = originalPrompt;
    window.showConfirm = originalShowConfirm;
    window.alert = originalAlert;
  }

  // 5. Cleanup Verification
  console.assert(
    window.db.nodes.filter(n => n.name === 'Earth').length === 1,
    "Deduplication failed: More than one Earth node exists."
  );

  const remaining = window.db.nodes.filter(n => n.name === 'Earth');
  if (remaining.length === 1) {
    console.log(`🎉 Success! Deduplication completed. Remaining Earth node ID: ${remaining[0].id}`);
  } else {
    console.error(`❌ Failure! ${remaining.length} Earth nodes still exist.`);
  }
})();
