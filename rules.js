// Game settings in one place. Change a number here and restart the server.
const settings = {
  HITS_TO_CLAIM: 3,               // taps needed to take a block
  CRACK_DECAY_SECONDS: 60,        // a cracked block loses one crack level for every this many seconds without a hit
  SQUARES_PER_FIRST_CLAIM: 1,     // squares earned for claiming an empty block (subject to the wipe rule)
  GUESTS_PER_IP: 5,               // new guest players one network may create…
  GUEST_WINDOW_MINUTES: 60,       // …in this many minutes
  RENAME_COOLDOWN_MINUTES: 10,    // wait between name changes
};

// Rules that upgrades will change per player later (Click Power, Defense, Earnings). Every caller already
// passes the players involved, so adding upgrades only means changing these functions.
//   attacker, owner: player ids (owner is null for an empty block)
const hitsToTake = (attacker, owner) => settings.HITS_TO_CLAIM;
const squaresForFirstClaim = playerId => settings.SQUARES_PER_FIRST_CLAIM;

module.exports = { ...settings, hitsToTake, squaresForFirstClaim };
