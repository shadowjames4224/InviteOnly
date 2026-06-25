const snapshot = [];
const db = { profiles: [{id: 1, is_active: true, reputation_score: 1.0, invited_by: null, role: 'user', released_by: null, originally_invited_by: null}] };

async function updateProfilesOnEdge(updates) {
  console.log(updates);
}

async function syncSnapshotChanges(snapshot) {
  const updates = [];
  db.profiles.forEach(p => {
    // Exclude root moderator from updates since it is read-only on the edge
    if (p.id === '00000000-0000-0000-0000-000000000001') return;

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
  if (updates.length > 0) {
    await updateProfilesOnEdge(updates);
  }
}

syncSnapshotChanges(snapshot).catch(console.error);
