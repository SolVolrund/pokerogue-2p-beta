# Two-Player Save and Trainer Setup

This document summarizes the current 2P save-file shape and the trainer pairing system added for local two-player Pokerogue.

## Goals

- Player 1 and Player 2 should each keep their own system/profile progress.
- During a shared run, each player should also keep separate run-owned state: party, money, balls, modifiers, rewards, vouchers, eggs, and captures.
- Standard encounters in 2P should become double battles.
- Player 1 owns the left player field slot. Player 2 owns the right player field slot.
- Enemy trainers should either use their native double setup, or gain a compatible partner trainer so both enemy sides remain populated.

## Save Model

The implementation splits saves into two layers:

- **System/profile save:** long-term progress such as dex unlocks, starter unlocks, vouchers, eggs, achievements, and profile data.
- **Run state:** temporary state for the current run such as party, money, pokeballs, and passive modifiers.

In `src/battle-scene.ts`, the two-player system saves live in:

```ts
systemSaves: [GameData, GameData]
```

Player 1 uses the normal `gameData`/normal save path. Player 2 currently uses a guest profile stored in localStorage under:

```ts
pokerogue_2p_guest_system_save
```

The active system save is selected through:

```ts
getPlayerGameData(playerIndex)
savePlayerSystemSave(playerIndex)
savePlayerSystemSaveLocal(playerIndex)
```

This lets ownership-aware systems save to the correct profile without relying on whichever `globalScene.gameData` reference happens to be active at that moment.

## Run State Model

The original game has many legacy references to:

```ts
party
money
pokeballCounts
modifiers
```

Rather than rewriting everything at once, 2P stores the real per-player run state here:

```ts
players: [PlayerRunState, PlayerRunState]
```

Each `PlayerRunState` contains:

```ts
party: PlayerPokemon[]
money: number
pokeballCounts: PokeballCounts
modifiers: PersistentModifier[]
```

When `activePlayerIndex` changes, `syncLegacyStateForActivePlayer()` repoints the old single-player fields at that active player's run state. This keeps older code working while newer code can explicitly call:

```ts
getPlayerParty(playerIndex)
getPlayerMoney(playerIndex)
getPlayerPokeballCounts(playerIndex)
getPlayerModifiers(playerIndex)
```

## Save Corruption Fix

The main failure mode we hit was that 2P could accidentally serialize the wrong active profile. Because `globalScene.gameData` is switched to match `activePlayerIndex`, saving while Player 2 was active could overwrite Player 1's normal profile or make both players appear to share dex unlocks.

The fix was to stop treating `globalScene.gameData` as "the only profile" in 2P mode:

- `getPlayerGameData(0)` returns Player 1's system save.
- `getPlayerGameData(1)` returns Player 2's guest system save.
- Player 1 saves through the normal `GameData.saveSystem()` / `saveSystemLocal()` path.
- Player 2 saves through the guest localStorage key.
- `saveAll()` writes Player 1's system save as the primary system save, then separately writes Player 2's guest system save locally.

This is why captures now persist correctly: the capture path asks for the capturing player's `GameData`, updates that dex/starter data, then saves that same player's system save.

## Capture Ownership

Normal capture now carries an explicit `playerIndex`.

`AttemptCapturePhase` stores the owner of the thrown ball:

```ts
constructor(targetIndex, pokeballType, playerIndex)
```

On success, it:

- decrements that player's pokeball count
- updates that player's dex IV data
- calls `getPlayerGameData(playerIndex).setPokemonCaught(pokemon)`
- saves via `savePlayerSystemSave(playerIndex)`
- adds the captured Pokemon to that player's party or release prompt
- returns held items/modifiers to that player's modifier list

Mystery/event capture utilities use the same idea: pass a `playerIndex`, update that player's profile, and save that player's system save.

The important rule is: **capture ownership follows the player who threw the ball, not the currently active UI profile and not the field slot being targeted.**

## Egg and Voucher Ownership

Eggs and vouchers were moved toward the same profile-owned model:

- voucher counts are read from `getPlayerGameData(playerIndex)`
- egg purchases store an owning player index
- egg hatching uses the egg owner's `GameData`
- hatching unlocks dex/starter data on that player's system save

This matches the intended later online flow: a guest brings their local profile to the host, earns progress during the shared run, then receives the updated profile back.

## Player Field Ownership

The default 2P player field ownership is:

```ts
fieldSlotOwners = [0, 1]
```

That means:

- player field slot 0 -> Player 1
- player field slot 1 -> Player 2

Helpers:

```ts
getPlayerFieldOwners()
getPlayerIndexForFieldSlot(fieldSlot)
getPlayerIndexForPokemon(pokemon)
setMysteryEncounterBattlePlayerFieldOwners(playerIndexes)
clearMysteryEncounterBattlePlayerFieldOwners()
```

Most normal battles use both players. Some mystery encounters can temporarily set a one-player fight, such as "only Player 2 fights this boss." In that case, `playerFieldOwners` narrows the battle to the participating player and removes the non-participant's Pokemon from the field.

## Trainer Pairing Overview

In full 2P mode, normal trainer battles need enough enemy-side presence to match a forced double battle. The solution has two parts:

1. Native double trainers stay double and can scale their party size.
2. Single trainers can receive a compatible partner trainer from a lookup table.

The partner table source is:

```text
src/data/trainers/two-player-trainer-partners.md
```

The runtime parser is:

```ts
src/data/trainers/two-player-trainer-partners.ts
```

It parses markdown entries into:

```ts
twoPlayerTrainerPartnerPools: Map<TrainerType, TrainerType[]>
```

Then `getRandomTwoPlayerTrainerPartner(trainerType)` returns one compatible partner.

