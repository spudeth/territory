// How skins are drawn (game.js uses these; tests check them). Works in the browser (window.skins) and in Node.
//   pattern: grey art tinted with the owner's color.  art: a full-color image (flags), with the owner's color as
//   a thicker border so territories stay easy to tell apart.  default: the terrain tinted with the owner's color.
(function (exports) {
  // The territory border, in texels (1/16 of a block): thicker around art, which doesn't show the owner's color.
  const borderTexels = kind => (kind === 'art' ? 2 : 1);

  // Full area coverage: one image over the whole territory, scaled to cover its bounding box (w x h) without
  // stretching (the same factor both ways), centred; what falls outside the territory is clipped by the caller.
  function coverFit(imageW, imageH, w, h) {
    const s = Math.max(w / imageW, h / imageH);
    const dw = imageW * s, dh = imageH * s;
    return { dx: (w - dw) / 2, dy: (h - dh) / 2, dw, dh };
  }

  // Prices rise as you collect (Xoren): each rarity starts at its first price and reaches its top price once you
  // own half of that rarity's skins, in a straight line, rounded to 10. [start, top] per rarity. TODO: the sheet.
  const PRICES = { Common: [100, 1500], Rare: [1000, 3000], 'Ultra Rare': [4000, 8000], Legendary: [10000, 25000] };
  function skinPrice(rarity, owned, total) {
    const [start, top] = PRICES[rarity] ?? PRICES.Common;
    return Math.round((start + (top - start) * Math.min(1, owned / Math.max(1, total / 2))) / 10) * 10;
  }

  exports.PRICES = PRICES;
  exports.skinPrice = skinPrice;
  exports.borderTexels = borderTexels;
  exports.coverFit = coverFit;
})(typeof module === 'object' ? module.exports : (window.skins = {}));
