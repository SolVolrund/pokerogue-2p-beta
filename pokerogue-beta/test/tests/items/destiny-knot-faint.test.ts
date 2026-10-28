import { FRIENDSHIP_LOSS_FROM_FAINT } from "#balance/starters";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { Pokemon } from "#field/pokemon";
import { DestinyKnotModifier, type PersistentModifier, PokemonInstantReviveModifier } from "#modifiers/modifier";
import type { ModifierTypeGenerator } from "#modifiers/modifier-type";
import { FaintPhase } from "#phases/faint-phase";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { getSoulBondPartner, refreshSoulBondHpForParties } from "#utils/soul-bond";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Items - Destiny Knot fainting", () => {
  let phaser: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaser = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
    game.override.battleStyle("single");
  });

  beforeEach(() => {
    game = new GameManager(phaser);
    game.scene.configureTwoPlayerMode(false);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingHeldItems([])
      .enemyHeldItems([]);
  });

  function giveItem(pokemon: Pokemon, name: "REVIVER_SEED" | "SHINY_BADGE" | "STICKY_BARBS") {
    const modifier = getModifierType(modifierTypes[name]).newModifier(pokemon) as PersistentModifier;
    const owner = game.scene.getPlayerIndexForPokemon(pokemon)!;
    game.scene.getPlayerModifiers(owner).push(modifier);
    return modifier;
  }

  function bond(a: Pokemon, b: Pokemon) {
    const generator = getModifierType(modifierTypes.DESTINY_KNOT) as ModifierTypeGenerator;
    for (const pokemon of [a, b]) {
      const modifier = generator.generateType([pokemon], ["red"])!.newModifier(pokemon) as DestinyKnotModifier;
      game.scene.getPlayerModifiers(game.scene.getPlayerIndexForPokemon(pokemon)!).push(modifier);
    }
    refreshSoulBondHpForParties();
    for (const pokemon of [a, b]) {
      pokemon.hp = pokemon.getMaxHp();
    }
    expect(getSoulBondPartner(a)).toBe(b);
  }

  async function setup(onField = false, spare = true) {
    game.override.battleStyle(onField ? "double" : "single");
    if (spare) {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.SQUIRTLE, SpeciesId.CHARMANDER);
    } else {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.SQUIRTLE);
    }
    const [source, partner] = game.scene.getPlayerParty();
    bond(source, partner);
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    return { source, partner };
  }

  async function resolve(
    phases: FaintPhase[],
    target: "TurnEndPhase" | "GameOverPhase" | "DamageAnimPhase" | "VictoryPhase" = "TurnEndPhase",
  ) {
    const manager = game.scene.phaseManager;
    manager.clearAllPhases();
    for (const phase of phases) {
      manager.pushPhase(phase);
    }
    manager.pushNew("TurnEndPhase");
    manager.shiftPhase();
    await game.phaseInterceptor.to(target, false);
  }

  function expectFaints(...pokemon: Pokemon[]) {
    expect(game.scene.currentBattle.playerFaintsHistory.map(entry => entry.pokemon)).toEqual(pokemon);
    expect(game.scene.arena.playerFaints).toBe(pokemon.length);
  }

  async function resolveSpreadKo(pokemon: Pokemon[], target: "TurnEndPhase" | "GameOverPhase" = "TurnEndPhase") {
    const manager = game.scene.phaseManager;
    manager.clearAllPhases();
    for (const victim of pokemon) {
      victim.hp = 1;
      victim.damageAndUpdate(1);
    }
    manager.pushNew("TurnEndPhase");
    const sibling = manager.create("SoulBondPhase");
    manager.pushPhase(sibling);
    manager.shiftPhase();
    await game.phaseInterceptor.to(target, false);
    expect(manager.hasPhaseOfType("SoulBondPhase", phase => phase === sibling)).toBe(true);
  }

  it.each([
    false,
    true,
  ])("settles an unrelated spread KO's seed before doubles outcomes (reserve: %s)", async reserve => {
    game.override.battleStyle("double");
    if (reserve) {
      await game.classicMode.startBattle(
        SpeciesId.BULBASAUR,
        SpeciesId.SQUIRTLE,
        SpeciesId.CHARMANDER,
        SpeciesId.EEVEE,
      );
    } else {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.SQUIRTLE, SpeciesId.CHARMANDER);
    }
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    const [source, survivor, partner] = game.scene.getPlayerParty();
    bond(source, partner);
    giveItem(survivor, "REVIVER_SEED");
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    const unshift = vi.spyOn(game.scene.phaseManager, "unshiftNew");

    await resolveSpreadKo([source, survivor]);

    expectFaints(source, partner);
    expect(source.isFainted(true)).toBe(true);
    expect(partner.isFainted(true)).toBe(true);
    expect(survivor.hp).toBe(toDmgValue(survivor.getMaxHp() / 2));
    expect(survivor.isOnField()).toBe(true);
    expect(survivor.getHeldItems().some(item => item instanceof PokemonInstantReviveModifier)).toBe(false);
    expect(unshift.mock.calls.some(call => call[0] === "GameOverPhase")).toBe(false);
    expect(push.mock.calls.filter(call => call[0] === "SwitchPhase").map(call => call[2])).toEqual(reserve ? [0] : []);
    expect(unshift.mock.calls.filter(call => call[0] === "ToggleDoublePositionPhase")).toHaveLength(reserve ? 0 : 1);
    expect(game.scene.phaseManager.hasPhaseOfType("FaintPhase")).toBe(false);
  });

  it("commits every unrelated spread KO before a real game over", async () => {
    game.override.battleStyle("double");
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.SQUIRTLE, SpeciesId.CHARMANDER);
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    const [source, other, partner] = game.scene.getPlayerParty();
    bond(source, partner);

    await resolveSpreadKo([source, other], "GameOverPhase");

    expectFaints(source, partner, other);
    expect([source, partner, other].every(pokemon => pokemon.isFainted(true))).toBe(true);
    expect(game.scene.phaseManager.hasPhaseOfType("FaintPhase")).toBe(false);
  });

  it.each([false, true])("settles a different 3P owner's spread KO before terminal outcomes (Vs: %s)", async vsMode => {
    await game.classicMode.runToSummon(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER);
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    game.scene.configureTwoPlayerMode(true, 6, false, 3, [], vsMode);
    game.scene.currentBattle.double = true;
    for (const owner of [1, 2] as const) {
      const lead = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.SQUIRTLE), 50);
      game.scene.getPlayerParty(owner).push(lead);
      game.scene.phaseManager.unshiftNew("SummonPhase", owner, true);
    }
    await game.phaseInterceptor.to("CommandPhase");
    const [source, partner] = game.scene.getPlayerParty(0);
    const survivor = game.scene.getPlayerParty(1)[0];
    const third = game.scene.getPlayerParty(2)[0];
    bond(source, partner);
    giveItem(survivor, "REVIVER_SEED");
    expect([source, survivor, third].every(pokemon => pokemon.isOnField())).toBe(true);
    const clear = vi.spyOn(game.scene.phaseManager, "clearPhaseQueue");
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    const unshift = vi.spyOn(game.scene.phaseManager, "unshiftNew");

    await resolveSpreadKo(vsMode ? [source, survivor] : [source, third, survivor]);

    expectFaints(...(vsMode ? [source, partner] : [source, partner, third]));
    expect(survivor.hp).toBe(toDmgValue(survivor.getMaxHp() / 2));
    expect(survivor.isOnField()).toBe(true);
    expect(survivor.getHeldItems().some(item => item instanceof PokemonInstantReviveModifier)).toBe(false);
    expect(unshift.mock.calls.some(call => call[0] === "GameOverPhase")).toBe(false);
    expect(push.mock.calls.some(call => call[0] === "VsModeVictoryPhase" || call[0] === "BattleEndPhase")).toBe(false);
    // resolveSpreadKo clears the test setup once; battle outcomes must not clear it again.
    expect(clear).toHaveBeenCalledExactlyOnceWith();
    expect(game.scene.phaseManager.hasPhaseOfType("FaintPhase")).toBe(false);
  });

  it("awards each wild enemy's EXP but completes a simultaneous doubles KO only once", async () => {
    game.override.battleStyle("double");
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.SQUIRTLE);
    const enemies = game.scene.getEnemyParty();
    expect(enemies).toHaveLength(2);
    const exp = vi.spyOn(game.scene, "applyPartyExp");
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");

    await resolveSpreadKo(enemies);

    expect(exp).toHaveBeenCalledTimes(2);
    for (const phase of ["BattleEndPhase", "SelectModifierPhase", "NewBattlePhase"]) {
      expect(push.mock.calls.filter(call => call[0] === phase)).toHaveLength(1);
    }
    expect(enemies.every(enemy => enemy.isFainted(true))).toBe(true);
  });

  it("commits a bench KO once without animating, switching, or removing another field occupant", async () => {
    const { source, partner } = await setup();
    const friendship = partner.friendship;
    game.scene.currentBattle.addParticipant(partner);
    const cry = vi.spyOn(partner, "faintCry");
    const leave = vi.spyOn(partner, "leaveField");
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    const message = vi.spyOn(game.scene.phaseManager, "queueMessage");
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expectFaints(source, partner);
    expect(source.isFainted(true)).toBe(true);
    expect(partner.isFainted(true)).toBe(true);
    expect(partner.friendship).toBe(friendship - FRIENDSHIP_LOSS_FROM_FAINT);
    expect(game.scene.currentBattle.playerParticipantIds.has(partner.id)).toBe(false);
    expect(cry.mock.contexts).not.toContain(partner);
    expect(leave.mock.contexts).not.toContain(partner);
    expect(message).toHaveBeenCalledWith(
      i18next.t("battle:soulBondFaint", {
        pokemonName: partner.getNameToRender(),
        partnerName: source.getNameToRender(),
      }),
    );
    expect(push.mock.calls.filter(call => call[0] === "SwitchPhase").map(call => call[2])).toEqual([0]);
    expect(game.scene.phaseManager.hasPhaseOfType("VictoryPhase")).toBe(false);
  });

  it.each([false, true])("allows the source's seed to prevent propagation (partner on field: %s)", async onField => {
    const { source, partner } = await setup(onField);
    giveItem(source, "REVIVER_SEED");
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expect(source.hp).toBeGreaterThan(0);
    expect(partner.hp).toBe(partner.getMaxHp());
    expectFaints();
    expect(source.getHeldItems().some(item => item instanceof PokemonInstantReviveModifier)).toBe(false);
  });

  it("checks the source's Shiny Badge before its seed and the bond", async () => {
    const { source, partner } = await setup();
    giveItem(source, "SHINY_BADGE");
    const seed = giveItem(source, "REVIVER_SEED");
    source.friendship = 255;
    vi.spyOn(source, "randBattleSeedInt").mockReturnValue(0);
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expect(source.hp).toBeGreaterThan(0);
    expect(source.getHeldItems()).toContain(seed);
    expect(partner.hp).toBe(partner.getMaxHp());
    expectFaints();
  });

  it.each([false, true])("allows the partner's own seed, with no recursion (on field: %s)", async onField => {
    const { source, partner } = await setup(onField, false);
    giveItem(partner, "REVIVER_SEED");
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expectFaints(source);
    expect(source.isFainted(true)).toBe(true);
    expect(partner.hp).toBe(toDmgValue(partner.getMaxHp() / 2));
    expect(partner.status).toBeNull();
    expect(partner.isOnField()).toBe(onField);
    expect(partner.getHeldItems().some(item => item instanceof PokemonInstantReviveModifier)).toBe(false);
    expect(queue.mock.calls.some(call => call[0] === "GameOverPhase")).toBe(false);
  });

  it.each([false, true])("allows the partner's badge before consuming its seed (on field: %s)", async onField => {
    const { source, partner } = await setup(onField);
    giveItem(partner, "SHINY_BADGE");
    const seed = giveItem(partner, "REVIVER_SEED");
    partner.friendship = 255;
    vi.spyOn(partner, "randBattleSeedInt").mockReturnValue(0);
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expectFaints(source);
    expect(partner.hp).toBe(toDmgValue(partner.getMaxHp() / 2));
    expect(partner.getHeldItems()).toContain(seed);
  });

  it("falls back to the benched partner's seed after a failed badge roll", async () => {
    const { source, partner } = await setup();
    giveItem(partner, "SHINY_BADGE");
    giveItem(partner, "REVIVER_SEED");
    partner.friendship = 255;
    vi.spyOn(partner, "randBattleSeedInt").mockReturnValue(99);
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expectFaints(source);
    expect(partner.hp).toBeGreaterThan(0);
    expect(partner.getHeldItems().some(item => item instanceof PokemonInstantReviveModifier)).toBe(false);
  });

  it("does not inherit the source's residual-damage revival prohibition", async () => {
    const { source, partner } = await setup();
    giveItem(source, "REVIVER_SEED");
    giveItem(partner, "REVIVER_SEED");
    source.hp = 0;
    await resolve([new FaintPhase(source, true)]);
    expectFaints(source);
    expect(source.getHeldItems().some(item => item instanceof PokemonInstantReviveModifier)).toBe(true);
    expect(partner.hp).toBeGreaterThan(0);
  });

  it.each(["source", "partner"] as const)("captures %s suppression before resetSummonData", async suppressed => {
    const { source, partner } = await setup();
    const pokemon = suppressed === "source" ? source : partner;
    pokemon.addTag(BattlerTagType.EMBARGO, 5);
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expectFaints(source);
    expect(partner.hp).toBeGreaterThan(0);
  });

  it("settles simultaneous KOs before deciding defeat and preserves the queued revival policy", async () => {
    const { source, partner } = await setup(true, false);
    giveItem(partner, "REVIVER_SEED");
    source.hp = 0;
    partner.hp = 0;
    await resolve([new FaintPhase(source), new FaintPhase(partner)]);
    expectFaints(source);
    expect(partner.hp).toBeGreaterThan(0);
    expect(game.scene.phaseManager.hasPhaseOfType("GameOverPhase")).toBe(false);
  });

  it("does not turn a simultaneous residual KO into a seed-eligible forced KO", async () => {
    const { source, partner } = await setup(true, false);
    const seed = giveItem(partner, "REVIVER_SEED");
    source.hp = 0;
    partner.hp = 0;
    await resolve([new FaintPhase(source), new FaintPhase(partner, true)], "GameOverPhase");
    expectFaints(source, partner);
    expect(partner.getHeldItems()).toContain(seed);
    expect(source.isFainted(true)).toBe(true);
    expect(partner.isFainted(true)).toBe(true);
  });

  it.each([false, true])("fully commits both faints before game over (partner on field: %s)", async onField => {
    const { source, partner } = await setup(onField, false);
    source.hp = 0;
    await resolve([new FaintPhase(source)], "GameOverPhase");
    expectFaints(source, partner);
    expect(source.isFainted(true)).toBe(true);
    expect(partner.isFainted(true)).toBe(true);
    expect(game.scene.currentBattle.playerParticipantIds.size).toBe(0);
  });

  it("ignores duplicate queued faints but permits a new KO after a later revival", async () => {
    const { source, partner } = await setup();
    source.hp = 0;
    await resolve([new FaintPhase(source), new FaintPhase(source), new FaintPhase(partner)]);
    expectFaints(source, partner);
    for (const pokemon of [source, partner]) {
      pokemon.resetStatus(true, false, false, false);
      pokemon.hp = pokemon.getMaxHp();
    }
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expectFaints(source, partner, source, partner);
  });

  it("queues only one Eon Flute rescue when the bonded pair exhausts its owner's party", async () => {
    const { source, partner } = await setup(true, false);
    vi.spyOn(game.scene, "hasEonFluteProtection").mockReturnValue(true);
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expectFaints(source, partner);
    expect(push.mock.calls.filter(call => call[0] === "EonFluteSummonPhase")).toHaveLength(1);
  });

  it("cancels a phase-one boss faint and still commits its later final-form KO once", async () => {
    game.override.enemySpecies(SpeciesId.ETERNATUS);
    await setup();
    const enemy = game.scene.getEnemyParty()[0];
    vi.spyOn(game.scene.currentBattle, "isClassicFinalBoss", "get").mockReturnValue(true);
    enemy.formIndex = 0;
    enemy.hp = 0;
    await resolve([new FaintPhase(enemy)], "DamageAnimPhase");
    expect(enemy.hp).toBe(1);
    expect(enemy.isFainted(true)).toBe(false);
    expect(game.scene.currentBattle.enemyFaints).toBe(0);
    expect(game.scene.phaseManager.hasPhaseOfType("VictoryPhase")).toBe(false);

    enemy.formIndex = 1;
    enemy.hp = 0;
    await resolve([new FaintPhase(enemy), new FaintPhase(enemy)], "VictoryPhase");
    expect(enemy.isFainted(true)).toBe(true);
    expect(game.scene.currentBattle.enemyFaints).toBe(1);
    expect(game.scene.currentBattle.enemyFaintsHistory.map(entry => entry.pokemon)).toEqual([enemy]);
  });

  it("records both real KOs for Great Haunt, including a reserve", async () => {
    const { source, partner } = await setup();
    game.scene.currentBattle.greatHauntState = { stage: "ghost", fallen: [], forcedFaintIds: [] };
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expect(game.scene.currentBattle.greatHauntState.fallen.map(p => p.id)).toEqual([source.id, partner.id]);
    expectFaints(source, partner);
  });

  it("does not propagate from an already completed faint or revive a dead partner", async () => {
    const { source, partner } = await setup();
    partner.hp = 0;
    partner.doSetStatus(StatusEffect.FAINT);
    const seed = giveItem(partner, "REVIVER_SEED");
    source.hp = 0;
    await resolve([new FaintPhase(source), new FaintPhase(source)]);
    expectFaints(source);
    expect(partner.getHeldItems()).toContain(seed);
  });

  it("accepts a bench object even when its numeric ID aliases a battler slot", async () => {
    const { source, partner } = await setup();
    game.scene.getPlayerModifiers(0).forEach(item => {
      if (item instanceof DestinyKnotModifier && item.pokemonId === partner.id) {
        item.pokemonId = 0;
      }
    });
    partner.id = 0;
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expectFaints(source, partner);
    expect(partner.isFainted(true)).toBe(true);
  });

  it("pins the intended Pokemon instead of fainting a later occupant of its slot", async () => {
    const { source, partner } = await setup();
    const phase = new FaintPhase(source.getBattlerIndex());
    const party = game.scene.getPlayerParty();
    [party[0], party[2]] = [party[2], party[0]];
    source.leaveField();
    source.hp = 0;
    await resolve([phase]);
    expectFaints(source, partner);
    expect(party[0].hp).toBeGreaterThan(0);
  });

  it("resolves a real residual KO and its bench partner before the end-turn sibling", async () => {
    const { source, partner } = await setup();
    giveItem(partner, "REVIVER_SEED");
    const manager = game.scene.phaseManager;
    manager.clearAllPhases();
    source.hp = 1;
    source.damageAndUpdate(1, { result: HitResult.INDIRECT });
    manager.pushNew("TurnEndPhase");
    manager.shiftPhase();
    await game.phaseInterceptor.to("TurnEndPhase", false);
    expectFaints(source);
    expect(partner.hp).toBeGreaterThan(0);
    expect(source.isFainted(true)).toBe(true);
  });

  it("finishes TurnEndPhase damage and bond revival before the SoulBondPhase sibling", async () => {
    const { source, partner } = await setup();
    giveItem(source, "STICKY_BARBS");
    giveItem(partner, "REVIVER_SEED");
    source.hp = 1;
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SoulBondPhase", false);
    expectFaints(source);
    expect(source.isFainted(true)).toBe(true);
    expect(partner.hp).toBeGreaterThan(0);
    expect(game.scene.phaseManager.hasPhaseOfType("FaintPhase")).toBe(false);
  });

  it("revives a different owner's reserve using its own items, not the active player's", async () => {
    const { source, partner } = await setup();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const party = game.scene.getPlayerParty(0);
    party.splice(party.indexOf(partner), 1);
    for (const owner of [1, 2] as const) {
      const lead = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 50);
      game.scene.getPlayerParty(owner).push(lead);
    }
    game.scene.getPlayerParty(2).push(partner);
    const modifiers = game.scene.getPlayerModifiers(0);
    const knotIndex = modifiers.findIndex(m => m instanceof DestinyKnotModifier && m.pokemonId === partner.id);
    game.scene.getPlayerModifiers(2).push(modifiers.splice(knotIndex, 1)[0]);
    giveItem(partner, "REVIVER_SEED");
    game.scene.setActivePlayerIndex(1);
    expect(getSoulBondPartner(source)).toBe(partner);
    source.hp = 0;
    await resolve([new FaintPhase(source)]);
    expectFaints(source);
    expect(partner.hp).toBeGreaterThan(0);
    expect(partner.getHeldItems().some(item => item instanceof PokemonInstantReviveModifier)).toBe(false);
    expect(game.scene.getPlayerParty(1)[0].hp).toBeGreaterThan(0);
  });
});
