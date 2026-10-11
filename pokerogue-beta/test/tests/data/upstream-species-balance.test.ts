import { speciesDataRegistry } from "#app/global-species-data-registry";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { BIO_INSTABILITY_FORMS } from "#data/bio-instability";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

describe("Upstream species balance with secondary passives", () => {
  // Slot order is part of saved passive selections, including duplicate pairs.
  it.each([
    [SpeciesId.BEEDRILL, 1, [AbilityId.TINTED_LENS, AbilityId.TECHNICIAN]],
    [SpeciesId.SPEAROW, 0, [AbilityId.SPEED_BOOST, AbilityId.MOXIE]],
    [SpeciesId.FEAROW, 0, [AbilityId.SPEED_BOOST, AbilityId.MOXIE]],
    [SpeciesId.NIDORAN_F, 0, [AbilityId.TOXIC_DEBRIS, AbilityId.COMPETITIVE]],
    [SpeciesId.NIDORINA, 0, [AbilityId.TOXIC_DEBRIS, AbilityId.COMPETITIVE]],
    [SpeciesId.NIDOQUEEN, 0, [AbilityId.TOXIC_DEBRIS, AbilityId.QUEENLY_MAJESTY]],
    [SpeciesId.NATU, 0, [AbilityId.TINTED_LENS, AbilityId.SHEER_FORCE]],
    [SpeciesId.AMPHAROS, 1, [AbilityId.FLUFFY, AbilityId.ELECTROMORPHOSIS]],
    [SpeciesId.SUNKERN, 0, [AbilityId.DROUGHT, AbilityId.SEED_SOWER]],
    [SpeciesId.SUNFLORA, 0, [AbilityId.DROUGHT, AbilityId.GRASSY_SURGE]],
    [SpeciesId.WURMPLE, 0, [AbilityId.POISON_POINT, AbilityId.GLUTTONY]],
    [SpeciesId.JIRACHI, 0, [AbilityId.PURIFYING_SALT, AbilityId.VICTORY_STAR]],
    [SpeciesId.LUCARIO, 1, [AbilityId.MINDS_EYE, AbilityId.MOLD_BREAKER]],
    [SpeciesId.LUCARIO, 2, [AbilityId.NEUROFORCE, AbilityId.MAGIC_GUARD]],
    [SpeciesId.DUSKNOIR, 0, [AbilityId.LEVITATE, AbilityId.IRON_FIST]],
    [SpeciesId.UXIE, 0, [AbilityId.MAGIC_BOUNCE, AbilityId.AURA_GUARD]],
    [SpeciesId.KYUREM, 1, [AbilityId.HADRON_ENGINE, AbilityId.SNOW_WARNING]],
    [SpeciesId.KYUREM, 2, [AbilityId.ORICHALCUM_PULSE, AbilityId.SNOW_WARNING]],
    [SpeciesId.INKAY, 0, [AbilityId.GOOEY]],
    [SpeciesId.SKRELP, 0, [AbilityId.WATER_BUBBLE, AbilityId.TOXIC_CHAIN]],
    [SpeciesId.CRABRAWLER, 0, [AbilityId.OPPORTUNIST]],
    [SpeciesId.ORANGURU, 0, [AbilityId.POWER_SPOT, AbilityId.HOSPITALITY]],
    [SpeciesId.COSMOG, 0, [AbilityId.POWER_SPOT, AbilityId.PICKUP]],
    [SpeciesId.MELMETAL, 1, [AbilityId.FULL_METAL_BODY, AbilityId.HEATPROOF]],
    [SpeciesId.ELDEGOSS, 0, [AbilityId.SEED_SOWER]],
    [SpeciesId.SINISTEA, 0, [AbilityId.WATER_ABSORB]],
    [SpeciesId.SINISTEA, 1, [AbilityId.STURDY]],
    [SpeciesId.POLTEAGEIST, 0, [AbilityId.WATER_ABSORB]],
    [SpeciesId.POLTEAGEIST, 1, [AbilityId.STURDY]],
    [SpeciesId.FUECOCO, 0, [AbilityId.FLAME_BODY, AbilityId.GLUTTONY]],
    [SpeciesId.LOKIX, 0, [AbilityId.GUTS, AbilityId.RATTLED]],
    [SpeciesId.CAPSAKID, 0, [AbilityId.FLASH_FIRE, AbilityId.FLAME_BODY]],
    [SpeciesId.FINIZEN, 0, [AbilityId.FRIEND_GUARD]],
  ] as const)("updates species %i form %i without replacing secondary slots", (species, form, passives) => {
    expect(speciesDataRegistry.getPassiveOptions(species, form)).toEqual(passives);
    passives.forEach((ability, index) => {
      expect(speciesDataRegistry.getPassive(species, form, index)).toBe(ability);
    });
  });

  it("keeps Lucario's base and Mega passive selections separate", () => {
    expect(speciesDataRegistry.getPassiveOptions(SpeciesId.LUCARIO, 0)).toEqual([
      AbilityId.MINDS_EYE,
      AbilityId.BATTLE_BOND,
    ]);
    expect(speciesDataRegistry.getPassiveOptions(SpeciesId.LUCARIO, SpeciesFormKey.MEGA)).toEqual([
      AbilityId.MINDS_EYE,
      AbilityId.MOLD_BREAKER,
    ]);
    expect(speciesDataRegistry.getPassiveOptions(SpeciesId.LUCARIO, SpeciesFormKey.MEGA_Z)).toEqual([
      AbilityId.NEUROFORCE,
      AbilityId.MAGIC_GUARD,
    ]);
  });

  it("retains the already-current Mega Swampert passive and custom alternative", () => {
    expect(speciesDataRegistry.getPassiveOptions(SpeciesId.SWAMPERT, SpeciesFormKey.MEGA)).toEqual([
      AbilityId.REGENERATOR,
      AbilityId.DRY_SKIN,
    ]);
  });

  it.each(BIO_INSTABILITY_FORMS)("preserves custom Eevee form $key and both passive slots", form => {
    const forms = speciesDataRegistry.getSpecies(SpeciesId.EEVEE).forms;
    const index = forms.findIndex(candidate => candidate.formKey === form.key);
    expect(index).toBeGreaterThanOrEqual(3);
    expect(forms[index].ability1).toBe(AbilityId.BIO_INSTABILITY);
    expect(speciesDataRegistry.getPassiveOptions(SpeciesId.EEVEE, form.key)).toEqual([form.passive, form.passive]);
  });

  it.each([
    [SpeciesId.MEWTWO, "armored"],
    [SpeciesId.PICHU, "cosplay"],
    [SpeciesId.UNOWN, "schooling"],
    [SpeciesId.ARCEUS, "legend"],
  ] as const)("retains custom form %i/%s", (species, formKey) => {
    expect(speciesDataRegistry.getSpecies(species).forms.some(form => form.formKey === formKey)).toBe(true);
  });

  it.each([
    [SpeciesId.ABSOL, [MoveId.SPIRIT_BREAK, MoveId.FIRST_IMPRESSION, MoveId.CROSS_POISON, MoveId.BITTER_BLADE]],
    [SpeciesId.BUNEARY, [MoveId.LOVELY_KISS, MoveId.FAKE_OUT, MoveId.SWORDS_DANCE, MoveId.WICKED_BLOW]],
    [SpeciesId.GIBLE, [MoveId.NASTY_PLOT, MoveId.BITTER_BLADE, MoveId.LANDS_WRATH, MoveId.DRAGON_DANCE]],
    [SpeciesId.MANTYKE, [MoveId.SPLISHY_SPLASH, MoveId.FREEZY_FROST, MoveId.CALM_MIND, MoveId.BOUNCY_BUBBLE]],
    [SpeciesId.TYRUNT, [MoveId.HYPER_FANG, MoveId.DOUBLE_EDGE, MoveId.DRAGON_DANCE, MoveId.FLARE_BLITZ]],
    [SpeciesId.ZYGARDE, [MoveId.DRAGON_DARTS, MoveId.ARMOR_CANNON, MoveId.TAKE_HEART, MoveId.HEAL_ORDER]],
    [SpeciesId.CLOBBOPUS, [MoveId.KNOCK_OFF, MoveId.JET_PUNCH, MoveId.FLIP_TURN, MoveId.SURGING_STRIKES]],
    [SpeciesId.GLIMMET, [MoveId.EARTH_POWER, MoveId.GIGA_DRAIN, MoveId.MYSTICAL_FIRE, MoveId.MALIGNANT_CHAIN]],
  ] as const)("updates all four egg-move slots for species %i", (species, moves) => {
    expect(speciesEggMoves[species]).toEqual(moves);
  });

  it("corrects Mega Starmie's total without changing its individual stats", () => {
    const mega = speciesDataRegistry
      .getSpecies(SpeciesId.STARMIE)
      .forms.find(form => form.formKey === SpeciesFormKey.MEGA)!;
    expect(mega.baseStats).toEqual([60, 100, 105, 130, 105, 120]);
    expect(mega.baseTotal).toBe(620);
    expect(mega.baseTotal).toBe(mega.baseStats.reduce((sum, stat) => sum + stat, 0));
  });

  it.each([
    SpeciesId.RAICHU,
    SpeciesId.ALOLA_RAICHU,
  ])("resolves Raichu species %i to Pichu's starter family", species => {
    expect(speciesDataRegistry.getStarter(species)).toBe(SpeciesId.PICHU);
    expect(speciesEggMoves[speciesDataRegistry.getStarter(species)]).toEqual(speciesEggMoves[SpeciesId.PICHU]);
    expect(speciesDataRegistry.getStarter(SpeciesId.PIKACHU)).toBe(SpeciesId.PIKACHU);
  });

  it("updates Battle Bond Greninja without changing ordinary Froakie's cost", () => {
    expect(speciesDataRegistry.getSpecies(SpeciesId.BATTLE_BOND_GRENINJA).subLegendary).toBe(true);
    expect(speciesDataRegistry.getStarterCost(SpeciesId.BATTLE_BOND_GRENINJA)).toBe(6);
    expect(speciesDataRegistry.getStarterCost(SpeciesId.FROAKIE)).toBe(4);
  });
});
