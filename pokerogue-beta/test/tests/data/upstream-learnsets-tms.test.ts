import { EVOLVE_MOVE, RELEARN_MOVE } from "#app/constants";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { tmPoolTiers } from "#balance/tm-pool-tiers";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

describe("Upstream learnsets and TMs", () => {
  it.each([
    [SpeciesId.BUTTERFREE, 1, MoveId.STRING_SHOT],
    [SpeciesId.BEEDRILL, 1, MoveId.STRING_SHOT],
    [SpeciesId.CLEFABLE, 1, MoveId.DISARMING_VOICE],
    [SpeciesId.DIGLETT, 23, MoveId.MUD_BOMB],
    [SpeciesId.DUGTRIO, 25, MoveId.SLASH],
    [SpeciesId.PINSIR, 46, MoveId.SLASH],
    [SpeciesId.MEWTWO, 18, MoveId.PSYCH_UP],
    [SpeciesId.MEWTWO, 86, MoveId.DYNAMIC_PUNCH],
    [SpeciesId.TEDDIURSA, 1, MoveId.PLAY_NICE],
    [SpeciesId.TEDDIURSA, 15, MoveId.COVET],
    [SpeciesId.URSARING, 15, MoveId.COVET],
    [SpeciesId.VIGOROTH, 23, MoveId.CHIP_AWAY],
    [SpeciesId.SALAMENCE, 1, MoveId.SLASH],
    [SpeciesId.BIBAREL, 25, MoveId.WATER_PULSE],
    [SpeciesId.BIBAREL, 45, MoveId.AQUA_TAIL],
    [SpeciesId.CRANIDOS, 8, MoveId.ANCIENT_POWER],
    [SpeciesId.RAMPARDOS, 36, MoveId.ROCK_SLIDE],
    [SpeciesId.SHIELDON, 8, MoveId.ANCIENT_POWER],
    [SpeciesId.BASTIODON, 28, MoveId.ROCK_SLIDE],
    [SpeciesId.GIBLE, 48, MoveId.SANDSTORM],
    [SpeciesId.GABITE, 66, MoveId.TAKE_DOWN],
    [SpeciesId.GARCHOMP, 72, MoveId.EARTH_POWER],
    [SpeciesId.GARCHOMP, 82, MoveId.DRAGON_RUSH],
    [SpeciesId.LUMINEON, 66, MoveId.HYDRO_PUMP],
    [SpeciesId.AXEW, 15, MoveId.DUAL_CHOP],
    [SpeciesId.FRAXURE, 18, MoveId.SCARY_FACE],
    [SpeciesId.HAXORUS, 21, MoveId.SLASH],
    [SpeciesId.DRUDDIGON, 21, MoveId.CHIP_AWAY],
    [SpeciesId.KYUREM, RELEARN_MOVE, MoveId.ICICLE_SPEAR],
    [SpeciesId.HONEDGE, 20, MoveId.RETALIATE],
    [SpeciesId.DOUBLADE, 27, MoveId.SLASH],
    [SpeciesId.AEGISLASH, 20, MoveId.RETALIATE],
    [SpeciesId.CLOBBOPUS, 17, MoveId.MACH_PUNCH],
    [SpeciesId.GRAPPLOCT, 32, MoveId.STORM_THROW],
    [SpeciesId.GALAR_MEOWTH, 22, MoveId.BITE],
    [SpeciesId.PERRSERKER, 22, MoveId.BITE],
    [SpeciesId.GALAR_FARFETCHD, 31, MoveId.FEATHER_DANCE],
    [SpeciesId.SIRFETCHD, 31, MoveId.FEATHER_DANCE],
    [SpeciesId.INDEEDEE, 38, MoveId.WISH],
    [SpeciesId.ZAMAZENTA, RELEARN_MOVE, MoveId.METAL_BURST],
    [SpeciesId.ZAMAZENTA, 44, MoveId.BRICK_BREAK],
    [SpeciesId.URSALUNA, 15, MoveId.COVET],
    [SpeciesId.BLOODMOON_URSALUNA, 1, MoveId.MUD_SHOT],
    [SpeciesId.BLOODMOON_URSALUNA, 15, MoveId.ROUND],
  ])("gives species %i move %i/%i at its updated learning level", (species, level, move) => {
    expect(speciesDataRegistry.getLevelMoves(species)).toContainEqual([level, move]);
  });

  it.each([
    [SpeciesId.METAPOD, MoveId.TACKLE],
    [SpeciesId.GLALIE, MoveId.ICE_BALL],
    [SpeciesId.CLOBBOPUS, MoveId.BULLET_PUNCH],
    [SpeciesId.GRAPPLOCT, MoveId.KNOCK_OFF],
    [SpeciesId.MASCHIFF, MoveId.BOUNCE],
    [SpeciesId.MASCHIFF, MoveId.LUNGE],
    [SpeciesId.MABOSSTIFF, MoveId.BOUNCE],
    [SpeciesId.MABOSSTIFF, MoveId.LUNGE],
    [SpeciesId.BAXCALIBUR, MoveId.ICE_HAMMER],
  ])("removes obsolete level-up access for species %i to move %i", (species, move) => {
    expect(speciesDataRegistry.getLevelMoves(species).map(([, id]) => id)).not.toContain(move);
  });

  it("keeps cocoon wild learnsets limited to Harden", () => {
    for (const species of [SpeciesId.METAPOD, SpeciesId.KAKUNA]) {
      expect(speciesDataRegistry.getLevelMoves(species)).toEqual([
        [EVOLVE_MOVE, MoveId.HARDEN],
        [1, MoveId.HARDEN],
      ]);
    }
  });

  it.each([
    ["male", MoveId.TRI_ATTACK, MoveId.SING],
    ["female", MoveId.SING, MoveId.TRI_ATTACK],
  ] as const)("keeps Indeedee's %s learnset separate", (form, included, excluded) => {
    const moves = speciesDataRegistry.getLevelMoves(SpeciesId.INDEEDEE, form);
    expect(moves).toContainEqual([28, included]);
    expect(moves.map(([, move]) => move)).not.toContain(excluded);
    expect(moves).toContainEqual([38, MoveId.WISH]);
  });

  it("limits Sucker Punch to Single Strike Urshifu", () => {
    expect(speciesDataRegistry.getLevelMoves(SpeciesId.URSHIFU, "single-strike")).toContainEqual([
      1,
      MoveId.SUCKER_PUNCH,
    ]);
    expect(speciesDataRegistry.getLevelMoves(SpeciesId.URSHIFU, "rapid-strike").map(([, move]) => move)).not.toContain(
      MoveId.SUCKER_PUNCH,
    );
  });

  it.each([
    [MoveId.DUAL_CHOP, ModifierTier.GREAT],
    [MoveId.NIGHT_SLASH, ModifierTier.GREAT],
    [MoveId.FIRST_IMPRESSION, ModifierTier.ULTRA],
    [MoveId.WORRY_SEED, ModifierTier.COMMON],
    [MoveId.FOCUS_BLAST, ModifierTier.ULTRA],
    [MoveId.METEOR_BEAM, ModifierTier.ULTRA],
  ])("places TM %i in reward tier %i", (move, tier) => {
    expect(tmPoolTiers[move]).toBe(tier);
  });

  it.each([
    [SpeciesId.MACHAMP, MoveId.DUAL_CHOP],
    [SpeciesId.AEGISLASH, MoveId.DUAL_CHOP],
    [SpeciesId.INCINEROAR, MoveId.DUAL_CHOP],
    [SpeciesId.PERSIAN, MoveId.NIGHT_SLASH],
    [SpeciesId.LUXRAY, MoveId.NIGHT_SLASH],
    [SpeciesId.SNEASLER, MoveId.NIGHT_SLASH],
    [SpeciesId.FLYGON, MoveId.FIRST_IMPRESSION],
    [SpeciesId.AMOONGUSS, MoveId.FIRST_IMPRESSION],
    [SpeciesId.SPIDOPS, MoveId.FIRST_IMPRESSION],
    [SpeciesId.GOLISOPOD, MoveId.GUNK_SHOT],
    [SpeciesId.SWALOT, MoveId.CORROSIVE_GAS],
    [SpeciesId.GOGOAT, MoveId.MEGAHORN],
    [SpeciesId.SQUAWKABILLY, MoveId.SEED_BOMB],
    [SpeciesId.BAXCALIBUR, MoveId.FROST_BREATH],
    [SpeciesId.HISUI_ELECTRODE, MoveId.ELECTROWEB],
    [SpeciesId.BURMY, MoveId.STRUGGLE_BUG],
  ])("includes updated or inherited TM %i/%i", (species, move) => {
    expect(speciesDataRegistry.getTms(species)).toContain(move);
  });

  it.each([
    ["midday", false],
    ["midnight", true],
    ["dusk", false],
  ] as const)("limits Dual Chop TM compatibility for Lycanroc %s", (form, compatible) => {
    expect(speciesDataRegistry.getTms(SpeciesId.LYCANROC, form).includes(MoveId.DUAL_CHOP)).toBe(compatible);
  });

  it("does not carry Hisuian Voltorb's Electroweb addition into Hisuian Sneasel", () => {
    expect(speciesDataRegistry.getTms(SpeciesId.HISUI_SNEASEL)).not.toContain(MoveId.ELECTROWEB);
    expect(speciesDataRegistry.getTms(SpeciesId.SNEASLER)).not.toContain(MoveId.ELECTROWEB);
  });
});
