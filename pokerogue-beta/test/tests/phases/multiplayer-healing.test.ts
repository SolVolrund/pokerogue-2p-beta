import { Battle } from "#app/battle";
import { Phase } from "#app/phase";
import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { Pokemon, type PlayerPokemon } from "#field/pokemon";
import { HealingBoosterModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import { PokemonHealPhase, type PokemonHealOptions } from "#phases/pokemon-heal-phase";
import { GameManager } from "#test/framework/game-manager";
import { choosePlannerMove } from "#utils/battle-planner-ai";
import { getHealingSupportMoveCapabilities } from "#utils/computer-partner-healing-support";
import { chooseComputerPartnerMoveLearningDecision } from "#utils/computer-partner-move-ai";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Multiplayer healing compatibility", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let party: PlayerPokemon[];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 2,
      battleType: BattleType.WILD,
      double: true,
    });
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    party = ([0, 1, 2] as const).map(player => {
      const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BLISSEY), 50);
      game.scene.getPlayerParty(player).push(pokemon);
      vi.spyOn(pokemon, "isOnField").mockReturnValue(true);
      vi.spyOn(pokemon, "isActive").mockImplementation(() => pokemon.hp > 0);
      vi.spyOn(pokemon, "getMaxHp").mockReturnValue(101);
      vi.spyOn(pokemon, "updateInfo").mockResolvedValue();
      pokemon.hp = 1;
      pokemon.moveset = [new PokemonMove(MoveId.RECOVER)];
      game.scene.getPlayerModifiers(player).splice(0);
      game.scene.getPlayerGameData(player).gameStats.highestHeal = 0;
      return pokemon;
    });
    game.scene.setActivePlayerIndex(0);
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  async function heal(player: 0 | 1 | 2, amount: number, options: PokemonHealOptions = {}) {
    const index = [BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.PLAYER_3][player];
    await new PokemonHealPhase(index, amount, { skipAnim: true, ...options }).end();
  }

  it("uses the recipient's charms and awards their actual healing, not the active player's", async () => {
    game.scene.getPlayerModifiers(0).push(new HealingBoosterModifier(modifierTypes.HEALING_CHARM(), 1.1, 5));
    game.scene.getPlayerModifiers(2).push(new HealingBoosterModifier(modifierTypes.HEALING_CHARM(), 1.1, 2));
    const achievements = vi.spyOn(game.scene, "validateAchvsForPlayer");
    await heal(1, 20);
    await heal(2, 20);
    expect(party.map(p => p.hp)).toEqual([1, 21, 25]);
    expect(game.scene.getPlayerGameData(0).gameStats.highestHeal).toBe(0);
    expect(game.scene.getPlayerGameData(1).gameStats.highestHeal).toBe(20);
    expect(game.scene.getPlayerGameData(2).gameStats.highestHeal).toBe(24);
    expect(achievements.mock.calls.map(call => call[1])).toEqual([1, 2]);
    party[2].hp = 99;
    await heal(2, 100);
    expect(party[2].hp).toBe(101);
    expect(game.scene.getPlayerGameData(2).gameStats.highestHeal).toBe(24);
  });

  it("does not award CPU healing achievements to a human", async () => {
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockImplementation(player => player === 2);
    const achievements = vi.spyOn(game.scene, "validateAchvsForPlayer");
    await heal(2, 20);
    expect(achievements).not.toHaveBeenCalled();
    expect(party[2].hp).toBe(21);
  });

  it("keeps healing tokens below full HP even with large amounts", async () => {
    party[1].hp = 90;
    await heal(1, 1000, { preventFullHeal: true });
    expect(party[1].hp).toBe(100);
    await heal(1, 1000, { preventFullHeal: true });
    expect(party[1].hp).toBe(100);
  });

  it("does not amplify Liquid Ooze with Healing Charms or heal a fainted target", async () => {
    game.scene.getPlayerModifiers(1).push(new HealingBoosterModifier(modifierTypes.HEALING_CHARM(), 1.1, 5));
    party[1].hp = 50;
    const damage = vi.spyOn(party[1], "damageAndUpdate").mockReturnValue(20);
    await heal(1, -20);
    expect(damage.mock.calls[0][0]).toBe(20);
    party[1].hp = 0;
    await heal(1, 50);
    expect(party[1].hp).toBe(0);
  });

  it("revives without Healing Charm boosts or restoring used PP", async () => {
    game.scene.getPlayerModifiers(2).push(new HealingBoosterModifier(modifierTypes.HEALING_CHARM(), 1.1, 5));
    party[2].hp = 0;
    party[2].moveset[0].ppUsed = 3;
    await heal(2, 50, { revive: true });
    expect(party[2].hp).toBe(50);
    expect(party[2].moveset[0].ppUsed).toBe(3);
  });

  it("restores PP and cures status at full HP only when requested", async () => {
    party[1].hp = 101;
    party[1].moveset[0].ppUsed = 3;
    party[1].trySetStatus(StatusEffect.BURN, party[1]);
    await heal(1, 100, { healStatus: true, fullRestorePP: true });
    expect(party[1].status).toBeUndefined();
    expect(party[1].moveset[0].ppUsed).toBe(0);
    expect(party[1].hp).toBe(101);
  });

  it("blocks positive healing with Heal Block", async () => {
    party[1].addTag(BattlerTagType.HEAL_BLOCK, 5);
    await heal(1, 50);
    expect(party[1].hp).toBe(1);
  });

  it("allows Pollen Puff to heal either ally in triples", () => {
    const move = allMoves[MoveId.POLLEN_PUFF];
    const attr = move.getAttrs("HealOnAllyAttr")[0];
    expect(attr.canApply(party[0], party[1], move, [])).toBe(true);
    expect(attr.canApply(party[0], party[2], move, [])).toBe(true);
  });

  it("calculates variable healing freshly without leaving state on the shared move", () => {
    const move = allMoves[MoveId.SYNTHESIS];
    const attr = move.getAttrs("HealAttr")[0];
    game.scene.arena.trySetWeather(WeatherType.SUNNY);
    expect(attr.getHealRatio(party[0], party[0], move, true)).toBe(2 / 3);
    game.scene.arena.trySetWeather(WeatherType.RAIN);
    expect(attr.getHealRatio(party[1], party[1], move, true)).toBe(0.25);
    const floral = allMoves[MoveId.FLORAL_HEALING];
    const floralAttr = floral.getAttrs("HealAttr")[0];
    game.scene.arena.trySetTerrain(TerrainType.GRASSY);
    expect(floralAttr.getHealRatio(party[0], party[2], floral, true)).toBe(2 / 3);
    game.scene.arena.trySetTerrain(TerrainType.NONE);
    expect(floralAttr.getHealRatio(party[0], party[2], floral, true)).toBe(0.5);
  });

  it("retains Triage priority for healing, draining moves and Pollen Puff", () => {
    vi.spyOn(party[0], "getAbility").mockReturnValue(allAbilities[AbilityId.TRIAGE]);
    for (const id of [MoveId.RECOVER, MoveId.GIGA_DRAIN, MoveId.POLLEN_PUFF, MoveId.LIFE_DEW]) {
      expect(allMoves[id].hasFlag(MoveFlags.HEALING_MOVE)).toBe(true);
      expect(allMoves[id].getPriority(party[0])).toBe(3);
    }
    expect(allMoves[MoveId.SPLASH].hasFlag(MoveFlags.HEALING_MOVE)).toBe(false);
  });

  it("recognizes Milk Drink as both self and ally healing for Cheryl's move learning", () => {
    const move = allMoves[MoveId.MILK_DRINK];
    expect(getHealingSupportMoveCapabilities(move)).toEqual({
      healsSelf: true,
      healsPartner: true,
      healsAllAllies: false,
    });
    const decision = chooseComputerPartnerMoveLearningDecision(
      party[0],
      [MoveId.SPLASH, MoveId.TACKLE, MoveId.GROWL, MoveId.TAIL_WHIP],
      move,
      LearnMoveType.LEARN_MOVE,
      { profile: getComputerPartnerProfile("cheryl") },
    );
    expect(decision.shouldLearn).toBe(true);
  });

  it("lets the planner estimate variable heals without applying ability effects", () => {
    const move = allMoves[MoveId.SYNTHESIS];
    const attr = move.getAttrs("HealAttr")[0];
    const ratio = vi.spyOn(attr, "getHealRatio");
    party[0].moveset = [new PokemonMove(MoveId.SYNTHESIS)];
    const choice = choosePlannerMove(party[0], party[0].moveset);
    expect(choice.move).toBe(MoveId.SYNTHESIS);
    expect(ratio).toHaveBeenCalled();
    expect(ratio.mock.calls.every(call => call[3] === true)).toBe(true);
  });
});
