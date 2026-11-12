// The walls plug-in's words (loop 19), in one place for Xoren to edit: for the browser (window.WallsText) and the
// server (require('./text'), for the Game Guide).
(function (exports) {
  exports.name = 'Walls';
  exports.info = {
    walls: 'A wall on an outer edge of your land makes attackers break it before they can hit the block behind it. Up to 2 per block. You can\'t claim across your own wall, and only Demolition removes it. Tap your own block to repair its most cracked wall.',
  };
})(typeof module === 'object' ? module.exports : (window.WallsText = {}));
