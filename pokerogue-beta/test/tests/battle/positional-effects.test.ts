import { Battle } from "#app/battle";
import { Phase } from "#app/phase";
import { allMoves } from "#data/data-lists";
import { createHordeBattleState, HORDE_ENEMY_POSITIONS } from "#data/horde-battle";
import { loadPositionalTag, type SerializedPositionalTag } from "#data/positional-tags/load-positional-tag";
import { BattleType } from "#enums/battle-type";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PositionalTagType } from "#enums/positional-tag-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { Pokemon } from "#field/pokemon";
import { WishAttr } from "#moves/move";
import { PokemonHealPhase } from "#phases/pokemon-heal-phase";
import { RepositionPhase } from "#phases/reposition-phase";
import { GameManager } from "#test/framework/game-manager";
import { BooleanHolder, toDmgValue } from "#utils/common";
import { reformHordePlayers } from "#utils/horde-battle";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Delayed effects stay at battlefield positions", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const positions = [FieldPosition.LEFT, FieldPosition.CENTER, FieldPosition.RIGHT];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "updateInfo").mockResolvedValue();
    const setPosition = Pokemon.prototype.setFieldPosition;
    vi.spyOn(Pokemon.prototype, "setFieldPosition").mockImplementation(function (
      this: Pokemon,
      position,
      _duration,
      previousCount,
    ) {
      return setPosition.call(this, position, 0, previousCount);
    });
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function setup(horde = false) {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const battle = new Battle(game.scene.gameMode, {
      waveIndex: 21,
      battleType: BattleType.WILD,
      double: true,
      wildBattlerCount: 3,
      ...(horde ? { horde: createHordeBattleState([0, 1, 2]) } : {}),
    });
    game.scene.currentBattle = battle;
    battle.incrementTurn();
    for (const owner of [0, 1, 2] as const) {
      const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BLISSEY), 50);
      game.scene.getPlayerParty(owner).push(pokemon);
      game.scene.field.add(pokemon);
      pokemon.fieldPosition = positions[owner];
      if (battle.horde) {
        battle.horde.playerPositions[owner] = pokemon.fieldPosition;
      }
      pokemon.hp = 1;
    }
    battle.enemyParty = (horde ? HORDE_ENEMY_POSITIONS : positions).map(position => {
      const pokemon = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 50, TrainerSlot.NONE);
      game.scene.field.add(pokemon);
      pokemon.fieldPosition = position;
      return pokemon;
    });
    return {
      players: game.scene.getPlayerField(),
      enemies: game.scene.getEnemyField(),
      manager: game.scene.arena.positionalTagManager,
    };
  }

  function wish(user: Pokemon) {
    const attr = allMoves[MoveId.WISH].attrs.find(attr => attr instanceof WishAttr)!;
    attr.apply(user, user);
  }

  function attack(user: Pokemon, target: Pokemon, move: MoveId) {
    allMoves[move]
      .getAttrs("DelayedAttackAttr")[0]
      .apply(user, target, allMoves[move], [new BooleanHolder(false), MoveUseMode.NORMAL]);
  }

  async function reposition(pokemon: Pokemon, position: FieldPosition) {
    const phase = new RepositionPhase(pokemon.getBattlerIndex(), position);
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    await vi.waitFor(() => expect(end).toHaveBeenCalled());
  }

  it("heals the new occupant after a P1/P2 swap, using the original Wish user's HP", async () => {
    const { players, manager } = setup();
    const [caster, recipient] = players;
    vi.spyOn(caster, "getMaxHp").mockReturnValue(100);
    wish(caster);
    manager.activateAllTags();
    await reposition(caster, recipient.fieldPosition);
    expect(caster.fieldPosition).toBe(FieldPosition.CENTER);
    expect(recipient.fieldPosition).toBe(FieldPosition.LEFT);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    manager.activateAllTags();
    expect(queue).toHaveBeenCalledWith("PokemonHealPhase", recipient.getBattlerIndex(), 50, expect.anything());
    await new PokemonHealPhase(recipient.getBattlerIndex(), 50, { skipAnim: true }).end();
    expect(recipient.hp).toBe(51);
    expect(caster.hp).toBe(1);
    expect(players[2].hp).toBe(1);
  });

  it.each([
    MoveId.FUTURE_SIGHT,
    MoveId.DOOM_DESIRE,
  ])("hits the new occupant after an E1/E2 swap for move %i", async move => {
    const { players, enemies, manager } = setup();
    attack(players[0], enemies[0], move);
    manager.activateAllTags();
    await reposition(enemies[0], enemies[1].fieldPosition);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    manager.activateAllTags();
    expect(queue).not.toHaveBeenCalledWith(
      "MoveEffectPhase",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    manager.activateAllTags();
    expect(queue).toHaveBeenCalledWith(
      "MoveEffectPhase",
      players[0].id,
      [enemies[1].getBattlerIndex()],
      allMoves[move],
      MoveUseMode.DELAYED_ATTACK,
    );
    expect(manager.tags).toHaveLength(0);
  });

  it("keeps both Wishes in place when two wishing allies trade positions", async () => {
    const { players, manager } = setup();
    vi.spyOn(players[0], "getMaxHp").mockReturnValue(100);
    vi.spyOn(players[1], "getMaxHp").mockReturnValue(200);
    wish(players[0]);
    wish(players[1]);
    await reposition(players[0], players[1].fieldPosition);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    manager.activateAllTags();
    manager.activateAllTags();
    expect(queue).toHaveBeenNthCalledWith(1, "PokemonHealPhase", players[1].getBattlerIndex(), 50, expect.anything());
    expect(queue).toHaveBeenNthCalledWith(2, "PokemonHealPhase", players[0].getBattlerIndex(), 100, expect.anything());
  });

  it("checks duplicate effects against the position, not its original occupant or the other side", async () => {
    const { players, enemies, manager } = setup();
    wish(players[0]);
    attack(players[0], enemies[0], MoveId.FUTURE_SIGHT);
    await reposition(players[0], players[1].fieldPosition);
    await reposition(enemies[0], enemies[1].fieldPosition);
    expect(manager.canAddTag(PositionalTagType.WISH, players[0].getBattlerIndex())).toBe(true);
    expect(manager.canAddTag(PositionalTagType.WISH, players[1].getBattlerIndex())).toBe(false);
    expect(manager.canAddTag(PositionalTagType.WISH, enemies[1].getBattlerIndex())).toBe(true);
    expect(manager.canAddTag(PositionalTagType.DELAYED_ATTACK, enemies[0].getBattlerIndex())).toBe(true);
    expect(manager.canAddTag(PositionalTagType.DELAYED_ATTACK, enemies[1].getBattlerIndex())).toBe(false);
    expect(manager.canAddTag(PositionalTagType.DELAYED_ATTACK, players[1].getBattlerIndex())).toBe(true);
  });

  it("lets a reserve inherit Wish after its slot's occupant has repositioned", async () => {
    const { players, manager } = setup();
    wish(players[0]);
    await reposition(players[0], players[1].fieldPosition);
    const replacement = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.COMFEY), 50);
    const party = game.scene.getPlayerParty(1);
    party.unshift(replacement);
    players[1].setVisible(false);
    game.scene.field.remove(players[1]);
    game.scene.field.add(replacement);
    await replacement.setFieldPosition(FieldPosition.LEFT, 0);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    manager.activateAllTags();
    manager.activateAllTags();
    expect(queue).toHaveBeenCalledWith(
      "PokemonHealPhase",
      replacement.getBattlerIndex(),
      toDmgValue(players[0].getMaxHp() / 2),
      expect.anything(),
    );
  });

  it.each([
    MoveId.WISH,
    MoveId.FUTURE_SIGHT,
    MoveId.DOOM_DESIRE,
  ])("expires move %i at an empty position without jumping sides", async move => {
    const { players, enemies, manager } = setup();
    const side = move === MoveId.WISH ? players : enemies;
    if (move === MoveId.WISH) {
      wish(side[0]);
    } else {
      attack(players[0], side[0], move);
    }
    side[1].hp = 0;
    await reposition(side[0], FieldPosition.CENTER);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    manager.activateAllTags();
    manager.activateAllTags();
    manager.activateAllTags();
    expect(queue).not.toHaveBeenCalled();
    expect(manager.tags).toHaveLength(0);
  });

  it("can hit a later arrival at a temporarily empty position", async () => {
    const { players, enemies, manager } = setup();
    attack(players[0], enemies[0], MoveId.FUTURE_SIGHT);
    enemies[1].hp = 0;
    await reposition(enemies[0], FieldPosition.CENTER);
    manager.activateAllTags();
    await reposition(enemies[2], FieldPosition.LEFT);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    manager.activateAllTags();
    manager.activateAllTags();
    expect(queue).toHaveBeenCalledWith(
      "MoveEffectPhase",
      players[0].id,
      [enemies[2].getBattlerIndex()],
      allMoves[MoveId.FUTURE_SIGHT],
      MoveUseMode.DELAYED_ATTACK,
    );
  });

  it("preserves anchors and timers when saved after a swap and loaded again", async () => {
    const { players, enemies, manager } = setup();
    wish(players[0]);
    attack(players[0], enemies[0], MoveId.DOOM_DESIRE);
    await reposition(players[0], FieldPosition.CENTER);
    await reposition(enemies[0], FieldPosition.CENTER);
    manager.activateAllTags();
    const saved: SerializedPositionalTag[] = JSON.parse(JSON.stringify(manager.tags));
    expect(saved.map(tag => tag.targetPosition)).toEqual([FieldPosition.LEFT, FieldPosition.LEFT]);
    manager.tags = saved.map(tag => loadPositionalTag(tag));
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    manager.activateAllTags();
    expect(queue).toHaveBeenCalledWith(
      "PokemonHealPhase",
      players[1].getBattlerIndex(),
      expect.any(Number),
      expect.anything(),
    );
    manager.activateAllTags();
    expect(queue).toHaveBeenCalledWith(
      "MoveEffectPhase",
      players[0].id,
      [enemies[1].getBattlerIndex()],
      allMoves[MoveId.DOOM_DESIRE],
      MoveUseMode.DELAYED_ATTACK,
    );
  });

  it("anchors a legacy saved effect before the first reposition without resetting its timer", async () => {
    const { players, manager } = setup();
    manager.tags = [
      loadPositionalTag({
        tagType: PositionalTagType.WISH,
        targetIndex: players[0].getBattlerIndex(),
        turnCount: 1,
        healHp: 50,
        pokemonName: "Legacy",
      }),
    ];
    expect(manager.tags[0].targetPosition).toBeUndefined();
    await reposition(players[0], FieldPosition.CENTER);
    expect(manager.tags[0].targetPosition).toBe(FieldPosition.LEFT);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    manager.activateAllTags();
    expect(queue).toHaveBeenCalledWith("PokemonHealPhase", players[1].getBattlerIndex(), 50, expect.anything());
  });

  it.each([FieldPosition.FAR_LEFT, FieldPosition.FAR_RIGHT])("handles the outer horde position %i", async position => {
    const { players, enemies, manager } = setup(true);
    const originalTarget = enemies.find(pokemon => pokemon.fieldPosition === position)!;
    const replacement = enemies.find(pokemon => pokemon.fieldPosition === FieldPosition.CENTER)!;
    attack(players[0], originalTarget, MoveId.DOOM_DESIRE);
    await reposition(originalTarget, FieldPosition.CENTER);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    for (let turn = 0; turn < 3; turn++) {
      manager.activateAllTags();
    }
    expect(queue).toHaveBeenCalledWith(
      "MoveEffectPhase",
      players[0].id,
      [replacement.getBattlerIndex()],
      allMoves[MoveId.DOOM_DESIRE],
      MoveUseMode.DELAYED_ATTACK,
    );
  });

  it("does not carry a Wish away when a horde formation vacates its position", async () => {
    const { players, manager } = setup(true);
    wish(players[1]);
    players[0].hp = 0;
    await reformHordePlayers();
    expect(players[1].fieldPosition).toBe(FieldPosition.LEFT);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    manager.activateAllTags();
    manager.activateAllTags();
    expect(queue).not.toHaveBeenCalled();
  });
});
