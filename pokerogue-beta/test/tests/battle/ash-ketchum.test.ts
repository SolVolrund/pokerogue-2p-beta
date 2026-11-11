import { Battle } from "#app/battle";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { BattleType } from "#enums/battle-type";
import { AbilityId } from "#enums/ability-id";
import { modifierTypes } from "#data/data-lists";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { ModifierTier } from "#enums/modifier-tier";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { FormChangeItem } from "#enums/form-change-item";
import { type CustomModifierSettings, getDowsingItemOptions, getPlayerModifierTypeOptions, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { EvolutionItem } from "#balance/pokemon-evolutions";
import { PLAYER_TRAINER_SPRITE_OPTIONS, PlayerTrainerSprite } from "#enums/player-trainer-sprite";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { TrainerSlot } from "#enums/trainer-slot";
import { Trainer } from "#field/trainer";
import { ShinyBadgeModifier } from "#modifiers/modifier";
import { initBattleWithEnemyConfig } from "#mystery-encounters/encounter-phase-utils";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { NumberHolder } from "#utils/common";
import { createPalletExhibitionParty, PalletExhibitionEncounter } from "#mystery-encounters/pallet-exhibition-encounter";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { PokemonData } from "#system/pokemon-data";
import { ModifierData } from "#system/modifier-data";
import { getModifierType } from "#utils/modifier-utils";
import { GameManager } from "#test/framework/game-manager";
import { createComputerPartnerStarter, getComputerPartnerProfile, isComputerPartnerCandidateAllowed } from "#utils/computer-partner-profile";
import { validateRunPlayerAppearances } from "#utils/player-card";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Ash Ketchum's Partner Cap Pikachu", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => { phaserGame = new Phaser.Game({ type: Phaser.HEADLESS }); });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 2);
    game.scene.setComputerPartnerKey(1, "ash_ketchum");
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
  });

  it("starts with his capped Ace, retaining its form on reload without enabling either Raichu evolution", async () => {
    const profile = getComputerPartnerProfile("ash_ketchum");
    const starters = createComputerPartnerStarter(profile, game.scene.gameData.getComputerPartnerProgress(profile.key), 6, 1);
    expect(starters).toHaveLength(1);
    await new SelectStarterPhase().initPlayerStarters(starters, 1);
    const [ace] = game.scene.getPlayerParty(1);
    expect(ace.species.speciesId).toBe(SpeciesId.PIKACHU);
    expect(ace.computerPartnerAce).toBe(true);
    expect(ace.getFormKey()).toBe("partner-cap");
    expect(ace.getAbility().id).toBe(AbilityId.BATTLE_BOND);
    expect(ace.getPassiveAbility().id).toBe(AbilityId.TERAVOLT);
    const restored = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(ace)))).toPokemon();
    expect(restored.getFormKey()).toBe("partner-cap");
    expect(restored.isPlayer() && restored.computerPartnerAce).toBe(true);
    const partner = game.scene.addPlayerPokemon(ace.species, 100, 0, 1);
    expect(ace.getSpeciesForm().baseStats).toEqual(partner.getSpeciesForm().baseStats);
    expect(ace.getSpeciesForm().getLevelMoves()).toEqual(partner.getSpeciesForm().getLevelMoves());
    const evolutions = speciesDataRegistry.getEvolutions(SpeciesId.PIKACHU);
    for (const stone of [EvolutionItem.THUNDER_STONE, EvolutionItem.SHINY_STONE]) {
      expect(evolutions.some(e => e.validate(partner, false, stone))).toBe(true);
      expect(evolutions.some(e => e.validate(ace, false, stone))).toBe(false);
    }
    expect(ace.getSpeciesForm().isStarterSelectable).toBe(false);
    expect(game.scene.getTrainerSprite(1)).toBe(PlayerTrainerSprite.ASH_KETCHUM);
    expect(PLAYER_TRAINER_SPRITE_OPTIONS.some(o => o.sprite === PlayerTrainerSprite.ASH_KETCHUM)).toBe(false);
    expect(validateRunPlayerAppearances({ 1: "ash_ketchum_back" })).toEqual({ 1: "ash_ketchum_back" });
  });

  it("accepts his listed families including evolved, branched and regional catches, but not unrelated species", () => {
    const ash = getComputerPartnerProfile("ash_ketchum");
    const roots = ash.allowedReplacementSpeciesIds!;
    expect(roots).toHaveLength(64);
    expect(new Set(roots).size).toBe(roots.length);
    for (const id of [...roots, SpeciesId.RAICHU, SpeciesId.ALOLA_RAICHU, SpeciesId.ANNIHILAPE,
      SpeciesId.GALAR_FARFETCHD, SpeciesId.SIRFETCHD, SpeciesId.MR_RIME, SpeciesId.ALOLA_MUK,
      SpeciesId.BATTLE_BOND_GRENINJA, SpeciesId.GLALIE, SpeciesId.FROSLASS, SpeciesId.SOLGALEO, SpeciesId.LUNALA]) {
      expect(isComputerPartnerCandidateAllowed(ash, getPokemonSpecies(id), 1), SpeciesId[id]).toBe(true);
    }
    for (const id of [SpeciesId.LATIOS, SpeciesId.EEVEE, SpeciesId.NIHILEGO, SpeciesId.NECROZMA]) {
      expect(isComputerPartnerCandidateAllowed(ash, getPokemonSpecies(id), 1), SpeciesId[id]).toBe(false);
    }
  });

  it.each([1, 2, 3] as const)("builds a repeatable exhibition for %i participating trainers", count => {
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count === 3 ? 3 : 2);
    game.scene.currentBattle = new Battle(game.scene.gameMode, { waveIndex: 131, battleType: BattleType.MYSTERY_ENCOUNTER, double: false });
    const party = createPalletExhibitionParty();
    const mons = party.pokemonConfigs!;
    expect(PalletExhibitionEncounter.maxAllowedEncounters).toBe(1);
    expect(PalletExhibitionEncounter.twoPlayerSharedDecision).toBe("unanimousHumanYes");
    expect(party.battlerCountOverride).toBe(count);
    expect(mons).toHaveLength(6 + (count - 1) * 3);
    const friends = [party.partnerTrainerConfig, party.partnerTrainerConfig2].filter(Boolean);
    expect(new Set(friends.map(f => f!.trainerType)).size).toBe(count - 1);
    const ash = mons.filter(mon => mon.trainerSlot === TrainerSlot.TRAINER);
    expect(ash).toHaveLength(6);
    expect(ash.every(mon => mon.friendship === 255 && mon.passive)).toBe(true);
    expect(mons.filter(mon => mon.trainerSlot !== TrainerSlot.TRAINER).every(mon => mon.friendship == null)).toBe(true);
    expect(ash[0].species.forms[ash[0].formIndex!].formKey).toBe("partner-cap");
    expect(ash[0].modifierConfigs).toHaveLength(2);
    const transformed = ash.slice(1).filter(mon => mon.formIndex !== undefined);
    const firstEligibleTier = [ash.slice(1, 4), ash.slice(4, 5), ash.slice(5)].find(tier =>
      tier.some(mon => mon.species.forms.some(form => form.formKey.startsWith("mega") || form.formKey === "gigantamax")));
    expect(transformed).toHaveLength(firstEligibleTier ? 1 : 0);
    if (firstEligibleTier) expect(firstEligibleTier).toContain(transformed[0]);
    expect(createPalletExhibitionParty().pokemonConfigs!.map(mon => [mon.species.speciesId, mon.formIndex]))
      .toEqual(mons.map(mon => [mon.species.speciesId, mon.formIndex]));
  });

  it("shows Ash alongside his Partner Cap Pikachu before a battle is accepted", () => {
    const scene = game.scene;
    scene.currentBattle = new Battle(scene.gameMode, { waveIndex: 2, battleType: BattleType.MYSTERY_ENCOUNTER, double: false });
    const encounter = scene.currentBattle.mysteryEncounter = new MysteryEncounter(PalletExhibitionEncounter);
    expect(encounter.onInit!()).toBe(true);
    expect(encounter.spriteConfigs).toEqual([
      expect.objectContaining({ spriteKey: "ash_ketchum" }),
      expect.objectContaining({ fileRoot: "25-partner-cap", isPokemon: true, repeat: true, hasShadow: true }),
    ]);
    expect(scene.getEnemyParty()).toHaveLength(0);
  });

  it("offers a cap instead of a Rogue slot only to the eligible owner after a win", () => {
    const scene = game.scene;
    scene.newBattle();
    const encounter = scene.currentBattle.mysteryEncounter = new MysteryEncounter(PalletExhibitionEncounter);
    for (const owner of scene.getActivePlayerIndexes()) {
      const p = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 30);
      if (owner === 1) p.formIndex = p.species.forms.findIndex(f => f.formKey === "partner-cap");
      scene.getPlayerParty(owner).push(p);
    }
    const queue = vi.spyOn(scene.phaseManager, "unshiftNew");
    encounter.encounterMode = MysteryEncounterMode.NO_BATTLE;
    encounter.doEncounterRewards!();
    expect(queue).not.toHaveBeenCalled();
    encounter.encounterMode = MysteryEncounterMode.TRAINER_BATTLE;
    encounter.doEncounterRewards!();
    expect(queue).toHaveBeenCalledTimes(2);
    for (const owner of scene.getActivePlayerIndexes()) {
      expect(queue).toHaveBeenCalledWith("SelectModifierPhase", 0, undefined, {
        guaranteedModifierTypeFuncs: owner === 0 ? [modifierTypes.PARTNER_CAP] : [],
        guaranteedModifierTiers: [ModifierTier.MASTER], forcedModifierTier: ModifierTier.ROGUE,
        fillRemaining: true, allowLuckUpgrades: false, allowBonusRewards: false, rerollMultiplier: -1,
      }, false, owner);
      scene.setActivePlayerIndex(owner);
      const party = scene.getPlayerParty(owner);
      const settings = queue.mock.calls.find(args => args[5] === owner)![3] as CustomModifierSettings;
      regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0, owner);
      const choices = getPlayerModifierTypeOptions(4, party, undefined, settings);
      expect(choices.filter(o => o.type.tier === ModifierTier.MASTER)).toHaveLength(1);
      expect(choices.filter(o => o.type.tier === ModifierTier.ROGUE)).toHaveLength(3);
      expect(choices.filter(o => o.type.id === "PARTNER_CAP")).toHaveLength(owner === 0 ? 1 : 0);
      expect(getDowsingItemOptions(party, "FORM_CHANGE_ITEM").some(o => o.item === FormChangeItem.PARTNER_CAP)).toBe(false);
    }
  });

  it.each(["", "partner", "cool-cosplay", "gigantamax"])("restores Pikachu's original %s form after reload and deactivation", original => {
    const scene = game.scene;
    scene.newBattle();
    const p = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 30);
    scene.getPlayerParty(0).push(p);
    p.formIndex = p.species.forms.findIndex(f => f.formKey === original);
    const cap = getModifierType(modifierTypes.PARTNER_CAP).newModifier(p);
    if (!cap.is("PartnerCapModifier")) throw new Error("Expected Partner Cap");
    const data = new ModifierData(JSON.parse(JSON.stringify(new ModifierData(cap, true))), true);
    const restored = data.toModifier(cap.constructor);
    if (!restored?.is("PartnerCapModifier")) throw new Error("Expected saved Partner Cap");
    scene.getPlayerModifiers(0).push(restored);
    expect(restored.type.tier).toBe(ModifierTier.ROGUE);
    const nextForm = () => speciesDataRegistry.getFormChanges(SpeciesId.PIKACHU)
      .find(change => change.findTrigger(SpeciesFormChangeItemTrigger) && change.canChange(p))?.formKey;
    expect(nextForm()).toBe("partner-cap");
    p.formIndex = p.species.forms.findIndex(f => f.formKey === "partner-cap");
    restored.active = false;
    expect(nextForm()).toBe(original);
  });

  it("fields exactly three trainer lanes and gives only Ash's team the bond crit stage", async () => {
    const scene = game.scene;
    scene.configureTwoPlayerMode(true, 6, false, 3);
    scene.currentBattle = new Battle(scene.gameMode, { waveIndex: 91, battleType: BattleType.MYSTERY_ENCOUNTER, double: false });
    scene.currentBattle.mysteryEncounter = new MysteryEncounter(PalletExhibitionEncounter);
    vi.spyOn(Trainer.prototype, "initSprite").mockImplementation(() => {});
    vi.spyOn(Trainer.prototype, "loadAssets").mockResolvedValue();
    for (const owner of scene.getActivePlayerIndexes()) {
      scene.getPlayerParty(owner).push(scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 60));
    }
    await initBattleWithEnemyConfig(createPalletExhibitionParty());
    expect(scene.currentBattle.getBattlerCount()).toBe(3);
    const party = scene.getEnemyParty();
    expect(party).toHaveLength(12);
    expect(party.slice(0, 3).map(mon => mon.trainerSlot))
      .toEqual([TrainerSlot.TRAINER, TrainerSlot.TRAINER_PARTNER, TrainerSlot.TRAINER_PARTNER_2]);
    for (const mon of party) {
      expect(mon.passive).toBe(mon.trainerSlot === TrainerSlot.TRAINER);
      const stage = new NumberHolder(0);
      ShinyBadgeModifier.applyBattleBond(mon, "crit", stage);
      expect(stage.value).toBe(mon.trainerSlot === TrainerSlot.TRAINER ? 1 : 0);
    }
    const [pikachu, companion] = party;
    expect(pikachu.getAbility().id).toBe(AbilityId.BATTLE_BOND);
    expect(pikachu.getPassiveAbility().id).toBe(AbilityId.TERAVOLT);
    const roll = vi.spyOn(pikachu, "randBattleSeedInt").mockReturnValue(5);
    expect(ShinyBadgeModifier.tryBattleBondRevive(pikachu, false)).toBe(false);
    roll.mockReturnValue(4);
    const queue = vi.spyOn(scene.phaseManager, "unshiftNew");
    expect(ShinyBadgeModifier.tryBattleBondRevive(pikachu, true)).toBe(true);
    expect(queue).toHaveBeenCalledWith("PokemonHealPhase", pikachu.getBattlerIndex(), expect.any(Number),
      expect.objectContaining({ revive: true }));
    expect(ShinyBadgeModifier.tryBattleBondRevive(companion, false)).toBe(false);
  });

  it("toughs out lethal damage in the exhibition on rolls below 25, but not on 25", async () => {
    const scene = game.scene;
    scene.currentBattle = new Battle(scene.gameMode, { waveIndex: 91, battleType: BattleType.MYSTERY_ENCOUNTER, double: false });
    scene.currentBattle.mysteryEncounter = new MysteryEncounter(PalletExhibitionEncounter);
    vi.spyOn(Trainer.prototype, "initSprite").mockImplementation(() => {});
    vi.spyOn(Trainer.prototype, "loadAssets").mockResolvedValue();
    for (const owner of scene.getActivePlayerIndexes()) {
      scene.getPlayerParty(owner).push(scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 60));
    }
    await initBattleWithEnemyConfig(createPalletExhibitionParty());
    const [pikachu] = scene.getEnemyParty();
    const message = vi.spyOn(scene.phaseManager, "queueMessage");
    const roll = vi.spyOn(pikachu, "randBattleSeedInt").mockReturnValue(24);
    pikachu.damage(pikachu.hp);
    expect(pikachu.hp).toBe(1);
    expect(message).toHaveBeenCalledWith(expect.stringContaining("toughed it out for Ash"));
    pikachu.damage(1, false, false, true);
    expect(pikachu.hp).toBe(0);
    pikachu.hp = pikachu.getMaxHp();
    roll.mockReturnValue(25);
    pikachu.damage(pikachu.hp);
    expect(pikachu.hp).toBe(0);
  });

  it("loads capped front and back assets in either sprite mode, with both shinies and Partner palettes", () => {
    const species = getPokemonSpecies(SpeciesId.PIKACHU);
    const index = species.forms.findIndex(f => f.formKey === "partner-cap");
    const read = (path: string) => JSON.parse(readFileSync("assets/" + path, "utf8"));
    const exp = read("exp-sprites.json");
    const variants = read("images/pokemon/variant/_masterlist.json");
    for (const back of [false, true]) {
      const side = back ? "back/" : "";
      expect((back ? variants.back : variants)["25-partner-cap"]).toEqual([0, 1, 1]);
      for (const mode of ["", "exp/"]) {
        const palette = (stem: string) => read("images/pokemon/variant/" + stem + ".json");
        expect(palette(mode + side + "25-partner-cap")).toEqual(palette(side + "25-partner"));
        for (const shiny of [false, true]) {
          const key = side + (shiny ? "shiny/" : "") + "25-partner-cap";
          expect(species.getSpriteAtlasPath(true, index, shiny, 0, back)).toBe(key);
          expect(exp).toContain("25" + (shiny ? "s" : "") + (back ? "b" : "") + "-partner-cap");
          const atlas = read("images/pokemon/" + mode + key + ".json").textures[0];
          const png = readFileSync("assets/images/pokemon/" + mode + key + ".png");
          expect(atlas.size).toEqual({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) });
          expect(atlas.frames).toHaveLength(mode ? (back ? 113 : 112) : 1);
        }
      }
    }
  });
});
