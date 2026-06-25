let currentUser = { id: 'root_id', role: 'key_root_moderator' };
let selectedAdminProfileId = 'matt_id';

let db = {
  profiles: [
    { id: 'shadow_id', role: 'moderator', invited_by: 'root_id', is_active: true, reputation_score: 1 },
    { id: 'matt_id', username: 'Matt713', role: 'user', invited_by: 'shadow_id', originally_invited_by: null, released_by: null, is_active: true, reputation_score: 1 }
  ],
  reviews: []
};

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

async function run() {
  const target = db.profiles.find(p => p.id === selectedAdminProfileId);
  const selectedVal = 'released';
  const snapshot = getDbProfilesSnapshot();
  let successMsg = '';

  if (selectedVal === 'released') {
    target.role = 'user';
    if (target.invited_by !== null) {
      target.originally_invited_by = target.invited_by;
      target.released_by = currentUser.id;
      target.invited_by = null;
    }
    successMsg = `✓ Account @${target.username} has been freed (released) as a standalone account.`;
  }

  const updates = [];
  db.profiles.forEach(p => {
    const snap = snapshot.find(s => s.id === p.id);
    if (!snap || 
        snap.is_active !== p.is_active || 
        snap.reputation_score !== p.reputation_score || 
        snap.invited_by !== p.invited_by ||
        snap.role !== p.role ||
        snap.released_by !== p.released_by ||
        snap.originally_invited_by !== p.originally_invited_by) {
      
      const updatePayload = { id: p.id };
      if (!snap || snap.is_active !== p.is_active) updatePayload.is_active = p.is_active;
      if (!snap || snap.reputation_score !== p.reputation_score) updatePayload.reputation_score = p.reputation_score;
      if (!snap || snap.invited_by !== p.invited_by) updatePayload.invited_by = p.invited_by;
      if (!snap || snap.role !== p.role) updatePayload.role = p.role;
      if (!snap || snap.released_by !== p.released_by) updatePayload.released_by = p.released_by;
      if (!snap || snap.originally_invited_by !== p.originally_invited_by) updatePayload.originally_invited_by = p.originally_invited_by;

      updates.push(updatePayload);
    }
  });

  console.log("updates:", updates);
}

run();
