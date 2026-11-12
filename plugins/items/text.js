// The items plug-in's words (loop 19), in one place for Xoren to edit: for the browser (window.ItemsText, loaded
// before client.js) and the server (require('./text'), for the Game Guide).
(function (exports) {
  exports.name = 'Items';
  // The "i" popup next to "Your squares" on the Items tab.
  exports.info = {
    items: 'Abilities are bought once and are yours for good; each can be used a few times an hour, on any map. Demolition is used up, bought one or many at a time: each one clears everything built on one of your blocks (walls and factory), with no refund.',
  };
  // Under the Marketplace title on the Items tab.
  exports.marketIntro = 'Abilities are bought once and are yours for good; each can be used a few times an hour. Some, like Demolition, are used up. Prices follow this map\'s level.';
})(typeof module === 'object' ? module.exports : (window.ItemsText = {}));
