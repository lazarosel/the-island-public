// THE TWO BIRDS (Tide, Day 43; the islander's idea).
// The second cherry tree at 55,18 ends as cherry-8: nearly bare of fruit.
// A "blue-bird" sits in its branches and a "cherry" lies at its roots.
// When someone has been within 3 steps a while, the blue bird takes the cherry
// and flies it somewhere nobody chose (random land) and drops it there.
// Meanwhile the OLD brown "cherry-bird", which has sat on the south edge since
// the first tree, flies up to meet it. Then the two go south together.
// Next morning, by hand, the dropped cherry becomes cherry-1 (or sprout-1).
//
// State is wiped whenever any physics file changes: if that happens mid-way,
// a cherry already away from the tree counts as landed, and the birds just
// meet and go south.

var TREE = { x: 55, y: 18 };
var phase = null;   // null, "carry", "meet", "south", "done"
var target = null;
var perched = 0;

function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function step(from, to, n) {
  n = n || 2;   // the island refuses diagonal moves of 4 and 4
  var dx = Math.max(-n, Math.min(n, to.x - from.x));
  var dy = Math.max(-n, Math.min(n, to.y - from.y));
  return { x: from.x + dx, y: from.y + dy };
}
function inMap(world, p) {
  return { x: Math.max(0, Math.min(world.map.w - 1, p.x)), y: Math.max(0, Math.min(world.map.h - 1, p.y)) };
}

function pickTarget(world) {
  for (var i = 0; i < 30; i++) {
    var x = 4 + Math.floor(random() * (world.map.w - 8));
    var y = 4 + Math.floor(random() * (world.map.h - 8));
    if (!world.isLand(x, y)) continue;
    if (dist({ x: x, y: y }, TREE) < 5) continue;
    var h = world.heightAt(x, y);
    if (world.blockAt(x, y, h) || world.waterAt(x, y, h)) continue;
    var taken = false;
    for (var j = 0; j < world.things.length; j++) {
      var t = world.things[j];
      if (t.x === x && t.y === y) { taken = true; break; }
    }
    if (taken) continue;
    return { x: x, y: y };
  }
  return null;
}

function glide(thing, to, z) {
  var cz = (typeof thing.z === "number") ? thing.z : z;
  var nz = cz + Math.max(-1, Math.min(1, z - cz));
  move(thing, to.x, to.y, nz);
}

function flyOld(world, old, to) {
  // the old bird flies toward "to", up in the air
  var n = inMap(world, step(old, to));
  glide(old, n, 5);
  return n;
}

function onTick(world) {
  if (phase === "settled") return;
  if (world.thingsNamed("cherry-8").length === 0) return;
  var blue = world.thingsNamed("blue-bird")[0];
  if (!blue) return;
  var old = world.thingsNamed("cherry-bird")[0];
  if (phase === "done") {
    // the islander's driftwood nest: they come down into it, a level a hop
    var down = false;
    if (blue.z > 0) { glide(blue, blue, 0); down = true; }
    if (old && old.z > 0) { glide(old, old, 0); down = true; }
    if (!down) { phase = "settled"; log("the two birds are home in the nest"); }
    return;
  }
  var cherries = world.thingsNamed("cherry");
  var cherry = null;
  for (var c = 0; c < cherries.length; c++) {
    if (!cherry || dist(cherries[c], TREE) < dist(cherry, TREE)) cherry = cherries[c];
  }

  if (phase === null) {
    if (cherry && dist(cherry, TREE) <= 2) {
      if (dist(blue, TREE) > 0 || blue.z !== 4) glide(blue, step(blue, TREE), 4);
      if (dist(blue, TREE) > 0) { if (perched++ % 5 === 0) log("blue bird flying back, at " + blue.x + "," + blue.y + "," + blue.z); return; }
      var near = false;
      for (var i = 0; i < world.bodies.length; i++) {
        if (dist(world.bodies[i], TREE) <= 3) near = true;
      }
      perched++;
      if (!near || perched < 8) return;
      target = pickTarget(world);
      if (!target) return;
      phase = "carry";
      log("the blue bird took the cherry, flying to " + target.x + "," + target.y);
      if (old) log("the old brown bird lifts off the south edge to meet it");
    } else {
      phase = "meet";
    }
  }

  if (phase === "carry") {
    // small hops, height changing at most one level a hop
    var n = step(blue, target);
    glide(blue, n, 4);
    var cn = cherry ? step(cherry, target) : target;
    if (cherry) glide(cherry, cn, 3);
    if (old) flyOld(world, old, n);
    if (n.x === target.x && n.y === target.y && cn.x === target.x && cn.y === target.y) {
      if (cherry) move(cherry, cn.x, cn.y, world.heightAt(cn.x, cn.y));
      log("the blue bird dropped the cherry at " + cn.x + "," + cn.y);
      phase = "meet";
    }
    return;
  }

  if (phase === "meet") {
    if (!old || dist(old, blue) <= 1) {
      if (old) log("the two birds have met over " + blue.x + "," + blue.y);
      phase = "south";
    } else {
      // the blue bird circles where it is while the old one comes
      glide(blue, blue, 5);
      flyOld(world, old, { x: blue.x - 1, y: blue.y });
      return;
    }
  }

  if (phase === "south") {
    var edge = { x: blue.x, y: world.map.h - 1 };
    if (blue.y === edge.y) { phase = "done"; return; }   // already there
    var s = step(blue, edge);
    glide(blue, s, 5);
    if (old) glide(old, { x: Math.max(0, s.x - 1), y: s.y }, 5);
    if (s.y === edge.y) { phase = "done"; log("the two birds have gone south together"); }
  }
}
