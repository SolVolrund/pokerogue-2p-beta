import { getGameMode } from "#app/game-mode";
import { getUnlockedAceType, normalizeAceType } from "#data/ace-type";
import { RoostedTag } from "#data/battler-tags";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { allMoves } from "#data/data-lists";
import { RemoveTypeAttr } from "#data/moves/move";
import { Nature } from "#enums/nature";
import { Pokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { PokemonTransformPhase } from "#phases/pokemon-transform-phase";
import { PokemonData } from "#system/pokemon-data";
import { SettingKeys } from "#system/settings/settings";
import { GameManager } from "#test/framework/game-manager";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import type { Starter } from "#types/save-data";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Ace bonus types", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let originalSettings: string | null;
  const props = { shiny: false, female: false, variant: 0 as const, formIndex: 0 };

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    originalSettings = localStorage.getItem("settings");
    game = new GameManager(phaserGame);
    await game.runToTitle();
    localStorage.setItem("settings", JSON.stringify({ [SettingKeys.Ace_Mechanics]: 1 }));
    // The storage mock lacks Storage's named properties; settings checks hasOwn.
    Object.defineProperty(localStorage, "settings", { value: true, configurable: true });
    // Headless sprites have no animation frames for the accessory renderer.
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
  });
  afterEach(() => {
    Reflect.deleteProperty(localStorage, "settings");
    if (originalSettings === null) {
      localStorage.removeItem("settings");
    } else {
      localStorage.setItem("settings", originalSettings);
    }
  });

  function ace(speciesId = SpeciesId.BULBASAUR, type = PokemonType.FIRE) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(speciesId), 20);
    pokemon.ace = true;
    pokemon.aceType = type;
    game.scene.getPlayerParty().push(pokemon);
    vi.spyOn(pokemon, "updateInfo").mockResolvedValue(undefined);
    return pokemon;
  }

  function starter(speciesId: SpeciesId): Starter {
    return { speciesId, shiny: false, variant: 0, formIndex: 0, abilityIndex: 0,
      passive: false, nature: Nature.HARDY, pokerus: false, ivs: [31, 31, 31, 31, 31, 31] };
  }

  it("unlocks individual types only, including Normal (zero)", () => {
    expect(getUnlockedAceType(PokemonType.NORMAL, { MONO_NORMAL: 123 })).toBe(PokemonType.NORMAL);
    expect(getUnlockedAceType(PokemonType.FIRE, { MONO_NORMAL: 123 })).toBeUndefined();
    for (const value of [-1, 18, 100, 1.5, "1", null, undefined]) {
      expect(normalizeAceType(value)).toBeUndefined();
    }
  });

  it("adds a third type and merges duplicates", () => {
    const pokemon = ace();
    expect(pokemon.getTypes()).toEqual([PokemonType.GRASS, PokemonType.POISON, PokemonType.FIRE]);
    pokemon.aceType = PokemonType.GRASS;
    expect(pokemon.getTypes()).toEqual([PokemonType.GRASS, PokemonType.POISON]);
    pokemon.aceType = PokemonType.NORMAL;
    expect(pokemon.getTypes()).toContain(PokemonType.NORMAL);
    pokemon.ace = false;
    expect(pokemon.getTypes()).not.toContain(PokemonType.NORMAL);
  });

  it("grants ordinary STAB once, including when the Ace type duplicates a natural type", () => {
    const pokemon = ace();
    expect(pokemon.calculateStabMultiplier(pokemon, allMoves[MoveId.EMBER], true, true)).toBe(1.5);
    pokemon.aceType = PokemonType.GRASS;
    expect(pokemon.calculateStabMultiplier(pokemon, allMoves[MoveId.VINE_WHIP], true, true)).toBe(1.5);
  });

  it("disables the bonus without erasing it when Ace Mechanics is off", () => {
    const pokemon = ace();
    localStorage.setItem("settings", JSON.stringify({ [SettingKeys.Ace_Mechanics]: 0 }));
    expect(pokemon.getTypes()).toEqual([PokemonType.GRASS, PokemonType.POISON]);
    expect(pokemon.aceType).toBe(PokemonType.FIRE);
  });

  it("uses all three types for defensive matchups", () => {
    const pokemon = ace(SpeciesId.CHARIZARD, PokemonType.BUG);
    expect(pokemon.getAttackTypeEffectiveness(PokemonType.ROCK)).toBe(8);
    pokemon.aceType = PokemonType.FIRE;
    expect(pokemon.getAttackTypeEffectiveness(PokemonType.ROCK)).toBe(4);
  });

  it("Burn Up suppresses a Fire Ace until switch reset, without changing its saved type", () => {
    const pokemon = ace();
    expect(new RemoveTypeAttr(PokemonType.FIRE).apply(pokemon, pokemon, allMoves[MoveId.BURN_UP], [])).toBe(true);
    expect(pokemon.getTypes()).toEqual([PokemonType.GRASS, PokemonType.POISON]);
    expect(pokemon.getAceType()).toBe(PokemonType.FIRE);
    pokemon.resetSummonData();
    expect(pokemon.getTypes()).toContain(PokemonType.FIRE);
  });

  it("replaces only the bonus slot with temporary added types and restores it on switch reset", () => {
    const pokemon = ace();
    pokemon.summonData.addedType = PokemonType.GHOST;
    expect(pokemon.getTypes()).toEqual([PokemonType.GRASS, PokemonType.POISON, PokemonType.GHOST]);
    expect(pokemon.getTypes({ ignoreThirdType: true })).toContain(PokemonType.FIRE);
    pokemon.resetSummonData();
    expect(pokemon.getTypes()).toContain(PokemonType.FIRE);
  });

  it("retains the bonus on base-type changes and evolution", () => {
    const pokemon = ace();
    pokemon.summonData.types = [PokemonType.WATER];
    expect(pokemon.getTypes()).toEqual([PokemonType.WATER, PokemonType.FIRE]);
    pokemon.resetSummonData();
    pokemon.species = getPokemonSpecies(SpeciesId.VENUSAUR);
    expect(pokemon.getTypes()).toEqual([PokemonType.GRASS, PokemonType.POISON, PokemonType.FIRE]);
  });

  it("round-trips through PokemonData, including a suppressed bonus in battle", () => {
    const pokemon = ace(SpeciesId.DITTO, PokemonType.NORMAL);
    pokemon.summonData.aceTypeSuppressed = true;
    const saved = JSON.parse(JSON.stringify(new PokemonData(pokemon)));
    const restored = new PokemonData(saved).toPokemon();
    expect(restored.ace).toBe(true);
    expect(restored.aceType).toBe(PokemonType.NORMAL);
    expect(restored.getAceType()).toBe(PokemonType.NORMAL);
    expect(new PokemonData({ ...saved, aceType: PokemonType.STELLAR }).aceType).toBeUndefined();
  });

  it("uses only ordinary Tera defensively but retains underlying Ace STAB", () => {
    const pokemon = ace();
    vi.spyOn(pokemon, "getTeraType").mockReturnValue(PokemonType.WATER);
    pokemon.isTerastallized = true;
    expect(pokemon.getTypes()).toEqual([PokemonType.WATER]);
    expect(pokemon.calculateStabMultiplier(pokemon, allMoves[MoveId.EMBER], true, true)).toBe(1.5);
    vi.mocked(pokemon.getTeraType).mockReturnValue(PokemonType.STELLAR);
    expect(pokemon.getTypes({ returnOriginalTypesIfStellar: true })).toEqual([
      PokemonType.GRASS, PokemonType.POISON, PokemonType.FIRE,
    ]);
  });

  it("does not reveal the real Ace type through Illusion", () => {
    const pokemon = ace(SpeciesId.ZOROARK, PokemonType.FIRE);
    const disguise = ace(SpeciesId.BULBASAUR, PokemonType.WATER);
    pokemon.setIllusion(disguise);
    expect(pokemon.getTypes({ useIllusion: true })).toEqual([
      PokemonType.GRASS, PokemonType.POISON, PokemonType.WATER,
    ]);
    expect(pokemon.getTypes()).toEqual([PokemonType.DARK, PokemonType.FIRE]);
    disguise.ace = false;
    pokemon.setIllusion(disguise);
    expect(pokemon.getTypes({ useIllusion: true })).toEqual([PokemonType.GRASS, PokemonType.POISON]);
  });

  it("Transform copies the target's natural typing while keeping the user's Ace type", async () => {
    const ditto = ace(SpeciesId.DITTO, PokemonType.FIRE);
    const target = ace(SpeciesId.BULBASAUR, PokemonType.WATER);
    vi.spyOn(game.scene, "getField").mockReturnValue([ditto, ditto, target]);
    vi.spyOn(ditto, "loadAssets").mockResolvedValue(undefined);
    vi.spyOn(ditto, "playAnim").mockImplementation(() => {});
    vi.spyOn(ditto, "setTempAbility").mockImplementation(() => {});
    const phase = new PokemonTransformPhase(BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    expect(ditto.getTypes()).toEqual([PokemonType.GRASS, PokemonType.POISON, PokemonType.FIRE]);
    expect(ditto.aceType).toBe(PokemonType.FIRE);
    await vi.waitFor(() => expect(phase.end).toHaveBeenCalled());
  });

  it("Roost suppresses Flying Ace temporarily without copying it into base types", () => {
    const pokemon = ace(SpeciesId.BULBASAUR, PokemonType.FLYING);
    const roost = new RoostedTag();
    pokemon.summonData.tags.push(roost);
    roost.onAdd(pokemon);
    expect(pokemon.getTypes()).toEqual([PokemonType.GRASS, PokemonType.POISON]);
    pokemon.summonData.tags = pokemon.summonData.tags.filter(tag => tag.tagType !== BattlerTagType.ROOSTED);
    roost.onRemove(pokemon);
    expect(pokemon.getTypes()).toEqual([PokemonType.GRASS, PokemonType.POISON, PokemonType.FLYING]);
    expect(pokemon.summonData.types).toEqual([]);
  });

  it("bases monotype battle eligibility on permanent typing, even while transformed or Terastallized", () => {
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P1, PokemonType.FIRE + 1);
    const pokemon = ace();
    pokemon.summonData.types = [PokemonType.WATER];
    pokemon.summonData.addedType = PokemonType.GHOST;
    pokemon.isTerastallized = true;
    vi.spyOn(pokemon, "getTeraType").mockReturnValue(PokemonType.ICE);
    expect(pokemon.isAllowedInBattle()).toBe(true);
    pokemon.ace = false;
    expect(pokemon.isAllowedInBattle()).toBe(false);
  });

  it("allows off-type starter browsing but requires selecting an unlocked Ace type to add it", () => {
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P1, PokemonType.FIRE + 1);
    game.scene.gameData.achvUnlocks = { MONO_FIRE: 1 };
    const handler = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
    handler["starterPreferences"] = {};
    const species = getPokemonSpecies(SpeciesId.BULBASAUR);
    expect(handler["checkStarterChallenge"](species, props, false)).toBe(false);
    expect(handler["checkStarterChallenge"](species, props, false, true)).toBe(true);
    handler["starterPreferences"][SpeciesId.BULBASAUR] = { ace: true, aceType: PokemonType.FIRE };
    expect(handler["checkStarterChallenge"](species, props, false)).toBe(true);
    game.scene.gameData.achvUnlocks = {};
    expect(handler["checkStarterChallenge"](species, props, false)).toBe(false);
  });

  it("uses the active player's achievements, not another player's unlocks", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const handler = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
    handler["starterPreferences"] = { [SpeciesId.BULBASAUR]: { ace: true, aceType: PokemonType.FIRE } };
    game.scene.getPlayerGameData(0).achvUnlocks = { MONO_FIRE: 1 };
    game.scene.getPlayerGameData(1).achvUnlocks = { MONO_WATER: 1 };
    game.scene.setActivePlayerIndex(0);
    expect(handler["getSelectedAceType"](SpeciesId.BULBASAUR)).toBe(PokemonType.FIRE);
    game.scene.setActivePlayerIndex(1);
    expect(handler["getSelectedAceType"](SpeciesId.BULBASAUR)).toBeUndefined();
  });

  it("updates already-selected starters when changing Ace, leaving only one active bonus", () => {
    const handler = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
    game.scene.gameData.achvUnlocks = { MONO_FIRE: 1, MONO_WATER: 1 };
    const first = starter(SpeciesId.BULBASAUR);
    const second = starter(SpeciesId.SQUIRTLE);
    handler["starters"] = [first, second];
    handler["starterPreferences"] = {
      [SpeciesId.BULBASAUR]: { ace: true, aceType: PokemonType.FIRE },
      [SpeciesId.SQUIRTLE]: { aceType: PokemonType.WATER },
    };
    handler["originalStarterPreferences"] = structuredClone(handler["starterPreferences"]);
    vi.spyOn(handler, "updateScroll").mockImplementation(() => {});
    vi.spyOn(handler, "tryUpdateValue").mockReturnValue(true);
    handler["setAceSpecies"](getPokemonSpecies(SpeciesId.SQUIRTLE),
      handler["starterPreferences"][SpeciesId.SQUIRTLE]!,
      handler["originalStarterPreferences"][SpeciesId.SQUIRTLE]!);
    expect(first.ace).toBe(false);
    expect(first.aceType).toBeUndefined();
    expect(second.ace).toBe(true);
    expect(second.aceType).toBe(PokemonType.WATER);
    expect(game.scene.getPlayerStarterPreferences()[SpeciesId.SQUIRTLE]?.aceType).toBe(PokemonType.WATER);
  });

  it("validates the achievement again when creating starters, not just in the UI", async () => {
    const phase = new SelectStarterPhase();
    const chosen = { ...starter(SpeciesId.BULBASAUR), ace: true, aceType: PokemonType.FIRE };
    game.scene.gameData.achvUnlocks = {};
    await phase.initPlayerStarters([chosen], 0);
    expect(game.scene.getPlayerParty()[0].getAceType()).toBeUndefined();
    game.scene.gameData.achvUnlocks = { MONO_FIRE: 1 };
    await phase.initPlayerStarters([chosen], 0);
    expect(game.scene.getPlayerParty()[0].getAceType()).toBe(PokemonType.FIRE);
  });

  describe("starter Ace locks", () => {
    let handler: StarterSelectUiHandler;

    beforeEach(() => {
      handler = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
      game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
      game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P1, PokemonType.NORMAL + 1);
      game.scene.gameData.achvUnlocks = { MONO_NORMAL: 1, MONO_FIRE: 1 };
      handler["starters"] = [];
      handler["starterSpecies"] = [];
      handler["starterPreferences"] = {};
      handler["originalStarterPreferences"] = {};
      vi.spyOn(handler, "updateScroll").mockImplementation(() => {});
      vi.spyOn(handler, "tryUpdateValue").mockReturnValue(true);
    });

    function selectAce(speciesId: SpeciesId, type: PokemonType) {
      const selected = { ...starter(speciesId), ace: true, aceType: type };
      handler["starters"] = [selected];
      handler["starterSpecies"] = [getPokemonSpecies(speciesId)];
      handler["starterPreferences"][speciesId] = { ace: true, aceType: type };
      handler["originalStarterPreferences"] = structuredClone(handler["starterPreferences"]);
      return selected;
    }

    it.each([
      [SpeciesId.EEVEE, PokemonType.FIRE, true],
      [SpeciesId.CHARMANDER, PokemonType.FIRE, false],
      [SpeciesId.CHARMANDER, PokemonType.NORMAL, true],
    ] as const)("checks actual typing for species %i with Ace type %i", (speciesId, type, expected) => {
      handler["starterPreferences"][speciesId] = { ace: true, aceType: type };
      const species = getPokemonSpecies(speciesId);
      expect(handler["checkStarterChallenge"](species, props, false)).toBe(expected);
      expect(handler["checkStarterChallenge"](species, props, true, true)).toBe(true);
    });

    it("locks both identity and type without mutating preferences or saving", () => {
      const selected = selectAce(SpeciesId.CHARMANDER, PokemonType.NORMAL);
      const attributes = handler["starterPreferences"][SpeciesId.CHARMANDER]!;
      const original = handler["originalStarterPreferences"][SpeciesId.CHARMANDER]!;
      const before = structuredClone(handler["starterPreferences"]);
      const save = vi.spyOn(game.scene, "savePlayerStarterPreferences");
      expect(handler["setAceSpecies"](getPokemonSpecies(SpeciesId.EEVEE), {}, {})).toBe(false);
      expect(handler["setAceType"](getPokemonSpecies(SpeciesId.CHARMANDER), attributes, original, PokemonType.FIRE)).toBe(false);
      expect(handler["setAceType"](getPokemonSpecies(SpeciesId.CHARMANDER), attributes, original, undefined)).toBe(false);
      expect(handler["setAceType"](getPokemonSpecies(SpeciesId.EEVEE), {}, {}, PokemonType.FIRE)).toBe(false);
      expect(handler["starterPreferences"]).toEqual(before);
      expect(selected.aceType).toBe(PokemonType.NORMAL);
      expect(save).not.toHaveBeenCalled();
    });

    it("uses the locked team snapshot and hides potential second Aces", () => {
      selectAce(SpeciesId.CHARMANDER, PokemonType.NORMAL);
      handler["starterPreferences"][SpeciesId.CHARMANDER]!.aceType = PokemonType.FIRE;
      handler["starterPreferences"][SpeciesId.SQUIRTLE] = { ace: true, aceType: PokemonType.NORMAL };
      expect(handler["getSelectedAceType"](SpeciesId.CHARMANDER)).toBe(PokemonType.NORMAL);
      expect(handler["getSelectedAceType"](SpeciesId.SQUIRTLE)).toBeUndefined();
      expect(handler["checkStarterChallenge"](getPokemonSpecies(SpeciesId.CHARMANDER), props, true, true)).toBe(true);
      expect(handler["checkStarterChallenge"](getPokemonSpecies(SpeciesId.SQUIRTLE), props, true, true)).toBe(false);
      expect(handler["checkStarterChallenge"](getPokemonSpecies(SpeciesId.EEVEE), props, true, true)).toBe(true);
    });

    it("retains ordinary evolution eligibility after locking an Ace", () => {
      game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P1, PokemonType.FIRE + 1);
      selectAce(SpeciesId.BULBASAUR, PokemonType.FIRE);
      expect(handler["checkStarterChallenge"](getPokemonSpecies(SpeciesId.EEVEE), props, true, true)).toBe(true);
      expect(handler["checkStarterChallenge"](getPokemonSpecies(SpeciesId.EEVEE), props, false)).toBe(false);
      expect(handler["checkStarterChallenge"](getPokemonSpecies(SpeciesId.SQUIRTLE), props, true, true)).toBe(false);
    });

    it("unlocks selection and broadens browsing after the Ace is removed", () => {
      selectAce(SpeciesId.CHARMANDER, PokemonType.NORMAL);
      const squirtle = getPokemonSpecies(SpeciesId.SQUIRTLE);
      expect(handler["checkStarterChallenge"](squirtle, props, true, true)).toBe(false);
      handler.popStarter(0);
      expect(handler["getPartyAce"]()).toBeUndefined();
      expect(handler["checkStarterChallenge"](squirtle, props, true, true)).toBe(true);
      const attributes = handler["starterPreferences"][SpeciesId.SQUIRTLE] = {};
      const original = handler["originalStarterPreferences"][SpeciesId.SQUIRTLE] = {};
      expect(handler["setAceType"](squirtle, attributes, original, PokemonType.NORMAL)).toBe(true);
      expect(handler["checkStarterChallenge"](squirtle, props, false)).toBe(true);
    });

    it("does not broaden the list without the matching achievement", () => {
      game.scene.gameData.achvUnlocks = { MONO_FIRE: 1 };
      expect(handler["checkStarterChallenge"](getPokemonSpecies(SpeciesId.SQUIRTLE), props, true, true)).toBe(false);
      expect(handler["checkStarterChallenge"](getPokemonSpecies(SpeciesId.EEVEE), props, true, true)).toBe(true);
    });

    it("rebuilds the actual challenge filter as an Ace enters and leaves the party", () => {
      game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P1, PokemonType.FIRE + 1);
      for (const container of handler["starterContainers"]) {
        vi.spyOn(container, "checkIconId").mockImplementation(() => {});
      }
      handler.resetFilters();
      handler.updateStarters();
      const visible = () => handler["validStarterContainers"].map(container => container.species.speciesId);
      expect(visible()).toContain(SpeciesId.SQUIRTLE);
      handler["starterSelectContainer"].setVisible(true);
      handler["starterPreferences"][SpeciesId.BULBASAUR] = { ace: true, aceType: PokemonType.FIRE };
      handler["originalStarterPreferences"] = structuredClone(handler["starterPreferences"]);
      vi.spyOn(handler, "checkIconId").mockImplementation(() => {});
      const species = getPokemonSpecies(SpeciesId.BULBASAUR);
      handler.addToParty(
        species,
        game.scene.gameData.getSpeciesDefaultDexAttr(species, false, true),
        0,
        0,
        Nature.HARDY,
        [MoveId.TACKLE],
        PokemonType.GRASS,
      );
      expect(handler["getPartyAce"]()?.aceType).toBe(PokemonType.FIRE);
      expect(visible()).not.toContain(SpeciesId.SQUIRTLE);
      expect(visible()).toContain(SpeciesId.BULBASAUR);
      expect(visible()).toContain(SpeciesId.CHARMANDER);
      handler.popStarter(0);
      expect(visible()).toContain(SpeciesId.SQUIRTLE);
    });
  });
});
