// THE SHY DUCK (islander, Day 40)
// Now the pond is real water (Tide filled it), the duck paddles away
// from anyone who wades too close, but never leaves the water.

function water(world, x, y) {
  return world.waterAt(x, y, 1) || world.waterAt(x, y, 2);
}

function onTick(world) {
  var ducks = world.thingsNamed("duck");
  for (var i = 0; i < ducks.length; i++) {
    var d = ducks[i];
    var near = null;
    for (var j = 0; j < world.bodies.length; j++) {
      var b = world.bodies[j];
      if (Math.abs(b.x - d.x) <= 1 && Math.abs(b.y - d.y) <= 1) { near = b; break; }
    }
    if (!near) continue;
    // try the steps that take it furthest from the person
    var best = null, bestD = -1;
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
      var nx = d.x + dx, ny = d.y + dy;
      if ((dx || dy) && water(world, nx, ny)) {
        var dist = Math.abs(nx - near.x) + Math.abs(ny - near.y);
        var taken = false;
        for (var k = 0; k < world.bodies.length; k++)
          if (world.bodies[k].x === nx && world.bodies[k].y === ny) taken = true;
        if (!taken && dist > bestD) { bestD = dist; best = [nx, ny]; }
      }
    }
    if (best && bestD > Math.abs(d.x - near.x) + Math.abs(d.y - near.y)) move(d, best[0], best[1], 2); // 2 = on top of the water, not under it
  }
}
