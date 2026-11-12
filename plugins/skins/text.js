// The skins plug-in's words (loop 19), in one place for Xoren to edit: for the browser (window.SkinsText) and the
// server (require('./text'), for the Game Guide).
(function (exports) {
  exports.name = 'Skins';
  exports.info = {
    coverage: 'Per block repeats your skin on every block. Full area shows one big image over your whole territory.',
    skinPrices: 'A skin costs a set number of work-hours for its rarity, in squares at this map\'s level, so prices are fair at every level. Flags are Rare.',
    starring: 'Star one pattern and one art skin as your favorites. They show at the top here and on your profile.',
  };
})(typeof module === 'object' ? module.exports : (window.SkinsText = {}));
