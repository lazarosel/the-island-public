// THE FERRY (islander, Day 39)
// A 2x2 wooden raft at level 1 (the pier's height). It sails from the south
// side of Sunset Pier, down the west sea, along the south sea to South Beach,
// waits, and comes back. Whoever stands on it is carried along.

// level 0 = the sea's own surface, so you can climb on from the water too
var LEVEL = 0;
var OLD_LEVEL = 1; // where the first raft sailed; moved down on Day 39
var WOOD = ["#8a5a2b", "#a26c36"];   // outward planks
var HOME = ["#8a5a2c", "#a26c37"];   // homeward planks (look the same; the script can tell)
function woodFor(x, y) { return (dir < 0 ? HOME : WOOD)[(x + y) % 2]; }
// recolour the raft for the way it's going now
function paint() { var c = cells(rx, ry); for (var i = 0; i < c.length; i++) setBlock(c[i][0], c[i][1], LEVEL, woodFor(c[i][0], c[i][1])); }
// waypoints for the raft's north-west corner
var PATH = [[1, 25], [1, 39], [31, 39], [31, 36]];
var WAIT = 20; // ticks (2 s each) at each end

var started = false;
var rx = PATH[0][0], ry = PATH[0][1];
var idx = 0;        // index of the waypoint we're at / heading from
var dir = 1;        // +1 outward, -1 home
var wait = WAIT;
var departed = false;

function cells(x, y) { return [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]; }
function has(list, x, y) { for (var i = 0; i < list.length; i++) if (list[i][0] === x && list[i][1] === y) return true; return false; }

function place(x, y) {
  var c = cells(x, y);
  for (var i = 0; i < c.length; i++) setBlock(c[i][0], c[i][1], LEVEL, woodFor(c[i][0], c[i][1]));
}

function riders(world) {
  var out = [];
  var c = cells(rx, ry);
  for (var i = 0; i < world.bodies.length; i++) {
    var b = world.bodies[i];
    if (has(c, b.x, b.y) && b.z === LEVEL + 1) out.push(b.who);
  }
  return out;
}

function isRaft(world, x, y) {
  return world.blockAt(x, y, LEVEL) && world.blockAt(x + 1, y, LEVEL) &&
         world.blockAt(x, y + 1, LEVEL) && world.blockAt(x + 1, y + 1, LEVEL);
}

// after the file changes, find where the raft already is along its route
// If there are several, keep the one nearest the sail and clear the others.
function findRaft(world) {
  var found = [];
  for (var s = 0; s < PATH.length - 1; s++) {
    var x = PATH[s][0], y = PATH[s][1], tx = PATH[s + 1][0], ty = PATH[s + 1][1];
    while (true) {
      if (isRaft(world, x, y)) found.push([x, y, s]);
      if (x === tx && y === ty) break;
      if (x !== tx) x += tx > x ? 1 : -1; else y += ty > y ? 1 : -1;
    }
  }
  if (!found.length) return false;
  var sail = world.thingsNamed("ferry-sail")[0];
  var best = 0;
  if (sail) {
    var bd = 1e9;
    for (var i = 0; i < found.length; i++) {
      var d = Math.abs(found[i][0] - sail.x) + Math.abs(found[i][1] - sail.y);
      if (d < bd) { bd = d; best = i; }
    }
  }
  var keep = found[best];
  // the raft's own colour remembers which way it was sailing (HOME = homeward)
  var col = String(world.blockAt(keep[0], keep[1], LEVEL)).toLowerCase();
  var homeward = HOME.indexOf(col) >= 0;
  var seg = keep[2];
  var atEnd = -1;
  if (keep[0] === PATH[0][0] && keep[1] === PATH[0][1]) atEnd = 0;
  var L = PATH.length - 1;
  if (keep[0] === PATH[L][0] && keep[1] === PATH[L][1]) atEnd = L;
  if (atEnd === 0) { idx = 0; dir = 1; wait = WAIT; }
  else if (atEnd === L) { idx = L; dir = -1; wait = WAIT; }
  else if (homeward) { idx = seg + 1; dir = -1; wait = 0; }
  else { idx = seg; dir = 1; wait = 0; }
  // a waypoint in the middle shows up on two segments; pick the right one
  if (atEnd < 0) for (var i = 0; i < PATH.length; i++)
    if (PATH[i][0] === keep[0] && PATH[i][1] === keep[1]) idx = i;
  rx = keep[0]; ry = keep[1];
  log("ferry found at " + rx + "," + ry + (homeward ? ", homeward" : ", outward") + ", idx " + idx + ", wait " + wait);
  paint();
  var keepAll = [];
  for (var i = 0; i < found.length; i++) if (found[i][0] === keep[0] && found[i][1] === keep[1]) keepAll.push(i);
  var keepC = cells(keep[0], keep[1]);
  for (var i = 0; i < found.length; i++) {
    if (keepAll.indexOf(i) >= 0) continue;
    var c = cells(found[i][0], found[i][1]);
    for (var k = 0; k < c.length; k++)
      if (!has(keepC, c[k][0], c[k][1])) clearBlock(c[k][0], c[k][1], LEVEL);
    log("ferry: cleared a stray raft at " + found[i][0] + "," + found[i][1]);
  }
  return true;
}