## Trainer Construction

`src/field/trainer.ts` was extended so a `Trainer` can carry:

```ts
partnerTrainerType
partnerVariant
partnerName
partnerConfig
```

When 2P full mode is active and the selected trainer is not already a double-only trainer, the constructor tries the partner lookup table. If a partner exists, the encounter is promoted to `TrainerVariant.DOUBLE`.

This lets encounters render as things like:

```text
Youngster Riley & School Kid Hannah
Rivals Finn & Ivy
```

The same system also supports explicit partner config overrides for mystery encounters and scripted trainer events.

## Trainer Names and Sprites

For paired trainers with different configs:

- the main trainer keeps their own class/name/sprite
- the partner trainer gets their own class/name/sprite
- the display name becomes `Trainer A & Trainer B`
- named rivals use the special `Rivals A & B` format

For same-class gender pairs, the constructor tries to pick the opposite gender variant where possible, so paired generic trainers are less likely to look identical.

## Enemy Party Ownership

Enemy Pokemon now carry a trainer owner through `TrainerSlot`:

```ts
TrainerSlot.TRAINER
TrainerSlot.TRAINER_PARTNER
```

Party generation alternates ownership:

- even indexes usually belong to `TRAINER`
- odd indexes usually belong to `TRAINER_PARTNER`

For named partner trainers, generation uses each trainer's own config and party template. So if a battle pairs Trainer A with Trainer B, Trainer A's slots are generated from Trainer A's rules, and Trainer B's slots are generated from Trainer B's rules.

This also fixed the issue where a fainted side could refill from the wrong trainer's party. Switch/summon logic can now ask for the correct `TrainerSlot`.

## Trainer RNG Separation

Partner trainer generation adds the trainer slot into the seed path.

For generated party members, seed offsets include whether the Pokemon belongs to:

```ts
TrainerSlot.TRAINER
TrainerSlot.TRAINER_PARTNER
```

This prevents mirrored teams like both rivals rolling the exact same starter and bird because their party functions used the same seed context.

## Native Double Trainer Scaling

Native double trainers are not just left as two-Pokemon speed bumps in full 2P mode.

`getTwoPlayerDoubleTrainerPartyTemplate()` repeats the chosen party template by wave difficulty:

- early waves: 1x template
- later waves: 2x template
- later still: 3x template
- late waves: 4x template

Since most native double templates are `TWO_*`, this naturally becomes:

- 2 total Pokemon early
- 4 total Pokemon mid
- 6 total Pokemon later
- 8 total Pokemon late

This keeps native double trainers manageable early and meaningful later.

## Named Partner Trainers

For partner pairs such as rival pairs, champion/elite/gym combinations, evil-team leader/admin/grunt combinations, and generic trainer pairs, the lookup table controls which partners can appear.

The key behavior is:

- choose original trainer normally
- choose a compatible partner from that trainer's lookup pool
- instantiate one double trainer object with both configs
- interleave both trainers' party slots
- render both trainer sprites
- preserve names, titles, dialogue hooks, encounter music, and victory/defeat behavior as much as the base config allows

## Special Tate/Liza Handling

Tate and Liza received dedicated pair logic because their identity depends on paired species. The code defines curated Tate/Liza species pairs, keeps the Lunatone/Solrock opening identity, and scales additional pairs by wave.

This lets Tate/Liza stay recognizable while still becoming a fuller 2P double battle later in the run.

## Half Mode vs Full Mode

The trainer pairing/scaling work is intended for full 2P mode:

```ts
twoPlayerPartySize === 6
```

Half mode keeps both players at 3 Pokemon and can leave trainer generation closer to normal.

## Files Worth Checking

- `src/battle-scene.ts`
  - `systemSaves`
  - `players`
  - `activePlayerIndex`
  - player state/profile accessors
  - field slot ownership helpers
  - forced-double battle check

- `src/system/game-data.ts`
  - system/session save serialization
  - `setPokemonCaught`

- `src/phases/attempt-capture-phase.ts`
  - normal capture ownership

- `src/data/mystery-encounters/utils/encounter-pokemon-utils.ts`
  - event capture/obtain ownership

- `src/field/trainer.ts`
  - partner trainer construction
  - names/sprites
  - party interleaving
  - `TrainerSlot` assignment
  - partner-specific modifiers and AI

- `src/data/trainers/two-player-trainer-partners.md`
  - editable trainer partner lookup table

- `src/data/trainers/two-player-trainer-partners.ts`
  - markdown parser and partner selector

- `src/data/trainers/trainer-party-template.ts`
  - native double trainer scaling

- `src/phases/summon-phase.ts`
  - sends out correct player's Pokemon and correct enemy trainer slot

- `src/phases/switch-summon-phase.ts`
  - keeps enemy replacement Pokemon tied to the correct trainer slot

## Current Mental Model

The stable rule for future changes is:

> Never ask "what is the current save?" when the action belongs to a specific player. Ask "which player owns this action?" and route through that player's state/profile helpers.

For saves:

```ts
getPlayerGameData(playerIndex)
savePlayerSystemSave(playerIndex)
savePlayerSystemSaveLocal(playerIndex)
```

For run state:

```ts
getPlayerState(playerIndex)
getPlayerParty(playerIndex)
getPlayerModifiers(playerIndex)
```

For player field ownership:

```ts
getPlayerIndexForFieldSlot(fieldSlot)
getPlayerIndexForPokemon(pokemon)
```

For enemy trainer ownership:

```ts
TrainerSlot.TRAINER
TrainerSlot.TRAINER_PARTNER
```

This is the main guardrail that prevents cross-player save pollution, wrong-party reward effects, and enemy trainers replacing Pokemon on the wrong side.
