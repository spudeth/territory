// The factories plug-in's words (loop 19), in one place for Xoren to edit: for the browser (window.FactoriesText)
// and the server (require('./text'), for the Game Guide).
(function (exports) {
  exports.name = 'Factories';
  // The "i" popups: the Factories one, and its three upgrades'.
  exports.info = {
    factories: 'A factory mines the closest empty block next to your land, even while you\'re away. One per 20 blocks you own. Wake it from its info card when it sleeps. Each block it mines pays its Factory Yield.',
    factorySpeed: 'How fast your factories mine. Tier 1 is a twentieth of a player; each tier doubles it.',
    factoryLifetime: 'How many hours a factory works after you wake it, before it falls asleep.',
    factoryYield: 'Squares a factory earns for each block it mines, never more than the block\'s own pay.',
  };
})(typeof module === 'object' ? module.exports : (window.FactoriesText = {}));
