// Random guest names like "Sly Wolf". Names are unique, so the lists give 900 pairs before a number is added.
// Adjectives are at most 6 letters and animals at most 5, so "Mighty Robin 99" is the longest (15, the limit).
const ADJ = ['Swift', 'Brave', 'Lucky', 'Quiet', 'Bold', 'Sly', 'Happy', 'Wild', 'Tiny', 'Grand',
  'Calm', 'Eager', 'Fuzzy', 'Jolly', 'Keen', 'Merry', 'Noble', 'Proud', 'Rapid', 'Sunny',
  'Witty', 'Zesty', 'Brisk', 'Clever', 'Daring', 'Gentle', 'Mighty', 'Plucky', 'Rusty', 'Snowy'];
const ANIMALS = ['Fox', 'Owl', 'Bear', 'Wolf', 'Hare', 'Lynx', 'Crow', 'Elk', 'Toad', 'Moth',
  'Mole', 'Wren', 'Frog', 'Seal', 'Yak', 'Newt', 'Swan', 'Deer', 'Duck', 'Goat',
  'Hawk', 'Ibis', 'Kiwi', 'Lark', 'Mink', 'Orca', 'Puma', 'Robin', 'Stoat', 'Otter'];
const pick = a => a[Math.floor(Math.random() * a.length)];

const guestName = () => pick(ADJ) + ' ' + pick(ANIMALS);

// Names to try in order when saving a new guest: the one they were shown, then fresh pairs, then pairs with a number.
function* guestNames(first) {
  yield first;
  for (let i = 0; i < 10; i++) yield guestName();
  for (let i = 0; i < 20; i++) yield guestName() + ' ' + (10 + Math.floor(Math.random() * 90));
}

// Any hue except grass green (75-165).
const randomColor = () => `hsl(${(165 + Math.floor(Math.random() * 270)) % 360}, 75%, 55%)`;

module.exports = { guestName, guestNames, randomColor };
