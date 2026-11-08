// The Crab walks sideways (Tide, Day 41; the islander's idea).
// Crabs only go east and west. Mine scuttles along the NE shore, x 43..50,
// staying on land. If someone steps right up beside it (1 step), it darts
// into the sea next to it and waits there until they move away, then
// comes back ashore. (Within 4 steps, saying "crab" still makes it wave.)

var MINX = 43, MAXX = 50;
var ticks = 0;

function near(world, x, y, r) {
  for (var i = 0; i < world.bodies.length; i++) {
    var b = world.bodies[i];
    if (Math.abs(b.x - x) <= r && Math.abs(b.y - y) <= r) return true;
  }
  return false;
}

function occupied(world, x, y) {
  for (var i = 0; i < world.things.length; i++) {
    var t = world.things[i];
    if (t.x === x && t.y === y && t.name !== "crab") return true;
  }
  return false;
}

function onTick(world) {
  var c = world.thingsNamed("crab")[0];
  if (!c) return;
  ticks++;
  var onLand = world.isLand(c.x, c.y);

  if (onLand) {
    if (near(world, c.x, c.y, 1)) {
      // dart into the nearest sea beside it
      var tries = [[0, -1], [1, 0], [-1, 0], [0, 1], [1, -1], [-1, -1]];
      for (var i = 0; i < tries.length; i++) {
        var nx = c.x + tries[i][0], ny = c.y + tries[i][1];
        if (!world.isLand(nx, ny) && !occupied(world, nx, ny)) { move(c, nx, ny); log("crab hid in the sea at " + nx + "," + ny); return; }
      }
      return;
    }
    if (ticks % 2 !== 0 || random() < 0.4) return;
    var dx = random() < 0.5 ? -1 : 1;
    var x2 = c.x + dx;
    if (x2 < MINX || x2 > MAXX || !world.isLand(x2, c.y) || occupied(world, x2, c.y)) return;
    if (Math.abs(world.heightAt(x2, c.y) - world.heightAt(c.x, c.y)) > 1) return;
    move(c, x2, c.y);
  } else {
    // in the sea: come back ashore once nobody is close
    if (near(world, c.x, c.y, 2)) return;
    if (ticks % 3 !== 0) return;
    var back = [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1]];
    for (var j = 0; j < back.length; j++) {
      var bx = c.x + back[j][0], by = c.y + back[j][1];
      if (world.isLand(bx, by) && bx >= MINX && bx <= MAXX && !occupied(world, bx, by) && !near(world, bx, by, 1)) { move(c, bx, by); log("crab came ashore at " + bx + "," + by); return; }
    }
  }
}
