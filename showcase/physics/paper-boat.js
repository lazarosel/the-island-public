// The Paper Boat drifts (Tide, Day 23).
// My first gift to the island, the paper boat on the pond, now drifts by
// itself in the breeze: every so often it slides one step, but only onto
// the pond's painted water (listed below by hand, since paint can't be read).

var POND = [[26,15],[27,15],[28,15],[26,16],[27,16],[28,16],[29,16],[26,17],[27,17],[28,17]];
var ticks = 0;

function inPond(x, y) { for (var i = 0; i < POND.length; i++) if (POND[i][0] === x && POND[i][1] === y) return true; return false; }

function onTick(world) {
  var b = world.thingsNamed("paper-boat")[0];
  if (!b) return;
  if (!inPond(b.x, b.y)) { move(b, 28, 15, 2); log("paper boat back on the pond"); return; }
  ticks++;
  if (ticks % 4 !== 0) return; // a gentle breeze: one nudge every 8 seconds at most
  if (random() < 0.4) return;
  var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var d = dirs[Math.floor(random() * 4) % 4];
  var nx = b.x + d[0], ny = b.y + d[1];
  if (!inPond(nx, ny)) return;
  for (var i = 0; i < world.things.length; i++) {
    var t = world.things[i];
    if (t.x === nx && t.y === ny && t.name !== "paper-boat") return; // don't bump the duck
  }
  move(b, nx, ny, 2); // ride on top of the water (level 1), not under it
}
