// Random guest names like "Sly Wolf". Names are unique, so the lists give 900 pairs before a number is added.
// Adjectives are at most 6 letters and animals at most 5, so "Mighty Robin 99" is the longest (15, the limit).
const ADJ = ['Swift', 'Brave', 'Lucky', 'Quiet', 'Bold', 'Sly', 'Happy', 'Wild', 'Tiny', 'Grand',
  'Calm', 'Eager', 'Fuzzy', 'Jolly', 'Keen', 'Merry', 'Noble', 'Proud', 'Rapid', 'Sunny',
  'Witty', 'Zesty', 'Brisk', 'Clever', 'Daring', 'Gentle', 'Mighty', 'Plucky', 'Rusty', 'Snowy'];
const ANIMALS = ['Fox', 'Owl', 'Bear', 'Wolf', 'Hare', 'Lynx', 'Crow', 'Elk', 'Toad', 'Moth',
  'Mole', 'Wren', 'Frog', 'Seal', 'Yak', 'Newt', 'Swan', 'Deer', 'Duck', 'Goat',
  'Hawk', 'Ibis', 'Kiwi', 'Lark', 'Mink', 'Orca', 'Puma', 'Robin', 'Stoat', 'Otter'];
const { isProfane } = require('./profanity');

const pick = a => a[Math.floor(Math.random() * a.length)];

const guestName = () => pick(ADJ) + ' ' + pick(ANIMALS);

// Names to try in order when saving a new guest: the one they were shown, then fresh pairs, then pairs with a number.
// Numbers that read as words ("8008") are skipped.
function* guestNames(first) {
  yield first;
  for (let i = 0; i < 10; i++) yield guestName();
  for (let i = 0; i < 20; i++) {
    const name = guestName() + ' ' + (10 + Math.floor(Math.random() * 90));
    if (!isProfane(name)) yield name;
  }
}

// Names to try for a new account: "NewUser" and a number, with more digits if the short ones keep colliding.
function* accountNames() {
  for (let i = 0; i < 30; i++) {
    const name = 'NewUser' + (i < 10 ? 1000 + Math.floor(Math.random() * 9000) : 10000 + Math.floor(Math.random() * 990000));
    if (!isProfane(name)) yield name;
  }
}

// Checks a name a player typed. Returns { name } (tidied up) or { error } to show them.
// Uniqueness is checked by the database when the name is saved.
const RESERVED = /^(admin|administrator|moderator|mod|staff|system|support|official|territory|server|newuser.*)$/i;
function checkName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Type a name' };
  if (name.length > 15) return { error: 'Names can be at most 15 characters' };
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(name)) return { error: 'Use letters, numbers, spaces, - _ and . only, starting with a letter or number' };
  if (RESERVED.test(name.replace(/[ _.-]/g, ''))) return { error: 'That name is reserved' };
  if (isProfane(name)) return { error: "That name isn't allowed" };
  return { name };
}

// Any hue except grass green (75-165).
const randomColor = () => `hsl(${(165 + Math.floor(Math.random() * 270)) % 360}, 75%, 55%)`;

module.exports = { guestName, guestNames, accountNames, checkName, randomColor };
