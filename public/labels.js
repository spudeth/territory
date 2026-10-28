// When to show an owner's name on their territory: when it covers at least a share of the view (the sheet's
// nameLabelShare; the server sends it to the browser).
// Works in the browser (as a plain script) and on the server (require), so both agree.
(function (exports) {
  // Owners whose blocks cover at least `share` of the view, biggest first.
  //   cells: Map "x,y" -> owner id or null (blocks that exist; anything else is empty)
  //   view:  the visible area in block units { x, y, width, height }; it may cut blocks in half
  // Returns [{ owner, share, cx, cy }]: the share of the view they cover (0-1), and the centre of their
  // visible blocks, a natural place for the label.
  function namesToShow(cells, view, share) {
    const area = view.width * view.height;
    if (!(area > 0)) return [];
    const totals = new Map();
    const x1 = view.x + view.width, y1 = view.y + view.height;
    for (let by = Math.floor(view.y); by < y1; by++) {
      const h = Math.min(by + 1, y1) - Math.max(by, view.y);
      for (let bx = Math.floor(view.x); bx < x1; bx++) {
        const owner = cells.get(bx + ',' + by);
        if (owner == null) continue;
        const w = Math.min(bx + 1, x1) - Math.max(bx, view.x), a = w * h;
        const t = totals.get(owner) ?? totals.set(owner, { a: 0, sx: 0, sy: 0 }).get(owner);
        t.a += a;
        t.sx += a * (Math.max(bx, view.x) + w / 2);
        t.sy += a * (Math.max(by, view.y) + h / 2);
      }
    }
    const out = [];
    for (const [owner, t] of totals) {
      if (t.a / area >= share - 1e-9) out.push({ owner, share: t.a / area, cx: t.sx / t.a, cy: t.sy / t.a });
    }
    return out.sort((p, q) => q.share - p.share);
  }

  exports.namesToShow = namesToShow;
})(typeof module === 'object' ? module.exports : (window.labels = {}));
