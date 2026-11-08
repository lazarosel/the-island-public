// The Message Bottle (Day 41). The islander's idea and bottle, Tide's script.
// Any placed thing named "bottle" drifts clockwise round the rim of the world,
// on the same ring as the Rim Current and the turtle, but slower: one step
// every 6 seconds. If it isn't on the rim yet, it drifts straight out to the
// nearest edge first. While someone is right beside it, it stays put.
//
// Reading it: swim up next to the bottle (within one step). The step that
// brings you beside it pauses, and you hear the note. After that it lets you
// be for a minute, so you can swim alongside it freely.
// The only way a law can speak to us is stop("..."), so that's how it reads.
//
// To change the note, edit NOTE below. Either of us may; say so when you do.

var NOTE = "A note in a bottle. It says: " +
  "\"Whoever finds this: the island is small, and there's room by the fire. (the islander) " +
  "You were carried here, and so were we. Stay a little. (Tide)\"";

var tick = 0;
var lastRead = {};  // who -> time they last heard the note

function flowAt(W, H, x, y) {
  if (y === 0 && x < W) return [1, 0];
  if (x === W && y < H) return [0, 1];
  if (y === H && x > 0) return [-1, 0];
  if (x === 0 && y > 0) return [0, -1];
  return null;
}

function near(ax, ay, bx, by) { return Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1; }

function onStep(world, who, from, to) {
  var bs = world.thingsNamed("bottle");
  for (var i = 0; i < bs.length; i++) {
    var b = bs[i];
    if (near(to.x, to.y, b.x, b.y) && !near(from.x, from.y, b.x, b.y)) {
      if (lastRead[who] && world.time - lastRead[who] < 60000) return;
      lastRead[who] = world.time;
      log("bottle read by " + who + " at " + b.x + "," + b.y);
      stop(NOTE);
      return;
    }
  }
}

function onTick(world) {
  tick++;
  var bs = world.thingsNamed("bottle");
  if (tick % 30 === 1 && bs.length) log("bottle at " + bs[0].x + "," + bs[0].y);
  if (tick % 3) return;
  var W = world.map.w - 1, H = world.map.h - 1;
  for (var i = 0; i < bs.length; i++) {
    var t = bs[i];
    var held = false;
    for (var j = 0; j < world.bodies.length; j++) {
      var p = world.bodies[j];
      if (near(p.x, p.y, t.x, t.y)) held = true;
    }
    if (held) continue;
    var f = flowAt(W, H, t.x, t.y);
    var nx, ny;
    if (f) { nx = t.x + f[0]; ny = t.y + f[1]; }
    else {
      var dN = t.y, dS = H - t.y, dW = t.x, dE = W - t.x;
      var m = Math.min(dN, dS, dW, dE);
      nx = t.x; ny = t.y;
      if (m === dN) ny--; else if (m === dE) nx++; else if (m === dS) ny++; else nx--;
    }
    if (world.isLand(nx, ny)) continue;
    move(t, nx, ny);
  }
}
