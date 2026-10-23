import test from "node:test";
import assert from "node:assert/strict";
import "../tools/yes-move-renderer.js";
import { buildCatalog } from "./yes-move-lab-server.mjs";
const R = globalThis.YesMoveRenderer;
const config = (frames, frameTimedEvents = {}) => ({ frames: Array.from({ length: frames }, () => []), frameTimedEvents });
const anchors = { playerX: 106, playerY: 148, enemyX: 234, enemyY: 84 };

test("duration includes background tails but excludes sound and unreachable events", () => {
  const c = config(10, {
    7: [{ eventType: "AnimTimedUpdateBgEvent", duration: 8 }],
    9: [{ eventType: "AnimTimedSoundEvent", duration: 999 }],
    20: [{ eventType: "AnimTimedAddBgEvent", duration: 999 }],
  });
  assert.equal(R.visualFrames(c), 15);
});
test("enemy single-variant moves reverse anchors and projectiles; explicit variants preserve authored coordinates", () => {
  const frame = { x: 0, y: 0, zoomX: 100, zoomY: 100, focus: 3 };
  const reverse = R.transform(frame, R.layoutFor("enemy", false, anchors));
  assert.deepEqual(reverse, { x: 234, y: 52, sx: -1, sy: 1, angle: -0 });
  const authored = R.transform(frame, R.layoutFor("enemy", true, anchors));
  assert.equal(authored.x, 106); assert.equal(authored.sx, 1);
  const a = config(5), b = config(9);
  assert.equal(R.selectConfig([a, b], "enemy").config, b);
  assert.equal(R.selectConfig(a, "enemy").opposing, false);
});
test("background fades retain the original image and seek deterministically", () => {
  const c = config(20, {
    0: [{ eventType: "AnimTimedAddBgEvent", resourceName: "fire", opacity: 0, bgX: 0, bgY: 0 },
      { eventType: "AnimTimedUpdateBgEvent", resourceName: "", opacity: 255, duration: 4 }],
    8: [{ eventType: "AnimTimedUpdateBgEvent", resourceName: "", opacity: 0, duration: 4 }],
  });
  assert.equal(R.backgroundAt(c, 2).alpha, 0.5);
  assert.equal(R.backgroundAt(c, 10).alpha, 0.5);
  assert.equal(R.backgroundAt(c, 12).alpha, 0);
  assert.equal(R.backgroundAt(c, 2).name, "fire");
  assert.equal(R.backgroundAt(c, 4).alpha, 1);
});
test("finished effects disappear, invisible and Pokémon frames are omitted", () => {
  const drawn = [];
  const ctx = new Proxy({ drawImage: (...args) => drawn.push(args) }, {
    get: (target, key) => key in target ? target[key] : () => {},
  });
  const frame = { target: 2, visible: true, opacity: 255, zoomX: 100, zoomY: 100, focus: 2 };
  const c = { frames: [[frame, { ...frame, target: 0 }, { ...frame, visible: false }]], graphic: "test" };
  const options = { anchors, direction: "player", backgrounds: false };
  R.draw(ctx, c, 0, options, () => ({ naturalWidth: 96, naturalHeight: 96 }));
  assert.equal(drawn.length, 1);
  R.draw(ctx, c, 1, options, () => ({ naturalWidth: 96, naturalHeight: 96 }));
  assert.equal(drawn.length, 1);
});
test("catalogue contains move IDs only, groups directional variants and sorts longest first", async () => {
  const { moves, errors } = await buildCatalog();
  assert.deepEqual(errors, []);
  assert.equal(new Set(moves.map(m => m.key)).size, moves.length);
  assert.ok(moves.every((move, i) => !i || moves[i - 1].durationFrames >= move.durationFrames));
  assert.equal(moves.filter(move => !move.zMove)[0].key, "searing-shot");
  assert.ok(moves.find(move => move.key === "lets-snuggle-forever").zMove);
  assert.equal(moves.find(move => move.key === "spectral-thief").variants, 2);
  assert.ok(!moves.some(move => /^(?:common|encounter)-/.test(move.key)));
  assert.ok(moves.some(move => move.key === "charge-beam"));
});

test("backgrounds-behind mode puts every background before every effect, preserving each group's order", () => {
  const commands = [];
  const ctx = new Proxy({
    createPattern: image => image.name,
    fillRect: () => commands.push(ctx.fillStyle),
    drawImage: image => commands.push(image.name),
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const layers = ["back", "front"].map(name => ({ opacity: 0.5, config: {
    graphic: `${name}-effect`,
    frames: [[{ target: 2, visible: true, opacity: 255, zoomX: 100, zoomY: 100, focus: 2 }]],
    frameTimedEvents: { 0: [{ eventType: "AnimTimedAddBgEvent", resourceName: `${name}-background`, opacity: 255 }] },
  } }));
  const images = name => ({ name, naturalWidth: 96, naturalHeight: 96 });
  const render = options => {
    commands.length = 0;
    for (const _ of R.drawLayers(ctx, layers, 0, { anchors, direction: "player", ...options }, images)) { /* Drain the bake. */ }
    return [...commands];
  };
  assert.deepEqual(render({ backgrounds: true, backgroundsBehind: true }),
    ["back-background", "front-background", "back-effect", "front-effect"]);
  assert.deepEqual(render({ backgrounds: true, backgroundsBehind: false }),
    ["back-background", "back-effect", "front-background", "front-effect"]);
  assert.deepEqual(render({ backgrounds: false, backgroundsBehind: true }), ["back-effect", "front-effect"]);
});
