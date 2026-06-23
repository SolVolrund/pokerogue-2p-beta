# How To Get Split Players

This is a future-porting note for bringing the PokeVoid multiplayer prototype ideas into a Rogue-style game such as PokeRogue.

PokeRogue should be simpler than PokeVoid in one important way: there is no map-node lock-in and no skill tree path selection. The core job is therefore not "two players pick map nodes," but "two players share one run while keeping their player-owned state separate."

## Target Shape

The game should have one shared run shell and two player states:

```ts
runState: {
  wave,
  biome,
  rngState,
  currentBattle,
  players: [
    player0State,
    player1State,
  ],
}
```

Each player state should own:

- Party, up to 6 Pokemon.
- Money and shop currency.
- Pokeballs and special ball counts.
- Held/passive/run items.
- Starter unlocks, dex data, candies, egg moves, eggs, vouchers, and gacha progress.
- Quest/unlock/stat progression.
- Champion/progression equivalent, if that game has one.
- Current reward/shop choices when the player is in a choice phase.

The shared run should own:

- Wave number.
- Biome/current encounter table.
- Global RNG seed or deterministic per-wave seeds.
- Shared battle state when both players are in the same battle.
- Save slot metadata.

## First Pass: Local Two-Player Mode

Start local before networking.

1. Add a prototype flag such as `?multiplayerPrototype=1`.
2. Add `playerStates[0]` and `playerStates[1]`.
3. Keep one active player context:

```ts
activePlayerIndex: 0 | 1
```

4. Route all player-owned lookups through that context:

```ts
getParty(playerIndex = activePlayerIndex)
getMoney(playerIndex = activePlayerIndex)
getPokeballs(playerIndex = activePlayerIndex)
getModifiers(playerIndex = activePlayerIndex)
```

5. During player setup:
   - P1 selects starters normally.
   - P2 selects starters immediately after P1.
   - Both parties are stored separately before wave 1 starts.

## Battle Model

For the first practical version, every wave can be a shared double battle:

- P1 sends party slot 0 to player field slot 0.
- P2 sends party slot 0 to player field slot 1.
- Enemy side generates enough opponents for a fair double battle.
- Input ownership alternates by battler owner, not by field position alone.

The important rule:

```ts
field slot 0 does not always mean player 0
field slot 1 does not always mean player 1
```

Use explicit ownership data:

```ts
battlePlayerIndexes = [0, 1]
fieldSlotOwner[0] = 0
fieldSlotOwner[1] = 1
```

This avoids the bug where P2 throws a ball or catches a Pokemon but the result goes to P1 because the Pokemon happened to be in field slot 0.

## Rewards And Shops

After each battle, give each player their own reward phase:

1. Generate or snapshot P1 reward options.
2. Set active player to P1.
3. Let P1 pick and apply one reward to P1-owned state.
4. Generate or snapshot P2 reward options.
5. Set active player to P2.
6. Let P2 pick and apply one reward to P2-owned state.
7. Advance to the next wave only after both reward phases finish.

Do not let reward application ask "what is the current global party?" It should ask:

```ts
const party = scene.getParty(rewardOwnerPlayerIndex);
```

The same applies to:

- Pokemon rewards.
- TM rewards.
- Evolution items.
- Money rewards.
- Ball rewards.
- Persistent item rewards.
- Move upgrades.
- Ability/passive items.

## Save/Load

Save both the shared run and the player states.

Minimum save fields:

```ts
{
  wave,
  biome,
  rngState,
  battleState,
  activePlayerIndex,
  battlePlayerIndexes,
  playerStates: [
    {
      party,
      money,
      pokeballs,
      modifiers,
      dex,
      eggs,
      quests,
      stats,
      progression,
    },
    {
      party,
      money,
      pokeballs,
      modifiers,
      dex,
      eggs,
      quests,
      stats,
      progression,
    },
  ],
}
```

On load:

1. Restore both player parties before starting the battle phase.
2. Restore modifiers after parties exist.
3. Restore active player and battle player indexes.
4. Re-apply any derived per-player effects that are not naturally serialized.
5. Resume the correct phase.

Be careful with temporary battle clones. If a battle uses cloned Pokemon, write HP, status, EXP, level, moves, and captures back to the real player party when the battle resolves.

## Networking Later

Once local mode works, add host/client.

Host responsibilities:

- Own the real save and run state.
- Own RNG.
- Validate P2 input.
- Apply rewards, captures, EXP, item usage, and quest progress.
- Broadcast display/video/state updates.

Client responsibilities:

- Send input.
- Show the game view.
- Never independently decide battle results or rewards.

For a first online version, streaming the host render to P2 is easier than building a fully synchronized second game client. Long term, if split simultaneous battles are desired, the host can run two battle scenes and stream/render each player's view separately.

## PokeVoid Lessons To Avoid Repeating

- Do not infer player ownership from field position.
- Do not clone a player's party for a separate view unless the clone writes back to the real party.
- Do not let global `currentBattle`, global party, global money, or global modifiers silently answer player-specific questions.
- Do not let one player's persistent modifier block the other player's modifier just because both Pokemon have the same id/species.
- Do not generate fallback rewards when the real rewards are merely late; wait for the owner's reward data.
- Do not restore a multiplayer save into a single-player battle shape.
- Do not serialize only the combined party. Save explicit per-player parties.
- Do not make UI state the source of truth. UI should display the active player state, not define it.

## Suggested Build Order

1. Split parties.
2. Split reward ownership.
3. Split money and balls.
4. Split persistent/run modifiers.
5. Split starter/dex/egg/gacha/unlock data.
6. Split quests and stats.
7. Make shared double battles use explicit player ownership.
8. Save/load full two-player state.
9. Add local input ownership for P1/P2.
10. Add host/client connection.
11. Stream or sync P2's display.
12. Only then attempt true simultaneous split battles.

## Basic Test Checklist

- P1 and P2 can select different starters.
- P1 reward only changes P1 party/items.
- P2 reward only changes P2 party/items.
- P1 money spending only changes P1 money.
- P2 money spending only changes P2 money.
- P1 ball capture adds to P1 party.
- P2 ball capture adds to P2 party.
- EXP goes to both players' participating Pokemon.
- Fainted Pokemon stay fainted after the battle unless healed by real game logic.
- Save/continue restores both parties and the correct battle shape.
- Starter/dex/egg/candy unlocks gained by one player do not leak to the other.
- Quest/stat unlocks check the correct player.

