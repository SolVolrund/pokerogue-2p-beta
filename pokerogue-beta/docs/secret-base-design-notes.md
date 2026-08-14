# Secret Base Design Notes

Working notes for a future Secret Base feature. This is intentionally rough: it captures the desired gameplay loop and the data shape we may want before committing to runtime implementation.

## High-Level Loop

Add a new title menu option:

- Secret Base

The Secret Base menu would contain:

- Buy Decorations
- Decorate Base

The player can spend a persistent account-level currency to buy base decorations, place them in a limited room, and use the base to specialize future runs.

## Currency

The currency should be file-persistent rather than run-persistent. Achievement points are a candidate, or we can introduce a new Secret Base currency if achievement points are not a good fit.

Important properties:

- Earned outside an individual run.
- Spent in the Secret Base menu.
- Purchases unlock usable decoration inventory.
- The base layout persists between runs.

## Decoration Ownership

Buying a decoration adds it to the player's usable Secret Base inventory.

Each decoration should have a use cap:

- Tents: likely `1/1` each.
- Floor tiles or simple repeatable objects: could be `1/99` or similar.
- Large functional machines: likely `1/1`.
- Small decorative/stat-buffing items: varies by balance.

The use cap should describe how many copies can be placed, not necessarily how many times the player must buy it. For example, buying a floorboard once should unlock many placements so the player does not need to buy the same simple tile 99 times.

## Base Editing

The editor/runtime model should probably separate three concepts:

- Room shape: dug/open tiles and generated walls.
- Owned decorations: what the player has unlocked.
- Placed decorations: which owned items are currently placed in the base.

The current layout lab is useful for proving placement, collision, elevation, and movement rules. Runtime saves should be smaller than the editor data.

Possible runtime layout shape:

```json
{
  "tileset": "tree_bg_tiles",
  "columns": 20,
  "rows": 11,
  "tileSize": 16,
  "dug": [],
  "door": { "x": 10, "y": 10 },
  "playerStart": { "x": 10, "y": 9 },
  "decorations": [
    { "regionKey": "spin_mat", "x": 7, "y": 6 }
  ]
}
```

## Decoration Functions

Decorations can be purely visual, functional, or augment other functional decorations.

### Tents

Tents may attract a salesman to the Secret Base.

Proposed examples:

- Red Tent: TM salesman.
- Blue Tent: X Item salesman.
- Green Tent: Evolution Item salesman.
- Yellow Tent: Held Item salesman.

Salesmen do not need to appear every time. Each tent could provide a chance for its related salesman to visit.

### Decorative Buff Items

Some decorations may modify the quality, pool, or behavior of Secret Base services.

Examples:

- Pokemon dolls could increase the rarity of TMs offered by the TM salesman.
- Type-themed decorations could bias item pools.
- Trophy-style decorations could improve visitor odds or shop quality.

These should occupy real space so players must choose a specialization instead of stacking every bonus for free.

### Healing Machine

A healing machine could provide limited healing during a run or between run segments.

Possible limits:

- Base machine heals only one player by default.
- Cooldown could start at 30 waves.
- Augments can improve player coverage or cooldown.

Possible augment examples:

- Power plant decoration increases machine capacity from 1 player to 2 or 3 players.
- Power plant decoration reduces cooldown from 30 waves to 20 or 10.

## Specialization Pressure

The limited base space is the balancing lever.

Players should be able to build toward different identities:

- TM-focused base.
- Evolution-item base.
- Held-item base.
- Healing/support base.
- Mixed utility base with weaker individual focus.

The goal is to make placement matter. If every useful augment takes space, players have to decide what their base is good at.

## Runtime Implementation Notes

Likely implementation areas:

- Title menu entry for Secret Base.
- Persistent save data for currency, owned decorations, and base layout.
- Decoration data table with costs, use caps, source atlas keys, collision, and functional tags.
- Secret Base scene or event phases for loading, exploring, interacting, decorating, and exiting.
- Runtime wall generation from a dug mask, rather than storing every generated wall tile by hand.

Possible future phases:

- `SecretBaseLoadPhase`
- `SecretBaseExplorePhase`
- `SecretBaseDecoratePhase`
- `SecretBaseInteractPhase`
- `SecretBaseExitPhase`

## Open Questions

- Should the currency be achievement points or a new Secret Base-specific currency?
- Should salesmen appear in the title-menu base only, during runs, or both?
- Should base services be usable once per run, once per cooldown, or only at certain waves?
- Should multiplayer players share one base or each bring their own base bonuses?
- Should decorations be unlocked by achievements, purchased directly, found during runs, or all three?
