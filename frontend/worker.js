// worker.js - Background computations worker for Levenshtein distance and OCR text fuzzy matching

// Levenshtein edit distance logic
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

// Listen for message events from main thread
self.onmessage = function(e) {
  const { id, type, payload } = e.data;
  
  try {
    let result;
    if (type === 'getEditDistance') {
      result = getEditDistance(payload.a, payload.b);
    } else if (type === 'fuzzyMatchText') {
      result = fuzzyMatchText(payload.ocrText, payload.targetName, payload.aliases);
    } else {
      throw new Error(`Unknown task type: ${type}`);
    }
    
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
