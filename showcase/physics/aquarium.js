// SEA CREATURES: the Sea Turtle and the Aquarium, in one file.
// (The island runs at most 8 scripts, and an empty file still counts, so
// turtle.js is now only a note pointing here. Day 46.)

// ---------------------------------------------------------------------------
// The Sea Turtle (islander's idea and drawing, Tide's script, Day 27-ish).
// Any placed thing named "turtle" swims clockwise round the rim of the world,
// riding the same ring as the Rim Current: east along the north rim, south
// down the east rim, west along the south rim, north up the west rim.
// One step every 4 seconds (every other tick). If it isn't on the rim yet,
// it swims straight out to the nearest edge first.
// If someone is swimming right where it wants to go, it waits for them.
// Day 45: it notices you. If someone is right beside it (one step, any
// direction), it stops to look at you for a while (about 12 seconds),
// then swims on and won't stop for the same visit again until you've
// let it go (nobody near). The head lifting is a rule in rules.txt:
// "when someone is near turtle within 1: turtle becomes turtle-look".

var tick = 0;
var looked = {};   // turtle id -> ticks spent looking at whoever is near

function someoneBeside(world, t) {
  for (var j = 0; j < world.bodies.length; j++) {
    var b = world.bodies[j];
    if (Math.abs(b.x - t.x) <= 1 && Math.abs(b.y - t.y) <= 1) return true;
  }
  return false;
}

function flowAt(W, H, x, y) {
  if (y === 0 && x < W) return [1, 0];
  if (x === W && y < H) return [0, 1];
  if (y === H && x > 0) return [-1, 0];
  if (x === 0 && y > 0) return [0, -1];
  return null;
}

function onTick(world) {
  aquariumTick(world);
  turtleTick(world);
}

function turtleTick(world) {
  tick++;
  var ts0 = world.thingsNamed("turtle");
  for (var k = 0; k < ts0.length; k++) {
    var tt = ts0[k];
    if (someoneBeside(world, tt)) looked[tt.id] = (looked[tt.id] || 0) + 1;
    else looked[tt.id] = 0;
  }
  if (tick % 15 === 1 && ts0.length) log("turtle at " + ts0[0].x + "," + ts0[0].y);
  if (tick % 2) return;
  var W = world.map.w - 1, H = world.map.h - 1;
  var ts = ts0;
  for (var i = 0; i < ts.length; i++) {
    var t = ts[i];
    var n = looked[t.id] || 0;
    if (n > 0 && n <= 6) continue;   // pausing to look at you
    var f = flowAt(W, H, t.x, t.y);
    var nx, ny;
    if (f) { nx = t.x + f[0]; ny = t.y + f[1]; }
    else {
      var dN = t.y, dS = H - t.y, dW = t.x, dE = W - t.x;
      var m = Math.min(dN, dS, dW, dE);
      nx = t.x; ny = t.y;
      if (m === dN) ny--; else if (m === dE) nx++; else if (m === dS) ny++; else nx--;
    }
    var blocked = false;
    for (var j = 0; j < world.bodies.length; j++) {
      var b = world.bodies[j];
      if (b.x === nx && b.y === ny) blocked = true;
    }
    if (blocked) continue;
    move(t, nx, ny);
  }
}

// ---------------------------------------------------------------------------
// The Aquarium (Day 46). Tide's script; the islander's tank and fish.
// The tank stands in the sea off the NE shore: glass walls x 52..60, y 10..16.
// Any placed thing whose name has "fish" in it and stands inside the tank
// (x 53..59, y 11..15) swims here:
//  - calm: it cruises, one step every 4 seconds, holding a heading for a
//    while and turning now and then, never leaving the glass;
//  - startled: if anyone is within 2 steps, it darts up to 3 steps directly
//    away (sliding along the glass if the wall is in the way).

var AX0 = 53, AX1 = 59, AY0 = 11, AY1 = 15;
var aqTick = 0;
var fishNames = null;   // names of things that count as aquarium fish
var heading = {};   // fish id -> [dx, dy]
var depth = {};     // fish id -> level it likes to swim at (2 by the sand .. 4 at the top)
var DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];

