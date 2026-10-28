// Text chat rules: one chat per map, kept only in memory (the last HISTORY messages per map, for players who
// arrive). cleanMessage() tidies what a player typed and hides bad words.
const MAX_LENGTH = 120;        // characters per message
const MIN_GAP_MS = 2000;       // one message per 2 seconds per player
const HISTORY = 30;            // messages a player sees when they arrive on a map

// Words hidden as ***. A word is hidden when it is one of these, or starts with one marked with a trailing *.
// Checked after undoing common disguises (f.u.c.k, sh1t, fuuuck).
const BAD = [
  'fuck*', 'fuk*', 'fck*', 'fuq*', 'motherfuck*', 'shit', 'shits', 'shite', 'shitty', 'shitter', 'shitting', 'shithead*', 'shithole*', 'shitshow', 'shitload', 'bullshit*', 'bitch*', 'biatch', 'cunt*',
  'dick', 'dicks', 'dickhead*', 'cock', 'cocks', 'cocksuck*', 'pussy', 'pussies', 'asshole*', 'arsehole*', 'bastard*',
  'whore*', 'slut*', 'wank*', 'twat*', 'prick', 'pricks', 'dildo*', 'porn*', 'penis*', 'vagina*', 'boob', 'boobs',
  'tits', 'titties', 'cum', 'cumming', 'jizz*', 'rape*', 'rapist*', 'molest*', 'pedo*', 'paedo*', 'nazi*', 'hitler',
  'kys', 'retard*', 'nigger*', 'nigga*', 'niga', 'nibba*', 'faggot*', 'fag', 'fags', 'faggy', 'dyke*', 'tranny*', 'kike*',
  'spic', 'spics', 'chink*', 'gook*', 'wetback*', 'beaner*', 'coon', 'coons', 'raghead*', 'towelhead*', 'paki', 'pakis',
];
const exact = new Set(BAD.filter(w => !w.endsWith('*')));
const stems = BAD.filter(w => w.endsWith('*')).map(w => w.slice(0, -1));
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

// A word as the filter sees it: lower case, disguises undone, letters repeated 3+ times squeezed to one.
function plain(word) {
  return [...word.toLowerCase()].map(c => LEET[c] ?? c).join('').replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1');
}
function isBad(word) {
  const w = plain(word);
  if (!w) return false;
  const squeezed = w.replace(/(.)\1+/g, '$1');   // "fuuck" -> "fuck", "shiit" -> "shit"
  return [w, squeezed].some(v => exact.has(v) || stems.some(s => v.startsWith(s)));
}

// What a player typed -> the message others see, or null when nothing is left.
// Spaced-out letters ("f u c k", "f.u.c.k") are joined and checked as one word.
function cleanMessage(raw) {
  if (typeof raw !== 'string') return null;
  let text = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
  if (!text) return null;
  // Runs of single characters split by spaces or dots: check them joined.
  text = text.replace(/(?:^|(?<=\s))(?:[^\s][.\s_-]){2,}[^\s](?=\s|$)/g, run => isBad(run) ? '***' : run);
  return text.replace(/[^\s]+/g, w => isBad(w) ? '***' : w);
}

module.exports = { MAX_LENGTH, MIN_GAP_MS, HISTORY, cleanMessage, isBad };
