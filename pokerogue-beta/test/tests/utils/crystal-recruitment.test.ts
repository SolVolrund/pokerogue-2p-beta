import type { PlayerIndex } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import * as ModifierTypes from "#modifiers/modifier-type";
import {
  AddPokeballModifierType,
  getPlayerModifierTypeOptions,
  ModifierTypeOption,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import { NewBattlePhase } from "#phases/new-battle-phase";
import { GameManager } from "#test/framework/game-manager";
import * as Common from "#utils/common";
import { getComputerPartnerCaptureInterests } from "#utils/computer-partner-capture-ai";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { chooseComputerPartnerRewardOption } from "#utils/computer-partner-reward-ai";
import {
  type CrystalRecruitmentCandidate,
  chooseCrystalRecruit,
  generateCrystalRecruitmentCandidates,
  isCrystalRecruitmentDue,
  recruitCrystalPokemon,
} from "#utils/crystal-recruitment";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import * as RewardPokemon from "#utils/reward-pokemon";
import * as RewardTier from "#utils/reward-tier";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Molly crystal recruitment", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3, [0, 1, 2], false, true);
    game.scene.newBattle();
    game.scene.currentBattle.waveIndex = 4;
    for (const player of [0, 1, 2] as const) {
      game.scene.setComputerPartnerKey(player, "molly_hale");
      const ace = addPokemon(player, SpeciesId.ENTEI);
      ace.computerPartnerAce = true;
      ace.setCrystalized(true);
    }
    game.scene.setActivePlayerIndex(0);
  });

  function addPokemon(player: PlayerIndex, species = SpeciesId.MAGIKARP) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(species), 30, undefined, undefined, undefined, false);
    game.scene.getPlayerParty(player).push(pokemon);
    return pokemon;
  }

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function snapshot(candidates: CrystalRecruitmentCandidate[]) {
    return candidates.map(({ pokemon: p, tier, starterSpeciesId }) => ({
      tier,
      starterSpeciesId,
      id: p.id,
      species: p.species.speciesId,
      form: p.formIndex,
      level: p.level,
      shiny: p.shiny,
      variant: p.variant,
      ivs: p.ivs,
      nature: p.nature,
      moves: p.moveset.map(move => move.moveId),
    }));
  }

  it.each([0, 1, 2] as const)("schedules only floors ending in 4/7 for CPU slot %s", player => {
    for (const wave of [1, 3, 5, 10, 20]) {
      game.scene.currentBattle.waveIndex = wave;
      expect(isCrystalRecruitmentDue(player)).toBe(false);
    }
    for (const wave of [4, 7, 14, 17, 104, 197]) {
      game.scene.currentBattle.waveIndex = wave;
      expect(isCrystalRecruitmentDue(player)).toBe(true);
      game.scene.getPlayerState(player).lastCrystalRecruitmentWave = wave;
      expect(isCrystalRecruitmentDue(player)).toBe(false);
    }
  });

  it("does not recruit for humans, other CPUs, or a knocked-out Molly", () => {
    game.scene.setComputerPartnerKey(1, "cheryl");
    expect(isCrystalRecruitmentDue(1)).toBe(false);
    game.scene.getPlayerParty(2)[0].hp = 0;
    expect(isCrystalRecruitmentDue(2)).toBe(false);
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockReturnValue(false);
    expect(isCrystalRecruitmentDue(0)).toBe(false);
  });

  it("generates three deterministic crystal candidates without changing party, owner, or RNG", () => {
    const party = game.scene.getPlayerParty(1).slice();
    const rng = Phaser.Math.RND.state();
    const first = generateCrystalRecruitmentCandidates(1);
    expect(first).toHaveLength(3);
    expect(game.scene.getPlayerParty(1)).toEqual(party);
    expect(game.scene.activePlayerIndex).toBe(0);
    expect(Phaser.Math.RND.state()).toBe(rng);
    game.scene.gameData.trainerId ^= 123;
    game.scene.gameData.secretId ^= 321;
    Common.randSeedInt(100);
    const second = generateCrystalRecruitmentCandidates(1);
    expect(snapshot(second)).toEqual(snapshot(first));
    for (const { pokemon } of first) {
      expect(pokemon.crystalized).toBe(true);
      expect(pokemon.shadowPokemon).toBe(false);
      expect(pokemon.purifiedPokemon).toBe(false);
      expect(pokemon.computerPartnerAce).toBeFalsy();
      expect(pokemon.friendship).toBe(pokemon.species.baseFriendship);
      expect(pokemon.moveset.length).toBeGreaterThan(0);
    }
    [...first, ...second].forEach(candidate => candidate.pokemon.destroy());
  });

  it("uses Molly's own party luck for every candidate", () => {
    const luck = vi.spyOn(ModifierTypes, "getPartyLuckValue").mockReturnValue(9);
    const roll = vi.spyOn(RewardTier, "rollRewardTier").mockReturnValue({ tier: ModifierTier.MASTER, upgradeCount: 0 });
    const candidates = generateCrystalRecruitmentCandidates(2);
    expect(luck).toHaveBeenCalledWith(game.scene.getPlayerParty(2));
    expect(roll).toHaveBeenCalledTimes(3);
    expect(roll.mock.calls.every(call => call[0] === 9)).toBe(true);
    candidates.forEach(candidate => candidate.pokemon.destroy());
  });

  it("can roll shiny crystal recruits and evolves their species for the reward level", () => {
    vi.spyOn(RewardPokemon, "getRewardPokemonSpeciesPool").mockReturnValue([SpeciesId.CATERPIE]);
    // Trainer evolution can be delayed near the level requirement; at 30 both stages are guaranteed.
    vi.spyOn(game.scene, "getMaxExpLevel").mockReturnValue(30);
    const draw = Common.randSeedInt;
    vi.spyOn(Common, "randSeedInt").mockImplementation((range, min = 0) => (range === 65536 ? 0 : draw(range, min)));
    const candidates = generateCrystalRecruitmentCandidates(1);
    expect(candidates).toHaveLength(3);
    for (const { pokemon } of candidates) {
      expect(pokemon.species.speciesId).toBe(SpeciesId.BUTTERFREE);
      expect(pokemon.level).toBe(30);
      expect(pokemon.shiny).toBe(true);
      expect(pokemon.getLuck()).toBeGreaterThan(0);
      pokemon.destroy();
    }
  });

  it("protects Entei and passes when every slot is protected", () => {
    vi.spyOn(game.scene, "getPlayerPartyLimit").mockReturnValue(1);
    const candidates = generateCrystalRecruitmentCandidates(1);
    expect(chooseCrystalRecruit(1, candidates)).toBeUndefined();
    candidates.forEach(candidate => candidate.pokemon.destroy());
  });

  it("recruits at most one, keeps the Ace, and never writes human collection data", async () => {
    const ace = game.scene.getPlayerParty(1)[0];
    const caught = vi.spyOn(game.scene.gameData, "setPokemonCaught");
    const save = vi.spyOn(game.scene.gameData, "saveSystemLocal");
    await recruitCrystalPokemon(1);
    const party = game.scene.getPlayerParty(1);
    expect(party.length).toBeLessThanOrEqual(2);
    expect(party[0]).toBe(ace);
    expect(game.scene.getPlayerState(1).lastCrystalRecruitmentWave).toBe(4);
    expect(await recruitCrystalPokemon(1)).toEqual([]);
    expect(caught).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("persists a declined recruitment across a real session round trip", async () => {
    vi.spyOn(game.scene, "getPlayerPartyLimit").mockReturnValue(1);
    await recruitCrystalPokemon(1);
    const save = game.scene.gameData.getSessionSaveData();
    expect(save.players?.[1].lastCrystalRecruitmentWave).toBe(4);
    game.scene.getPlayerState(1).lastCrystalRecruitmentWave = 0;
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(save));
    expect(isCrystalRecruitmentDue(1)).toBe(false);
    expect(await recruitCrystalPokemon(1)).toEqual([]);
    expect(game.scene.getPlayerState(1).lastCrystalRecruitmentWave).toBe(4);
  });

  it("replaces one non-Ace in a full team, and retains the result after loading", async () => {
    for (let i = 0; i < 5; i++) {
      addPokemon(1);
    }
    const before = game.scene.getPlayerParty(1).map(pokemon => pokemon.id);
    const otherParty = game.scene.getPlayerParty(2).slice();
    vi.spyOn(RewardPokemon, "getRewardPokemonSpeciesPool").mockImplementation(() => [SpeciesId.MEWTWO]);
    const messages = await recruitCrystalPokemon(1);
    const party = game.scene.getPlayerParty(1);
    expect(party).toHaveLength(6);
    expect(party[0].id).toBe(before[0]);
    const newcomers = party.filter(pokemon => !before.includes(pokemon.id));
    expect(newcomers).toHaveLength(1);
    expect(newcomers[0].crystalized).toBe(true);
    expect(messages[1]).toContain("replacing");
    expect(game.scene.getPlayerParty(2)).toEqual(otherParty);
    const ids = party.map(pokemon => pokemon.id);
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(game.scene.gameData.getSessionSaveData()));
    expect(await recruitCrystalPokemon(1)).toEqual([]);
    expect(game.scene.getPlayerParty(1).map(pokemon => pokemon.id)).toEqual(ids);
    expect(game.scene.getPlayerParty(1).find(pokemon => pokemon.id === newcomers[0].id)?.crystalized).toBe(true);
  });

  it("clears initial balls again when restarting a run with Molly selected", () => {
    game.scene["resetPlayerRunStates"]();
    for (const player of [0, 1, 2] as const) {
      expect(Object.values(game.scene.getPlayerPokeballCounts(player)).every(count => count === 0)).toBe(true);
      expect(game.scene.getPlayerState(player).lastCrystalRecruitmentWave).toBeUndefined();
    }
  });

  it.each([
    1, 2,
  ] as const)("preserves human starting balls when selecting Molly for seat %s before enabling multiplayer", player => {
    game.scene.configureTwoPlayerMode(false);
    game.scene.pokeballCounts[PokeballType.POKEBALL] = 5;
    game.scene["resetPlayerRunStates"]();

    game.scene.setComputerPartnerKey(player, "molly_hale");
    expect(game.scene.getPlayerPokeballCounts(0)[PokeballType.POKEBALL]).toBe(5);
    expect(game.scene.players[player].pokeballCounts[PokeballType.POKEBALL]).toBe(5);

    game.scene.configureTwoPlayerMode(true, 6, true, 3, [player]);
    for (const index of [0, 1, 2] as const) {
      expect(game.scene.getPlayerPokeballCounts(index)[PokeballType.POKEBALL]).toBe(index === player ? 0 : 5);
    }
    expect(game.scene.pokeballCounts).toBe(game.scene.getPlayerPokeballCounts(0));
  });

  it.each([0, 1, 2] as const)("clears only Molly's balls in active CPU seat %s, including after a restart", player => {
    game.scene.configureTwoPlayerMode(false);
    game.scene.pokeballCounts[PokeballType.POKEBALL] = 5;
    game.scene["resetPlayerRunStates"]();
    game.scene.configureTwoPlayerMode(true, 6, true, 3, [0, 1, 2], false, true);
    game.scene.setComputerPartnerKey(player, "molly_hale");

    for (const index of [0, 1, 2] as const) {
      expect(game.scene.getPlayerPokeballCounts(index)[PokeballType.POKEBALL]).toBe(index === player ? 0 : 5);
    }
    game.scene["resetPlayerRunStates"]();
    for (const index of [0, 1, 2] as const) {
      expect(game.scene.getPlayerPokeballCounts(index)[PokeballType.POKEBALL]).toBe(index === player ? 0 : 5);
    }
  });

  it("queues recruitment before advancing, then advances once recruitment is complete", () => {
    const phase = new NewBattlePhase();
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    const advance = vi.spyOn(game.scene, "newBattle");
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    expect(queue.mock.calls.map(call => call[0])).toEqual([
      "CrystalRecruitmentPhase",
      "CrystalRecruitmentPhase",
      "CrystalRecruitmentPhase",
      "NewBattlePhase",
    ]);
    expect(advance).not.toHaveBeenCalled();
    for (const player of [0, 1, 2] as const) {
      game.scene.getPlayerState(player).lastCrystalRecruitmentWave = 4;
    }
    phase.start();
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("removes balls from rewards and blocks both receiving balls and capture claims", () => {
    const party = game.scene.getPlayerParty(1);
    expect(Object.values(game.scene.getPlayerPokeballCounts(1)).every(count => count === 0)).toBe(true);
    const ball = getModifierType(modifierTypes.MASTER_BALL);
    expect(ball.newModifier()!.apply(game.scene, 1)).toBe(false);
    expect(game.scene.getPlayerPokeballCounts(1)[PokeballType.MASTER_BALL]).toBe(0);
    expect(
      chooseComputerPartnerRewardOption([new ModifierTypeOption(ball, 0)], party, {
        computerPartnerProfile: getComputerPartnerProfile("molly_hale"),
      }),
    ).toBeUndefined();
    expect(getComputerPartnerCaptureInterests("molly_hale", party, game.scene.getEnemyField())).toEqual([]);
    game.scene.setActivePlayerIndex(1);
    regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0, 1);
    for (let i = 0; i < 10; i++) {
      const rewards = getPlayerModifierTypeOptions(3, party);
      expect(rewards.every(option => !(option.type instanceof AddPokeballModifierType))).toBe(true);
    }
    game.scene.setComputerPartnerKey(2, "cheryl");
    expect(ball.newModifier()!.apply(game.scene, 2)).toBe(true);
    expect(game.scene.getPlayerPokeballCounts(2)[PokeballType.MASTER_BALL]).toBe(1);
  });
});

describe("Shared reward tiers", () => {
  it("retains the exact base distribution", () => {
    const counts = [0, 0, 0, 0, 0];
    for (let roll = 0; roll < 1024; roll++) {
      counts[RewardTier.rollRewardTier(undefined, 0, () => roll).tier]++;
    }
    expect(counts).toEqual([768, 195, 48, 12, 1]);
  });

  it("uses the existing luck odds and supports consecutive upgrades", () => {
    const draws = [300, 3, 2, 4];
    const draw = vi.fn(() => draws.shift()!);
    expect(RewardTier.rollRewardTier(12, 0, draw)).toEqual({ tier: ModifierTier.ULTRA, upgradeCount: 2 });
    expect(draw.mock.calls).toEqual([[1024], [32], [32], [32]]);
  });
});
