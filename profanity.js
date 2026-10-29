// A basic name filter. It undoes common letter swaps (0 for o, $ for s, …), ignores spaces and symbols
// between letters, and allows stretched letters ("fuuuck"), then looks for words from two lists:
//   ANYWHERE: blocked even inside a longer name ("xXshitXx").
//   WHOLE:    blocked only as a separate word, because they also appear inside ordinary words
//             ("ass" in "class", "cock" in "peacock").
// It will never catch everything. Names may only use plain letters and numbers, which keeps look-alike
// characters out.

const ANYWHERE = [
  'fuck', 'fuk', 'fuq', 'fck', 'fcuk', 'phuk', 'phuck', 'shit', 'shyt', 'cunt', 'kunt', 'bitch', 'biatch',
  'whore', 'slut', 'twat', 'wank', 'pussy', 'penis', 'vagina', 'dildo', 'porn', 'jizz', 'boob', 'rapist',
  'asshole', 'bastard', 'bollock', 'blowjob', 'handjob', 'nigger', 'nigga', 'nigr', 'faggot', 'retard',
  'tranny', 'kike', 'beaner', 'wetback', 'nazi', 'hitler', 'kkk',
];
const WHOLE = [
  'ass', 'arse', 'dick', 'cock', 'cum', 'tit', 'tits', 'anal', 'anus', 'rape', 'sex', 'sexy', 'horny', 'milf',
  'fag', 'dyke', 'homo', 'spic', 'chink', 'coon', 'gook', 'paki', 'heil', 'hoe', 'piss', 'crap', 'niger',
];

// Characters people swap in for letters. '1' and '|' can stand for i or l, so both readings are checked.
const SWAPS = { 0: 'o', 3: 'e', 4: 'a', '@': 'a', 5: 's', $: 's', 7: 't', '+': 't', 8: 'b', 9: 'g', 6: 'g', '!': 'i' };

// "boob" becomes b+o{2,}b+: any letter may be stretched, but none may go missing, so "Bob" stays allowed.
const pattern = word => word.match(/(.)\1*/g).map(run => run[0] + (run.length > 1 ? `{${run.length},}` : '+')).join('');
const anywhere = new RegExp(ANYWHERE.map(pattern).join('|'));
const whole = new RegExp(`^(?:${WHOLE.map(pattern).join('|')})$`);

// Slurs, matched after doubled letters are squeezed to one ("nibba" -> "niba"), so they catch the variants
// people use to get past a word list: vowel swaps (i/e/y), letter swaps (g/q/b, k/c), and "-a", "-ah", "-uh",
// "-er" or "-ur" endings, plus a plural s or z.
//   SLURS: blocked anywhere in a name. SLURS_WHOLE: only as a separate word (they hide inside ordinary words).
const END = '(?:a|ah|uh|az|as|er|ers|ur|uz|ar|as|let)?[sz]?';
const SLURS = [
  `n[iey]+[gqb](?:a|ah|uh|az|as|er(?!ia)|ur|ar)[sz]?`, `n[iey]+[gq]let`,   // the n-word and variants; not "Nigeria(n)"
  `f[aeiou]g[aeiou]t[sz]?`, `f[aeiou]gz`, `tran(?:y|ie|ey)[sz]?`, `k[iy]k(?:e|es|ey)`, `wetb[ae][ck]+`, `b[ea]+ner[sz]?`,
  `ret[ae]rd`,
];
const SLURS_WHOLE = ['n[iey]+[gq]', 'niger', 'fag', 'spi[ck]', 'chin[ck]', 'c[o0]+n', 'g[o0]+k', 'pak[iy]', 'd[iy]ke', 'tard', 'kike']
  .map(w => w + END);
const slurAnywhere = new RegExp(SLURS.join('|'));
const slurWhole = new RegExp(`^(?:${SLURS_WHOLE.join('|')})$`);

// True when a word or name contains a slur (see SLURS). Used by names and by the chat filter.
function hasSlur(text) {
  const swapped = [...String(text).toLowerCase()].map(ch => SWAPS[ch] ?? ch).join('');
  for (const reading of [swapped.replace(/[1|!]/g, 'i'), swapped.replace(/[1|]/g, 'l')]) {
    const squeeze = t => t.replace(/(.)\1+/g, '$1');
    const letters = squeeze(reading.replace(/[^a-z]/g, ''));
    if (slurAnywhere.test(letters) || slurWhole.test(letters)) return true;
    if (reading.split(/[^a-z]+/).some(word => slurWhole.test(squeeze(word)))) return true;
  }
  return false;
}

function isProfane(name) {
  if (hasSlur(name)) return true;
  const swapped = [...name.toLowerCase()].map(ch => SWAPS[ch] ?? ch).join('');
  for (const reading of [swapped.replace(/[1|]/g, 'i'), swapped.replace(/[1|]/g, 'l')]) {
    const letters = reading.replace(/[^a-z]/g, '');
    if (anywhere.test(letters) || whole.test(letters)) return true;   // whole: e.g. "A.S.S"
    if (reading.split(/[^a-z]+/).some(word => whole.test(word))) return true;
  }
  return false;
}

module.exports = { isProfane, hasSlur };
