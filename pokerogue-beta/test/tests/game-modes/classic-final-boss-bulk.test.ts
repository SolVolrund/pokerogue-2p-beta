import { getGameMode } from "#app/game-mode";
import { modifierTypes } from "#data/data-lists";
import { SpeciesFormChangeManualTrigger } from "#data/form-change-triggers";
import { SpeciesFormChange } from "#data/pokemon-forms";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { Stat, type PermanentStat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { Pokemon, type EnemyPokemon } from "#field/pokemon";
import { BaseStatModifier } from "#modifiers/modifier";
import { ModifierTypeGenerator } from "#modifiers/modifier-type";
import { BattlePhase } from "#phases/battle-phase";
import { QuietFormChangePhase } from "#phases/quiet-form-change-phase";
import { QuietSpeciesChangePhase } from "#phases/quiet-Species-change-phase";
import { ModifierData } from "#system/modifier-data";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { applyClassicFinalBossBulkBonus } from "#utils/classic-final-boss-bulk";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const bulkStats = [Stat.HP, Stat.DEF, Stat.SPDEF] as const;

describe("Alternate final boss defensive vitamins", () => {
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
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.newBattle();
    game.scene.currentBattle.waveIndex = 200;
    game.scene.currentBattle.enemyParty = [];
    game.scene["enemyModifiers"] = [];
    vi.spyOn(game.scene, "updateModifiers").mockImplementation(() => {});
    vi.spyOn(BattlePhase.prototype, "end").mockImplementation(() => {});
  });

  function boss(speciesId: SpeciesId, formKey: string): EnemyPokemon {
    const pokemon = game.scene.addEnemyPokemon(getPokemonSpecies(speciesId), 200, TrainerSlot.NONE, true);
    pokemon.formIndex = pokemon.species.forms.length
      ? pokemon.species.forms.findIndex(form => form.formKey === formKey)
      : 0;
    expect(pokemon.formIndex).toBeGreaterThanOrEqual(0);
    pokemon.ivs.fill(31);
    game.scene.currentBattle.enemyParty.push(pokemon);
    pokemon.calculateStats();
    vi.spyOn(pokemon, "cry").mockReturnValue(null);
    if (speciesId === SpeciesId.MEWTWO) {
      game.scene.currentBattle.mewtwoFinalBossState = {
        stage: formKey ? 3 : 2,
        lanes: [{ fieldIndex: 0, playerIndex: 0, trainerSlot: TrainerSlot.NONE, clonePokemonIds: [], bossPokemonId: pokemon.id }],
      };
    }
    if (speciesId === SpeciesId.UNOWN) {
      game.scene.currentBattle.waveIndex = 220;
      game.scene.currentBattle.unownFinalBossState = { bossPokemonId: pokemon.id, helperSlots: [] };
    }
    return pokemon;
  }

  function vitamin(pokemon: Pokemon, stat: PermanentStat, stacks: number): BaseStatModifier {
    const generator = getModifierType(modifierTypes.BASE_STAT_BOOSTER) as ModifierTypeGenerator;
    const modifier = generator.generateType(game.scene.getEnemyParty(), [stat])!.newModifier(pokemon) as BaseStatModifier;
    modifier.stackCount = stacks;
    void game.scene.addEnemyModifier(modifier, true, true);
    return modifier;
  }

  function stacks(pokemon: Pokemon): number[] {
    return bulkStats.map(stat => game.scene["enemyModifiers"]
      .filter((modifier): modifier is BaseStatModifier => modifier instanceof BaseStatModifier
        && modifier.pokemonId === pokemon.id && modifier.getArgs()[1] === stat)
      .reduce((total, modifier) => total + modifier.stackCount, 0));
  }

  it.each([
    [SpeciesId.NECROZMA, "ultra"],
    [SpeciesId.ARCEUS, "legend"],
    [SpeciesId.MEWTWO, "mega-x"],
    [SpeciesId.MEWTWO, "mega-y"],
    [SpeciesId.MEWTWO, "armored"],
    [SpeciesId.UNOWN, "schooling"],
  ] as const)("gives species %i form %s ten stacks exactly once", (speciesId, form) => {
    const pokemon = boss(speciesId, form);
    const oldHp = pokemon.getMaxHp();
    expect(applyClassicFinalBossBulkBonus(pokemon)).toBe(true);
    expect(stacks(pokemon)).toEqual([10, 10, 10]);
    expect(pokemon.getMaxHp()).toBeGreaterThan(oldHp);
    expect(applyClassicFinalBossBulkBonus(pokemon)).toBe(false);
    expect(stacks(pokemon)).toEqual([10, 10, 10]);
    expect(game.scene["enemyModifiers"].every(modifier => modifier instanceof BaseStatModifier && !modifier.isTransferable)).toBe(true);
  });

  it.each([
    [SpeciesId.ETERNATUS, ""],
    [SpeciesId.ETERNATUS, "eternamax"],
    [SpeciesId.NECROZMA, "dusk-mane"],
    [SpeciesId.NECROZMA, "dawn-wings"],
    [SpeciesId.ARCEUS, "normal"],
    [SpeciesId.MEWTWO, ""],
    [SpeciesId.UNOWN, "a"],
  ] as const)("does not buff Eternatus or early forms: %i / %s", (speciesId, form) => {
    const pokemon = boss(speciesId, form);
    expect(applyClassicFinalBossBulkBonus(pokemon)).toBe(false);
    expect(stacks(pokemon)).toEqual([0, 0, 0]);
  });

  it.each([0, 5, 10, 31])("adds to existing %i vitamin stacks without replacing them", count => {
    const pokemon = boss(SpeciesId.NECROZMA, "ultra");
    for (const stat of bulkStats) {
      if (count) vitamin(pokemon, stat, count);
    }
    applyClassicFinalBossBulkBonus(pokemon);
    expect(stacks(pokemon)).toEqual([count + 10, count + 10, count + 10]);
  });

  it("preserves the marker and above-cap vitamins through PokemonData and ModifierData loading", () => {
    const pokemon = boss(SpeciesId.NECROZMA, "ultra");
    for (const stat of bulkStats) vitamin(pokemon, stat, 31);
    applyClassicFinalBossBulkBonus(pokemon);
    const savedPokemon = JSON.parse(JSON.stringify(new PokemonData(pokemon)));
    const savedModifiers = JSON.parse(JSON.stringify(game.scene["enemyModifiers"].map(modifier => new ModifierData(modifier, false))));
    const restored = new PokemonData(savedPokemon).toPokemon(BattleType.WILD) as EnemyPokemon;
    game.scene.currentBattle.enemyParty = [restored];
    game.scene["enemyModifiers"] = savedModifiers.map(data => new ModifierData(data, false).toModifier(BaseStatModifier));
    expect(restored.customPokemonData.finalBossBulkBonusApplied).toBe(true);
    expect(stacks(restored)).toEqual([41, 41, 41]);
    expect(applyClassicFinalBossBulkBonus(restored)).toBe(false);
    expect(stacks(restored)).toEqual([41, 41, 41]);
  });

  it("does not increase offensive or player vitamin limits", () => {
    const pokemon = boss(SpeciesId.NECROZMA, "ultra");
    applyClassicFinalBossBulkBonus(pokemon);
    expect(vitamin(pokemon, Stat.ATK, 1).getMaxHeldItemCount(pokemon)).toBe(31);
    const player = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MEW), 200);
    player.ivs.fill(31);
    player.customPokemonData.finalBossBulkBonusApplied = true;
    expect(vitamin(pokemon, Stat.DEF, 1).getMaxHeldItemCount(player)).toBe(31);
    expect(applyClassicFinalBossBulkBonus(player)).toBe(false);
  });

  it("does not buff ordinary encounters, clones, or Unown's helpers", () => {
    const pokemon = boss(SpeciesId.NECROZMA, "ultra");
    game.scene.currentBattle.waveIndex = 199;
    expect(applyClassicFinalBossBulkBonus(pokemon)).toBe(false);
    game.scene.currentBattle.waveIndex = 200;
    pokemon.setBoss(false);
    expect(applyClassicFinalBossBulkBonus(pokemon)).toBe(false);
    const unown = boss(SpeciesId.UNOWN, "schooling");
    game.scene.currentBattle.unownFinalBossState!.bossPokemonId = pokemon.id;
    expect(applyClassicFinalBossBulkBonus(unown)).toBe(false);
  });

  it.each([
    [SpeciesId.NECROZMA, "ultra"],
    [SpeciesId.ARCEUS, "legend"],
    [SpeciesId.MEWTWO, "mega-x"],
    [SpeciesId.MEWTWO, "mega-y"],
    [SpeciesId.MEWTWO, "armored"],
  ] as const)("applies the bonus before the form-transition heal: %i / %s", (speciesId, form) => {
    const pokemon = boss(speciesId, form);
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    const phase = new QuietFormChangePhase(pokemon, new SpeciesFormChange({
      speciesId, preFormKey: "", evoFormKey: form, trigger: new SpeciesFormChangeManualTrigger(), quiet: true,
    }));
    phase.end();
    expect(stacks(pokemon)).toEqual([10, 10, 10]);
    expect(queue.mock.calls.find(call => call[0] === "PokemonHealPhase")?.[2]).toBe(pokemon.getMaxHp());
  });

  it("buffs Mew on the first transformation and retains the same stacks through all later species", async () => {
    const pokemon = boss(SpeciesId.MEW, "");
    const state = game.scene.currentBattle.mewGauntletState = { pokemonId: pokemon.id, phase: 1, usedSpeciesIds: [SpeciesId.MEW] };
    expect(applyClassicFinalBossBulkBonus(pokemon)).toBe(false);
    vi.spyOn(pokemon, "updateInfo").mockResolvedValue();
    vi.spyOn(game.scene, "updateFieldScale").mockResolvedValue();
    for (const speciesId of [SpeciesId.LUGIA, SpeciesId.GROUDON, SpeciesId.NECROZMA, SpeciesId.MEWTWO, SpeciesId.KYOGRE, SpeciesId.MEW]) {
      state.phase++;
      const phase = new QuietSpeciesChangePhase(pokemon, speciesId);
      await phase["doChangeSpecies"]();
      phase.end();
      expect(stacks(pokemon)).toEqual([10, 10, 10]);
      expect(pokemon.customPokemonData.finalBossBulkBonusApplied).toBe(true);
    }
  });
});
