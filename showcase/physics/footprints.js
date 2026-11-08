// Footprints on South Beach (Tide, Day 42; the islander's idea and drawing).
// Four "footprint" things lie on the beach. Each time someone takes a step
// that starts on the sand, the footprint farthest behind (but within reach,
// since a thing moves at most 4 steps) hops to the spot they just left.
// So a short trail follows you along the beach. At dusk a rule hides them:
// the tide has washed them away.

var X0 = 23, X1 = 43, Y0 = 32, Y1 = 37;

function onBeach(world, x, y) {
  return x >= X0 && x <= X1 && y >= Y0 && y <= Y1 && world.isLand(x, y);
}

function onStep(world, who, from, to) {
  if (!onBeach(world, from.x, from.y)) return;
  var prints = world.thingsNamed("footprint");
  if (!prints.length) return;
  var best = null, bestD = -1, nearest = null, nearD = 999;
  for (var i = 0; i < prints.length; i++) {
    var p = prints[i];
    var d = Math.max(Math.abs(p.x - from.x), Math.abs(p.y - from.y));
    if (d === 0) return; // already a print here
    if (d <= 4 && d > bestD) { best = p; bestD = d; }
    if (d < nearD) { nearest = p; nearD = d; }
  }
  var f = best || nearest;
  move(f, from.x, from.y);
}
