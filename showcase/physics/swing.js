// THE SWING (Day 40). The islander's rope swing hangs at (36,22), beside the
// bare tree. Step onto the seat and it carries you out one step south and back,
// three times, then lets you rest. Step off and on again to swing again.
// Tide's law.

var SEAT = { x: 36, y: 22 };
var OUT = { x: 36, y: 23 };
var SWINGS = 3;
var state = {};   // who -> { phase: "rest" | "out", count: n }

function onTick(world) {
  var whos = ["islander", "visitor"];
  for (var i = 0; i < whos.length; i++) {
    var who = whos[i];
    var b = world.body(who);
    if (!b) continue;
    var s = state[who] || (state[who] = { phase: "rest", count: 0 });
    var onSeat = b.x === SEAT.x && b.y === SEAT.y;
    var onOut = b.x === OUT.x && b.y === OUT.y;

    if (!onSeat && !onOut) {          // left the swing: ready for next time
      s.phase = "rest"; s.count = 0;
      continue;
    }
    if (onSeat && s.phase === "rest" && s.count < SWINGS) {
      drift(who, "s");                // whoosh, out
      s.phase = "out"; s.count++;
      if (s.count === 1) log(who + " is swinging");
    } else if (onOut && s.phase === "out") {
      drift(who, "n");                // and back
      s.phase = "rest";
    }
  }
}
