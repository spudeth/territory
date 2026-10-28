// The tutorial and first-time tips, as data. coach.js runs them; to add a step, add an entry here.
// Works in the browser (window.tutorial) and in Node (require), where the tests check every entry.
//
// A step:
//   id         unique, letters and dashes (saved as the player's place in the tutorial)
//   title      a short heading, shown in capitals
//   text       what to say; {hits} becomes the hits needed to take a block
//   highlight  what to point at (optional):
//                { element: 'CSS selector' }   something on screen or in the menu
//                { blocks: 'grown' | 'lit' | 'others' | 'mine' }   blocks on the map:
//                  grown  = the block that appeared when you last claimed a brand-new block
//                  lit    = the blocks you can claim next (touching your land)
//                  others = other players' blocks
//                  mine   = your blocks
//   focus      true: move the map so the highlighted block is in the middle
//   counter    true: show your hits on the block you're tapping (3/10)
//   start      a trigger that must happen before the step shows (optional; otherwise it shows straight away)
//   done       the trigger that finishes the step: 'next' (the Next button) or one of TRIGGERS
//
// A tip shows once ever, the first time its trigger happens: { id, title, text, on }.

(function (exports) {
  // Everything the game reports to the tutorial.
  const TRIGGERS = [
    'next',          // the Next button
    'spawned',       // Spawn on the setup screen
    'hit',           // one of your taps landed
    'claimed',       // you claimed a block
    'grew',          // the map grew
    'taken',         // another player took one of your blocks
    'denied:range',  // you tapped a block that doesn't touch your land
    'squares',       // you earned squares
    'achievement',   // you earned an achievement
    'menu:closed',   // the menu closed
    'menu:main', 'menu:maps', 'menu:skins', 'menu:achievements', 'menu:upgrades', 'menu:settings',   // a menu screen opened
  ];

  const STEPS = [
    { id: 'goal', title: 'The goal', text: 'Own the most blocks on this map. The leaderboard shows who is winning.',
      highlight: { element: '#board' }, done: 'next' },
    { id: 'claim', title: 'Claiming', text: 'Tap an empty block {hits} times to claim it. Keep tapping the same block.',
      counter: true, done: 'claimed' },
    { id: 'growth', title: 'Growth', text: 'Every brand-new block you claim makes the map grow. This block just appeared on the edge.',
      highlight: { blocks: 'grown' }, focus: true, done: 'next' },
    { id: 'range', title: 'Range', text: 'You can only claim blocks touching your land. Those are lit up.',
      highlight: { blocks: 'lit' }, done: 'next' },
    { id: 'taking', title: 'Taking', text: "You can take other players' blocks the same way, and they can take yours.",
      highlight: { blocks: 'others' }, done: 'next' },
    { id: 'menu', title: 'The menu', text: 'Open the menu.',
      highlight: { element: '#menu-button' }, done: 'menu:main' },
    { id: 'menu-maps', title: 'Maps', text: 'Switch to other maps here.',
      highlight: { element: '[data-view="main"] [data-go="maps"]' }, done: 'next' },
    { id: 'menu-skins', title: 'Skins', text: 'Skins change how your land looks.',
      highlight: { element: '[data-view="main"] [data-go="skins"]' }, done: 'next' },
    { id: 'menu-achievements', title: 'Achievements', text: 'Your achievements and how close you are to the next ones.',
      highlight: { element: '[data-view="main"] [data-go="achievements"]' }, done: 'next' },
    { id: 'menu-settings', title: 'Settings', text: 'Your name, sound and music, and a fresh start on this map. That is everything. Have fun!',
      highlight: { element: '[data-view="main"] [data-go="settings"]' }, done: 'next' },
  ];

  const TIPS = [
    { id: 'taken', on: 'taken', title: 'A block was taken',
      text: 'Someone took one of your blocks. Take it back the same way: tap it {hits} times.' },
    { id: 'range', on: 'denied:range', title: 'Out of range',
      text: 'You can only claim blocks touching your land: up, down, left or right. The lit-up blocks are in range.' },
    { id: 'square', on: 'squares', title: 'Your first square',
      text: 'You earn squares for claiming brand-new blocks. Soon you can spend them on skins and more.' },
    { id: 'achievement', on: 'achievement', title: 'Your first achievement',
      text: 'See them all, and what comes next, in Menu > Achievements.' },
  ];

  exports.TRIGGERS = TRIGGERS;
  exports.STEPS = STEPS;
  exports.TIPS = TIPS;
})(typeof module === 'object' ? module.exports : (window.tutorial = {}));
