import type { PlayerIndex } from "#app/battle-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { modifierTypes } from "#data/data-lists";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { AttemptClonePhase } from "#phases/attempt-clone-phase";
import { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  createCloneBallCopy,
  getCloneBallBattleBlockMessage,
  getCloneBallHeldItems,
  getCloneBallTargets,
  getComputerPartnerCloneReplacement,
  getComputerPartnerCloneTarget,
  keepCloneBallCopy,
} from "#utils/clone-ball";
import {
  createComputerPartnerStarter,
  getComputerPartnerProfile,
  isComputerPartnerStarterAce,
} from "#utils/computer-partner-profile";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("AmberTwo and Clone Balls", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("amber_two");

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3, [1, 2]);
    game.scene.setComputerPartnerKey(1, "amber_two");
    game.scene.setComputerPartnerKey(2, "molly_hale");
    game.scene.newBattle();
    for (const player of [0, 1, 2] as const) {
      const pokemon = addPokemon(player, SpeciesId.BULBASAUR);
      pokemon.computerPartnerAce = player !== 0;
    }
    game.scene.setActivePlayerIndex(0);
  });
  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function addPokemon(player: PlayerIndex, species = SpeciesId.MAGIKARP) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(species), 30, undefined, undefined, undefined, false);
    game.scene.getPlayerParty(player).push(pokemon);
    return pokemon;
  }

  function field(...pokemon: Pokemon[]) {
    pokemon.forEach((p, index) => {
      vi.spyOn(p, "isActive").mockReturnValue(true);
      vi.spyOn(p, "getBattlerIndex").mockReturnValue(index);
    });
    vi.spyOn(game.scene, "getField").mockReturnValue(pokemon);
  }

  it("randomizes the first starter/Ace while respecting the normal ten-point budget", () => {
    const pool = [SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE, SpeciesId.MEWTWO];
    expect(profile.startingStarters?.map(p => p.speciesId)).toEqual(pool);
    const aces = new Set<SpeciesId>();
    let multiple = false;
    for (let seed = 0; seed < 40; seed++) {
      game.scene.executeWithSeedOffset(
        () => {
          const starters = createComputerPartnerStarter(profile, undefined, 6, 1);
          aces.add(starters[0].speciesId);
          multiple ||= starters.length > 1;
          expect(starters.every(p => pool.includes(p.speciesId))).toBe(true);
          expect(starters.map((p, i) => isComputerPartnerStarterAce(profile, p, i))).toEqual(
            starters.map((_, i) => i === 0),
          );
          expect(
            starters.reduce((sum, p) => sum + speciesDataRegistry.getStarterCost(p.speciesId), 0),
          ).toBeLessThanOrEqual(10);
        },
        seed,
        "amber-starters",
      );
    }
    expect(aces).toEqual(new Set(pool));
    expect(multiple).toBe(true);
  });

  it("starts Amber with five Clone Balls and adds one on 11/21 without duplicating grants on reload", async () => {
    expect(game.scene.getPlayerPokeballCounts(0)[PokeballType.POKEBALL]).toBe(5);
    expect(game.scene.getPlayerPokeballCounts(1)[PokeballType.POKEBALL]).toBe(0);
    expect(Object.values(game.scene.getPlayerPokeballCounts(2)).every(count => count === 0)).toBe(true);
    const balls = game.scene.getPlayerPokeballCounts(1);
    expect(balls[PokeballType.CLONE_BALL]).toBe(5);
    for (const wave of [1, 2, 10, 11, 11, 12, 20, 21, 21]) {
      game.scene.currentBattle.waveIndex = wave;
      game.scene.grantComputerPartnerCloneBallAllowance();
    }
    expect(balls[PokeballType.CLONE_BALL]).toBe(7);
    const save = game.scene.gameData.getSessionSaveData();
    expect(save.players?.[1].lastCloneBallAllowanceWave).toBe(21);
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(save));
    game.scene.grantComputerPartnerCloneBallAllowance();
    expect(game.scene.getPlayerPokeballCounts(1)[PokeballType.CLONE_BALL]).toBe(7);
    expect(game.scene.canPlayerReceivePokeballRewards(1)).toBe(false);
    expect(game.scene.canPlayerUsePokeballs(1, PokeballType.MASTER_BALL)).toBe(false);
    expect(game.scene.canPlayerUsePokeballs(1, PokeballType.CLONE_BALL)).toBe(true);
  });

  it("includes active allies and enemies without extending ordinary ball targeting", () => {
    const ally = addPokemon(0, SpeciesId.MEWTWO);
    const enemy = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 30, TrainerSlot.NONE);
    const fainted = addPokemon(2);
    fainted.hp = 0;
    field(ally, game.scene.getPlayerParty(1)[0], enemy, fainted);
    expect(getCloneBallTargets(1)).toEqual([ally, game.scene.getPlayerParty(1)[0], enemy]);
    const phase = new CommandPhase(0);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
    game.scene.getPlayerPokeballCounts(0)[PokeballType.CLONE_BALL] = 1;
    expect(phase["handleBallCommand"](PokeballType.CLONE_BALL)).toBe(true);
    const command = game.scene.currentBattle.turnCommands[game.scene.getPlayerBattlerIndex(0)]!;
    expect(command.targets).toEqual([0, 1, 2]);
    expect(queue).toHaveBeenCalledWith("SelectTargetPhase", 0, [0, 1, 2]);
    vi.spyOn(game.scene, "getEnemyField").mockReturnValue([enemy]);
    expect(phase["handleBallCommand"](PokeballType.POKEBALL)).toBe(true);
    expect(game.scene.currentBattle.turnCommands[game.scene.getPlayerBattlerIndex(0)]!.targets).toEqual([2]);
  });

  it("does not replenish spent starting balls when wave 1 is reloaded", async () => {
    game.scene.getPlayerPokeballCounts(1)[PokeballType.CLONE_BALL] = 3;
    const save = game.scene.gameData.getSessionSaveData();
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(save));
    game.scene.grantComputerPartnerCloneBallAllowance();
    expect(game.scene.getPlayerPokeballCounts(1)[PokeballType.CLONE_BALL]).toBe(3);
  });

  it("retains final-boss and rival restrictions", () => {
    vi.spyOn(game.scene.currentBattle, "isClassicFinalBoss", "get").mockReturnValue(true);
    expect(getCloneBallBattleBlockMessage()).toBe("battle:noCloneBallFinalBoss");
    expect(getCloneBallTargets(1)).toEqual([]);
    vi.spyOn(game.scene.currentBattle, "isClassicFinalBoss", "get").mockReturnValue(false);
    game.scene.currentBattle.trainer = { config: { getDerivedType: () => TrainerType.RIVAL } } as never;
    expect(getCloneBallBattleBlockMessage()).toBe("battle:noCloneBallRival");
  });

  it("gives the copy independent identity, mutable data and held items without copying Ace or recovery claims", async () => {
    const source = addPokemon(0, SpeciesId.MEWTWO);
    source.tryPopulateMoveset([MoveId.PSYCHIC], true);
    source.ace = true;
    source.computerPartnerAce = true;
    source.aceEvs = [252, 0, 0, 252, 0, 4];
    source.gtsMalfunctionOriginalPlayerIndex = 0;
    const item = getModifierType(modifierTypes.LEFTOVERS).newModifier(source) as PokemonHeldItemModifier;
    await game.scene.addModifier(item, true, false, false, true, undefined, 0);
    item.recoverableBattleTransfer = { pokemonId: 123, playerIndex: 0 };
    const copy = createCloneBallCopy(source);
    const copiedItems = getCloneBallHeldItems(source);
    expect(copy.id).not.toBe(source.id);
    expect(copy.ivs).toEqual(source.ivs);
    expect(copy.ivs).not.toBe(source.ivs);
    expect(copy.moveset[0]).not.toBe(source.moveset[0]);
    expect(copy.computerPartnerAce).toBe(false);
    expect(copy.ace).toBe(false);
    expect(copy.aceEvs).toEqual([0, 0, 0, 0, 0, 0]);
    expect(copy.gtsMalfunctionOriginalPlayerIndex).toBeUndefined();
    expect(copiedItems).toHaveLength(1);
    expect(copiedItems[0]).not.toBe(item);
    expect(copiedItems[0].recoverableBattleTransfer).toBeUndefined();
    const caught = vi.spyOn(game.scene.gameData, "setPokemonCaught");
    vi.spyOn(game.scene, "savePlayerSystemSaveLocal").mockImplementation(() => {});
    await keepCloneBallCopy(copy, copiedItems, 1);
    expect(caught).not.toHaveBeenCalled();
    expect(game.scene.getPlayerParty(1)).toContain(copy);
    expect(copiedItems[0].pokemonId).toBe(copy.id);
    expect(item.pokemonId).toBe(source.id);
    expect(game.scene.getPlayerParty(0)).toContain(source);
    expect(game.scene.getPlayerModifiers(0)).toContain(item);
    expect(game.scene.getPlayerModifiers(1)).toContain(copiedItems[0]);
  });

  it("chooses a useful ally over a weak enemy without mutating the donor, party or battle RNG", () => {
    const own = game.scene.getPlayerParty(1)[0];
    const ally = addPokemon(0, SpeciesId.MEWTWO);
    const enemy = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 30, TrainerSlot.NONE);
    field(ally, own, enemy);
    const party = game.scene.getPlayerParty(1).slice();
    const rng = Phaser.Math.RND.state();
    expect(getComputerPartnerCloneTarget(1)).toBe(ally);
    expect(getComputerPartnerCloneTarget(1)).toBe(ally);
    expect(Phaser.Math.RND.state()).toBe(rng);
    expect(game.scene.activePlayerIndex).toBe(0);
    expect(game.scene.getPlayerParty(1)).toEqual(party);
    expect(game.scene.currentBattle.capturedBattlerIndexesThisTurn.size).toBe(0);
    const command = new CommandPhase(1);
    vi.spyOn(command, "end").mockImplementation(() => {});
    command["handleComputerPartnerCaptureCommand"](own);
    expect(game.scene.currentBattle.turnCommands[game.scene.getPlayerBattlerIndex(1)]).toMatchObject({
      command: Command.BALL,
      cursor: PokeballType.CLONE_BALL,
      cloneTargetId: ally.id,
    });
  });

  it("protects the Ace and active allies when choosing a full-party replacement", () => {
    const ace = game.scene.getPlayerParty(1)[0];
    const active = addPokemon(1);
    vi.spyOn(active, "isOnField").mockReturnValue(true);
    vi.spyOn(game.scene, "getPlayerPartyLimit").mockReturnValue(2);
    const candidate = createCloneBallCopy(addPokemon(0, SpeciesId.MEWTWO));
    expect(getComputerPartnerCloneReplacement(1, candidate)).toBeUndefined();
    vi.spyOn(active, "isOnField").mockReturnValue(false);
    expect(getComputerPartnerCloneReplacement(1, candidate)?.replacedPokemon).toBe(active);
    expect(ace.computerPartnerAce).toBe(true);
    candidate.destroy();
  });

  it.each([0, 1, 2] as const)("rejects species already on AmberTwo's team in CPU slot %s", owner => {
    game.scene.configureTwoPlayerMode(true, 6, true, 3, [0, 1, 2], false, true);
    game.scene.setComputerPartnerKey(owner, "amber_two");
    const alreadyOwned = addPokemon(owner, SpeciesId.MEWTWO);
    alreadyOwned.hp = 0;
    const donor = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MEWTWO), 30, TrainerSlot.NONE);
    const candidate = createCloneBallCopy(donor);
    expect(candidate.id).not.toBe(alreadyOwned.id);
    expect(getComputerPartnerCloneReplacement(owner, candidate)).toBeUndefined();
    candidate.destroy();
  });

  it("chooses a different species instead of copying an owned Mewtwo again", () => {
    const duplicate = addPokemon(0, SpeciesId.MEWTWO);
    addPokemon(1, SpeciesId.MEWTWO);
    const alternative = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.ALAKAZAM), 30, TrainerSlot.NONE);
    field(duplicate, game.scene.getPlayerParty(1)[0], alternative);
    expect(getComputerPartnerCloneTarget(1)).toBe(alternative);
    // Human targeting remains unrestricted, even when that human already has the species.
    expect(getCloneBallTargets(0)).toContain(duplicate);
  });

  it("declines a repeat donor and rechecks queued throws before spending another ball", async () => {
    const donor = addPokemon(0, SpeciesId.MEWTWO);
    field(donor, game.scene.getPlayerParty(1)[0]);
    expect(getComputerPartnerCloneTarget(1)).toBe(donor);
    const phase = new AttemptClonePhase(donor.id, 1);
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});
    const animate = vi.spyOn(phase as any, "animateClone");
    vi.spyOn(game.scene, "savePlayerSystemSaveLocal").mockImplementation(() => {});
    await keepCloneBallCopy(createCloneBallCopy(donor), [], 1);
    expect(getComputerPartnerCloneTarget(1)).toBeUndefined();
    phase.start();
    expect(end).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
    expect(game.scene.getPlayerParty(1)).toHaveLength(2);
    expect(game.scene.getPlayerPokeballCounts(1)[PokeballType.CLONE_BALL]).toBe(5);
  });

  it("finishes a CPU clone and replaces a bench member without prompting a human or removing the donor", async () => {
    const donor = addPokemon(0, SpeciesId.MEWTWO);
    const old = addPokemon(1);
    vi.spyOn(game.scene, "getPlayerPartyLimit").mockReturnValue(2);
    field(donor, game.scene.getPlayerParty(1)[0]);
    const phase = new AttemptClonePhase(donor.id, 1);
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});
    vi.spyOn(phase as any, "animateClone").mockResolvedValue();
    vi.spyOn(game.scene, "savePlayerSystemSaveLocal").mockImplementation(() => {});
    const modes = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    vi.spyOn(game.scene.ui, "showText").mockImplementation((_text, _delay, callback) => {
      callback?.();
    });
    phase.start();
    await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());
    expect(game.scene.getPlayerParty(1)).toHaveLength(2);
    expect(game.scene.getPlayerParty(1)).not.toContain(old);
    expect(game.scene.getPlayerParty(1)[0].computerPartnerAce).toBe(true);
    expect(game.scene.getPlayerParty(1)[1].species.speciesId).toBe(SpeciesId.MEWTWO);
    expect(game.scene.getPlayerParty(0)).toContain(donor);
    expect(game.scene.currentBattle.capturedBattlerIndexesThisTurn.size).toBe(0);
    expect(game.scene.getPlayerPokeballCounts(1)[PokeballType.CLONE_BALL]).toBe(4);
    expect(modes.mock.calls.every(([mode]) => mode !== UiMode.PARTY)).toBe(true);
  });

  it("inserts a human's copy into the released slot before finishing", async () => {
    const donor = addPokemon(2, SpeciesId.MEWTWO);
    addPokemon(0, SpeciesId.MAGIKARP);
    vi.spyOn(game.scene, "getPlayerPartyLimit").mockReturnValue(2);
    game.scene.getPlayerPokeballCounts(0)[PokeballType.CLONE_BALL] = 1;
    field(game.scene.getPlayerParty(0)[0], donor);
    const phase = new AttemptClonePhase(donor.id, 0);
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});
    vi.spyOn(phase as any, "animateClone").mockResolvedValue();
    const caught = vi.spyOn(game.scene.getPlayerGameData(0), "setPokemonCaught").mockResolvedValue(true);
    vi.spyOn(game.scene, "savePlayerSystemSave").mockResolvedValue(true);
    vi.spyOn(game.scene.ui, "setMode").mockImplementation(async (mode, ...args) => {
      if (mode === UiMode.PARTY) {
        game.scene.getPlayerParty(0).splice(1, 1)[0].destroy();
        args[2](1);
      }
    });
    vi.spyOn(game.scene.ui, "showText").mockImplementation((_text, _delay, callback) => {
      callback?.();
    });
    phase.start();
    await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());
    expect(game.scene.getPlayerParty(0)).toHaveLength(2);
    expect(game.scene.getPlayerParty(0)[1].species.speciesId).toBe(SpeciesId.MEWTWO);
    expect(caught).toHaveBeenCalledOnce();
  });

  it("does not consume a ball or retarget after the selected donor leaves the field", () => {
    const donor = addPokemon(0, SpeciesId.MEWTWO);
    field(game.scene.getPlayerParty(1)[0]);
    const phase = new AttemptClonePhase(donor.id, 1);
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});
    const animate = vi.spyOn(phase as any, "animateClone");
    phase.start();
    expect(end).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
    expect(game.scene.getPlayerPokeballCounts(1)[PokeballType.CLONE_BALL]).toBe(5);
  });

  it.each([
    0, 1, 2,
  ] as const)("supports Clone Ball grants and CPU progress without human dex writes in slot %s", async owner => {
    game.scene.configureTwoPlayerMode(true, 6, true, 3, [0, 1, 2], false, true);
    game.scene.setComputerPartnerKey(owner, "amber_two");
    game.scene.getPlayerState(owner).lastCloneBallAllowanceWave = 0;
    game.scene.getPlayerPokeballCounts(owner)[PokeballType.CLONE_BALL] = 0;
    game.scene.grantComputerPartnerCloneBallAllowance();
    expect(game.scene.getPlayerPokeballCounts(owner)[PokeballType.CLONE_BALL]).toBe(5);
    const source = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MEWTWO), 30, TrainerSlot.NONE);
    const copy = createCloneBallCopy(source);
    const caught = vi.spyOn(game.scene.gameData, "setPokemonCaught");
    const save = vi.spyOn(game.scene, "savePlayerSystemSaveLocal");
    await keepCloneBallCopy(copy, [], owner);
    expect(caught).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
