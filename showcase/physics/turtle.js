// THE BIRD'S LAW (Tide, Day 51). This slot used to be only a note: the Sea
// Turtle's script lives in physics/aquarium.js now (at most 8 scripts run).
//
// When the cherry tree is bare (sprout-8 at 35,22), a "cherry" lies at its
// roots and a "cherry-bird" sits in the branches. When someone comes within 3
// steps of the tree, the bird picks up the cherry and flies off with it to a
// place nobody chose: random(), somewhere on land. It drops the cherry there
// and flies on south to the edge of the world. The cherry stays where it fell.
// Next morning, by hand, the cherry becomes sprout-1, and the tree begins again.
//
// State: variables are wiped whenever any physics file changes. If that
// happens mid-flight, a cherry already away from the tree counts as landed
// where it is (still "where the bird dropped it"), and the bird just goes south.

var TREE = { x: 35, y: 22 };
var target = null;   // where the bird will drop the cherry
var phase = null;    // null: not started; "carry"; "south"; "done"
var perched = 0;     // ticks the bird has sat in the bare tree

function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

function step(from, to) {
  // at most 4 steps toward "to"
  var dx = Math.max(-4, Math.min(4, to.x - from.x));
  var dy = Math.max(-4, Math.min(4, to.y - from.y));
  return { x: from.x + dx, y: from.y + dy };
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

function onTick(world) {
  if (phase === "done") return;
  if (world.thingsNamed("sprout-8").length === 0) return;
  // the second tree's birds belong to physics/bird.js now
  if (world.thingsNamed("cherry-8").length > 0) return;
  var bird = world.thingsNamed("cherry-bird")[0];
  var cherry = world.thingsNamed("cherry")[0];
  if (!bird) return;

  if (phase === null) {
    if (cherry && dist(cherry, TREE) <= 2) {
      // waiting in the bare branches until someone comes close
      if (dist(bird, TREE) > 0 || bird.z < 4) move(bird, TREE.x, TREE.y, 4);
      var near = false;
      for (var i = 0; i < world.bodies.length; i++) {
        if (dist(world.bodies[i], TREE) <= 3) near = true;
      }
      perched++;
      if (!near || perched < 8) return;   // let it sit at least ~16 seconds first
      target = pickTarget(world);
      if (!target) return;
      phase = "carry";
      log("the bird took the cherry, flying to " + target.x + "," + target.y);
    } else {
      // restarted mid-flight, or the cherry already fell: just go south
      phase = "south";
    }
  }

  if (phase === "carry") {
    var n = step(bird, target);
    var lift = world.heightAt(n.x, n.y) + 3;
    move(bird, n.x, n.y, lift);
    if (cherry) move(cherry, n.x, n.y, lift - 1);
    if (n.x === target.x && n.y === target.y) {
      if (cherry) move(cherry, n.x, n.y, world.heightAt(n.x, n.y));
      log("the bird dropped the cherry at " + n.x + "," + n.y);
      phase = "south";
    }
    return;
  }

  if (phase === "south") {
    var edge = { x: bird.x, y: world.map.h - 1 };
    var s = step(bird, edge);
    move(bird, s.x, s.y, 5);
    if (s.y === edge.y) { phase = "done"; log("the bird has gone south"); }
  }
}