// Say "feed" near the tank (within 4 steps of the glass): for half a minute
// the fish come TO you instead of fleeing. (The islander's idea, Day 46.)
var feedUntil = 0;
function onSay(world, who, text) {
  if (!/feed/i.test(text)) return;
  var b = world.body(who);
  if (!b) return;
  if (b.x >= AX0 - 5 && b.x <= AX1 + 5 && b.y >= AY0 - 5 && b.y <= AY1 + 5) {
    feedUntil = world.time + 30000;
    log("aquarium: feeding time, called by " + who);
  }
}

function inTank(x, y) { return x >= AX0 && x <= AX1 && y >= AY0 && y <= AY1; }
function clampX(x) { return Math.max(AX0, Math.min(AX1, x)); }
function clampY(y) { return Math.max(AY0, Math.min(AY1, y)); }
function sign(n) { return n > 0 ? 1 : (n < 0 ? -1 : 0); }

function aquariumTick(world) {
  aqTick++;
  // Day 59: it got paused for running over 30 ms. Scanning every thing on the
  // island each tick was the heavy part, so now we only scan for fish NAMES
  // once a minute, and in between ask for just those names.
  if (aqTick % 30 === 1 || !fishNames) {
    fishNames = {};
    for (var i = 0; i < world.things.length; i++) {
      var t0 = world.things[i];
      if (t0.name && t0.name.indexOf("fish") >= 0 && t0.name !== "leaping-fish" && inTank(t0.x, t0.y)) fishNames[t0.name] = true;
    }
  }
  var fs = [];
  for (var nm in fishNames) {
    var got = world.thingsNamed(nm);
    for (var g = 0; g < got.length; g++) if (inTank(got[g].x, got[g].y)) fs.push(got[g]);
  }
  if (aqTick % 30 === 1) log("aquarium: " + fs.length + " fish");
  for (var k = 0; k < fs.length; k++) {
    var f = fs[k];
    var near = null, bd = 99;
    for (var j = 0; j < world.bodies.length; j++) {
      var b = world.bodies[j];
      var d = Math.max(Math.abs(b.x - f.x), Math.abs(b.y - f.y));
      if (d < bd) { bd = d; near = b; }
    }
    if (near && world.time < feedUntil) {
      // feeding time: swim toward whoever is nearest, and stop just short of them
      // each fish aims for its own spot in a ring round you, so they don't stack
      var ring = DIRS[k % DIRS.length];
      var px = clampX(near.x + ring[0]), py = clampY(near.y + ring[1]);
      var gx = clampX(f.x + sign(px - f.x)), gy = clampY(f.y + sign(py - f.y));
      if (gx !== f.x || gy !== f.y) move(f, gx, gy, 2 + Math.floor(random() * 3));
      continue;
    }
    if (near && bd <= 2) {
      var dx = sign(f.x - near.x), dy = sign(f.y - near.y);
      if (dx === 0 && dy === 0) dx = random() < 0.5 ? 1 : -1;
      var tx = clampX(f.x + dx * 3), ty = clampY(f.y + dy * 3);
      if (tx === f.x && ty === f.y) {   // pinned against the glass: slide along it
        if (dx !== 0) ty = clampY(f.y + (f.y < (AY0 + AY1) / 2 ? 3 : -3));
        else tx = clampX(f.x + (f.x < (AX0 + AX1) / 2 ? 3 : -3));
      }
      heading[f.id] = [dx, dy];
      if (tx !== f.x || ty !== f.y) move(f, tx, ty, depth[f.id] || f.z);
      continue;
    }
    if (aqTick % 2) continue;
    var h = heading[f.id];
    if (!h || (h[0] === 0 && h[1] === 0) || random() < 0.25) h = DIRS[Math.floor(random() * DIRS.length)];
    if (!inTank(f.x + h[0], f.y)) h = [-h[0], h[1]];
    if (!inTank(f.x, f.y + h[1])) h = [h[0], -h[1]];
    heading[f.id] = h;
    if (depth[f.id] === undefined || random() < 0.2) depth[f.id] = 2 + Math.floor(random() * 3);  // levels 2..4
    if (random() < 0.3) continue;   // fish idle a little
    move(f, clampX(f.x + h[0]), clampY(f.y + h[1]), depth[f.id]);
  }
}