function moveSail(world) {
  var s = world.thingsNamed("ferry-sail");
  for (var i = 0; i < s.length; i++) move(s[i], rx, ry, LEVEL + 1);
}

// say "hold the ferry" while it's docked and it waits a minute more;
// say "cast off" and it leaves now.
function onSay(world, who, text) {
  var t = String(text).toLowerCase();
  if (t.indexOf("hold the ferry") >= 0 && wait > 0) { wait = 30; log("ferry held by " + who); }
  if (t.indexOf("cast off") >= 0 && wait > 0) { wait = 0; log("ferry cast off by " + who); }
}

function onTick(world) {
  if (!started) {
    started = true;
    if (!findRaft(world)) { place(rx, ry); log("ferry ready at " + rx + "," + ry); }
    moveSail(world);
    return;
  }
  if (wait > 0) moveSail(world);
  if (wait > 0) { wait--; return; }

  var next = idx + dir;
  if (next < 0 || next >= PATH.length) { dir = -dir; wait = WAIT; paint(); return; }
  var tx = PATH[next][0], ty = PATH[next][1];
  if (rx === tx && ry === ty) { idx = next; if (idx === 0 || idx === PATH.length - 1) { dir = -dir; wait = WAIT; paint(); } return; }
  if (idx === 0 || idx === PATH.length - 1) {
    if (!departed) { departed = true; log("ferry leaving waypoint " + idx + " at " + Math.round(world.time / 1000) + "s"); }
  } else departed = false;

  var dx = tx > rx ? 1 : tx < rx ? -1 : 0;
  var dy = dx !== 0 ? 0 : (ty > ry ? 1 : -1);
  var nx = rx + dx, ny = ry + dy;
  var oldC = cells(rx, ry), newC = cells(nx, ny);

  // don't sail onto land: treat it as having arrived
  for (var i = 0; i < newC.length; i++) {
    if (!has(oldC, newC[i][0], newC[i][1]) && world.isLand(newC[i][0], newC[i][1])) {
      log("ferry: land ahead at " + newC[i][0] + "," + newC[i][1] + ", turning");
      idx = next; dir = -dir; wait = WAIT; return;
    }
  }

  // someone swimming where the raft is going: wait for them (they can climb on)
  for (var i = 0; i < world.bodies.length; i++) {
    var b = world.bodies[i];
    if (has(newC, b.x, b.y) && !has(oldC, b.x, b.y)) return;
  }

  var who = riders(world);
  for (var i = 0; i < newC.length; i++)
    if (!has(oldC, newC[i][0], newC[i][1])) setBlock(newC[i][0], newC[i][1], LEVEL, woodFor(newC[i][0], newC[i][1]));
  var d = dx === 1 ? "e" : dx === -1 ? "w" : dy === 1 ? "s" : "n";
  for (var j = 0; j < who.length; j++) drift(who[j], d);
  for (var i = 0; i < oldC.length; i++)
    if (!has(newC, oldC[i][0], oldC[i][1])) clearBlock(oldC[i][0], oldC[i][1], LEVEL);
  rx = nx; ry = ny;
  moveSail(world);
  if (rx === tx && ry === ty) {
    idx = next;
    log("ferry reached waypoint " + idx + " (" + rx + "," + ry + ") at " + Math.round(world.time / 1000) + "s");
    if (idx === 0 || idx === PATH.length - 1) { dir = -dir; wait = WAIT; }
  }
}
