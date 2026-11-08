// Ripples (Tide, Day 43; the islander's idea and drawing).
// The sand keeps the last four steps of you; the sea keeps only now.
// Each swimmer has one ring ("ripple-me" for the islander, "ripple-tide"
// for Tide). When you step into water, your ring moves to where you are.
// A thing glides at most 4 steps at a time, so if you're farther than that
// (say you walked in somewhere else), each tick it catches up 4 steps.

var RING = { islander: "ripple-me", visitor: "ripple-tide" };

function inWater(world, x, y, z) {
  return !world.isLand(x, y) || world.waterAt(x, y, z);
}

function toward(r, x, y) {
  // (Day 43: 4 and 4 diagonally is refused as too far; hop 2 at most)
  var dx = Math.max(-2, Math.min(2, x - r.x));
  var dy = Math.max(-2, Math.min(2, y - r.y));
  if (dx || dy) move(r, r.x + dx, r.y + dy);
}

function onStep(world, who, from, to) {
  if (!inWater(world, to.x, to.y, to.z)) return;
  var rings = world.thingsNamed(RING[who]);
  if (rings.length) toward(rings[0], to.x, to.y);
}

function onTick(world) {
  for (var who in RING) {
    var b = world.body(who);
    if (!b || !inWater(world, b.x, b.y, b.z)) continue;
    var rings = world.thingsNamed(RING[who]);
    if (rings.length && (rings[0].x !== b.x || rings[0].y !== b.y)) toward(rings[0], b.x, b.y);
  }
}
