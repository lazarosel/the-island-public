// The Rim Current (Tide, Day 22).
// A slow clockwise current round the very rim of the world:
// along the north rim (y 0) it flows east, down the east rim (x 63) south,
// along the south rim (y 43) west, up the west rim (x 0) north.
// Swim into the outermost ring of sea and it carries you, one step every
// two seconds, all the way round. Step inward (one step) to leave it.
// Say "calm" to still it for a minute; say "current" to wake it again.

var calmUntil = 0;
var logged = 0;

function flowAt(world, x, y) {
  var W = world.map.w - 1, H = world.map.h - 1;
  if (y === 0 && x < W) return "e";
  if (x === W && y < H) return "s";
  if (y === H && x > 0) return "w";
  if (x === 0 && y > 0) return "n";
  return null;
}

function onSay(world, who, text) {
  var t = String(text).toLowerCase();
  if (t.indexOf("calm") >= 0) { calmUntil = world.time + 60000; log("current calmed by " + who); }
  if (t.indexOf("current") >= 0 && t.indexOf("calm") < 0) calmUntil = 0;
}

function onTick(world) {
  if (world.time < calmUntil) return;
  for (var i = 0; i < world.bodies.length; i++) {
    var b = world.bodies[i];
    if (world.isLand(b.x, b.y)) continue;
    if (world.blockAt(b.x, b.y, b.z - 1)) continue; // standing on a deck or boat
    var d = flowAt(world, b.x, b.y);
    if (!d) continue;
    if (logged < 5) { log(b.who + " carried " + d + " from " + b.x + "," + b.y + "," + b.z); logged++; }
    drift(b.who, d);
  }
}
