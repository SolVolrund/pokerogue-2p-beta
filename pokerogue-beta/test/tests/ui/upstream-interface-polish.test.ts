import { EvolutionItem } from "#balance/pokemon-evolutions";
import { modifierTypes } from "#data/data-lists";
import { getPokeballAtlasKey, getPokeballName } from "#data/pokeball";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { EvolutionItemModifierType, FormChangeItemModifierType } from "#modifiers/modifier-type";
import { CommandPhase } from "#phases/command-phase";
import { PrivateFightPhase, PrivatePauseMenuPhase } from "#phases/private-fight-phase";
import type { EggGachaUiHandler } from "#ui/egg-gacha-ui-handler";
import { GameDataType } from "#enums/game-data-type";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import type { BallUiHandler } from "#ui/ball-ui-handler";
import type { CommandUiHandler } from "#ui/command-ui-handler";
import type { MenuUiHandler } from "#ui/menu-ui-handler";
import { PartyOption, type PartyUiHandler } from "#ui/party-ui-handler";
import { type SummaryUiHandler, SummaryUiMode } from "#ui/summary-ui-handler";
import { getBBCodeFrag } from "#ui/text";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("UI - Upstream interface polish", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let balls: BallUiHandler;
  let party: PartyUiHandler;
  let menu: MenuUiHandler;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .moveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.EEVEE, SpeciesId.CHARMANDER);
    balls = game.scene.ui.handlers[UiMode.BALL] as BallUiHandler;
    party = game.scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
    menu = game.scene.ui.handlers[UiMode.MENU] as MenuUiHandler;
    await game.scene.ui.setMode(UiMode.OPTION_SELECT, { options: [{ label: "Cancel", handler: () => true }] });
  });

  afterEach(() => {
    balls.clear();
    if (party["optionsMode"]) {
      party.clearOptions();
    }
    party.clear();
    game.scene.ui.resetModeChain();
    game.scene.configureTwoPlayerMode(false);
    game.scene.activePlayerIndex = 0;
    game.scene.inputOwner = "none";
  });

  const ballTypes = [
    PokeballType.POKEBALL,
    PokeballType.GREAT_BALL,
    PokeballType.ULTRA_BALL,
    PokeballType.ROGUE_BALL,
    PokeballType.MASTER_BALL,
    PokeballType.CLONE_BALL,
  ];

  function openBalls(fieldIndex = 0) {
    const command = new CommandPhase(fieldIndex);
    vi.spyOn(game.scene.phaseManager, "getCurrentPhase").mockReturnValue(command);
    balls.show([]);
    return command;
  }

  it("shows icons for the actual ball keys, including Clone but not event-only Safari balls", () => {
    const image = vi.spyOn(game.scene.add, "image");
    balls["pokeballTypes"] = [];
    openBalls();
    expect(balls["pokeballTypes"]).toEqual(ballTypes);
    expect(balls["pokeballImages"]).toHaveLength(6);
    expect(balls["optionsText"].text.split("\n")).toEqual(ballTypes.slice(0, 4).map(getPokeballName));
    expect(balls["pokeballImages"].filter(image => image.visible)).toHaveLength(4);
    for (const type of ballTypes) {
      expect(image).toHaveBeenCalledWith(0, 0, "pb", getPokeballAtlasKey(type));
    }
    expect(image).not.toHaveBeenCalledWith(0, 0, "pb", getPokeballAtlasKey(PokeballType.SAFARI_BALL));
  });

  it("displays the command owner's inventory in multiplayer", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.getPlayerPokeballCounts(0)[PokeballType.CLONE_BALL] = 1;
    game.scene.getPlayerPokeballCounts(2)[PokeballType.CLONE_BALL] = 7;
    openBalls(2);
    balls.setCursor(5);
    expect(balls["countsText"].text.split("\n")[3]).toBe("\u00d77");
  });

  it("labels the battle command Bag while keeping the Ball pocket", () => {
    const commands = game.scene.ui.handlers[UiMode.COMMAND] as CommandUiHandler;
    expect(commands["commandTexts"].get(Command.BALL)?.text).toBe(i18next.t("commandUiHandler:bag"));
    openBalls();
    expect(balls["pocketText"].text).toBe(i18next.t("commandUiHandler:ball"));
  });

  it("scrolls the ball list with a fixed Cancel row", () => {
    openBalls();
    balls.setCursor(0);
    const cancelY = balls["cancelText"].y;
    for (let i = 0; i < 5; i++) {
      balls.processInput(Button.DOWN);
    }
    expect(balls["scrollOffset"]).toBe(2);
    expect(balls["optionsText"].text.split("\n")).toEqual(ballTypes.slice(2).map(getPokeballName));
    expect(balls["pokeballImages"].map(image => image.visible)).toEqual([false, false, true, true, true, true]);
    expect(balls["scrollBar"].visible).toBe(true);
    balls.processInput(Button.DOWN);
    expect(balls["cancelText"].y).toBe(cancelY);
    expect(balls["pokeballWiggleTween"]).toBeNull();
    balls.processInput(Button.DOWN);
    expect(balls["scrollOffset"]).toBe(0);
  });

  it("switches to an empty Medicine pocket and remembers the selected ball", () => {
    openBalls();
    balls.setCursor(5);
    const emptyVisible = vi.spyOn(balls["emptyText"], "setVisible");
    const optionsVisible = vi.spyOn(balls["optionsText"], "setVisible");
    const countsVisible = vi.spyOn(balls["countsText"], "setVisible");
    const context = balls.getTwoPlayerInputContextState();
    expect(balls.processInput(Button.RIGHT)).toBe(true);
    expect(balls["pocketText"].text).toBe(i18next.t("commandUiHandler:medicine"));
    expect(emptyVisible).toHaveBeenLastCalledWith(true);
    expect(optionsVisible).toHaveBeenLastCalledWith(false);
    expect(countsVisible).toHaveBeenLastCalledWith(false);
    expect(balls["scrollBar"].visible).toBe(false);
    expect(balls["pokeballImages"].some(image => image.visible)).toBe(false);
    expect(balls["pokeballWiggleTween"]).toBeNull();
    expect(balls.getTwoPlayerInputContextState()).not.toEqual(context);
    balls.processInput(Button.UP);
    balls.processInput(Button.DOWN);
    expect(balls.getCursor()).toBe(0);
    expect(balls.processInput(Button.LEFT)).toBe(true);
    expect(balls.getCursor()).toBe(5);
    expect(balls.getTwoPlayerInputContextState()).toEqual(context);
  });

  it.each([Button.ACTION, Button.CANCEL])("leaves Medicine without queuing a ball command (%s)", button => {
    const command = openBalls();
    const handle = vi.spyOn(command, "handleCommand");
    const setMode = vi.spyOn(game.scene.ui, "setMode");
    const inventory = { ...game.scene.pokeballCounts };
    balls.processInput(Button.RIGHT);
    balls.processInput(button);
    expect(handle).not.toHaveBeenCalled();
    expect(setMode).toHaveBeenCalledWith(UiMode.COMMAND, 0);
    expect(game.scene.pokeballCounts).toEqual(inventory);
  });

  it("reopens on Ball after leaving Medicine", () => {
    openBalls();
    balls.setCursor(5);
    balls.processInput(Button.LEFT);
    balls.clear();
    openBalls();
    expect(balls["pocket"]).toBe("ball");
    expect(balls.getCursor()).toBe(5);
    expect(balls["scrollOffset"]).toBe(2);
  });

  it("keeps optional Glass Balls selectable and clamps a removed last row", () => {
    game.scene.pokeballCounts[PokeballType.GLASS_BALL] = 3;
    const command = openBalls();
    const handle = vi.spyOn(command, "handleCommand").mockReturnValue(false);
    balls.setCursor(5);
    balls.processInput(Button.ACTION);
    expect(handle).toHaveBeenCalledWith(Command.BALL, PokeballType.GLASS_BALL);
    balls.setCursor(7);
    balls.clear();
    delete game.scene.pokeballCounts[PokeballType.GLASS_BALL];
    openBalls();
    expect(balls.getCursor()).toBe(6);
    expect(balls["scrollOffset"]).toBeLessThanOrEqual(2);
  });

  it("confirms the non-contiguous Clone Ball enum instead of the row number", () => {
    game.scene.pokeballCounts[PokeballType.CLONE_BALL] = 1;
    const command = openBalls();
    const handle = vi.spyOn(command, "handleCommand").mockReturnValue(false);
    balls.setCursor(5);
    balls.processInput(Button.ACTION);
    expect(handle).toHaveBeenCalledWith(Command.BALL, PokeballType.CLONE_BALL);
  });

  it("rejects an empty ball row and wraps through Cancel", () => {
    const command = openBalls();
    game.scene.pokeballCounts[PokeballType.CLONE_BALL] = 0;
    const handle = vi.spyOn(command, "handleCommand");
    const error = vi.spyOn(game.scene.ui, "playError");
    balls.setCursor(5);
    balls.processInput(Button.ACTION);
    expect(handle).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    balls.processInput(Button.DOWN);
    expect(balls.getCursor()).toBe(6);
    balls.processInput(Button.DOWN);
    expect(balls.getCursor()).toBe(0);
    balls.processInput(Button.UP);
    expect(balls.getCursor()).toBe(6);
  });

  it("stops the selected icon animation on Cancel and when leaving the menu", () => {
    const stopped = vi.fn();
    const destroyed = vi.fn();
    balls.setCursor(0);
    const chain = vi.spyOn(game.scene.tweens, "chain").mockImplementation(config => {
      return {
        stop() {
          stopped();
          (config as { onStop?: () => void }).onStop?.();
          return this;
        },
        destroy: destroyed,
      } as unknown as Phaser.Tweens.TweenChain;
    });
    openBalls();
    expect(chain).toHaveBeenLastCalledWith(expect.objectContaining({ targets: balls["pokeballImages"][0] }));
    balls.setCursor(6);
    expect(stopped).toHaveBeenCalledOnce();
    expect(destroyed).toHaveBeenCalledOnce();
    expect(balls["pokeballWiggleTween"]).toBeNull();
    balls.setCursor(5);
    balls.clear();
    expect(stopped).toHaveBeenCalledTimes(2);
    expect(destroyed).toHaveBeenCalledTimes(2);
  });

  it("does not animate a private selection for an enemy-player observer", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    game.scene.twoPlayerEnemyPlayerMode = true;
    game.scene.twoPlayerLocalInputSeat = "ep";
    game.scene.inputOwner = 0;
    const chain = vi.spyOn(game.scene.tweens, "chain");
    openBalls();
    const optionsVisible = vi.spyOn(balls["optionsText"], "setVisible");
    const visible = balls["optionsText"].text;
    balls.setCursor(5);
    expect(balls["optionsText"].text).toBe(visible);
    balls.processInput(Button.RIGHT);
    expect(balls["pocketText"].text).toBe(i18next.t("commandUiHandler:ball"));
    expect(optionsVisible).toHaveBeenLastCalledWith(true);
    expect(balls["cursorObj"]?.visible).toBe(false);
    expect(chain).not.toHaveBeenCalled();
  });

  async function openItem(mode: PartyUiMode, type: EvolutionItemModifierType | FormChangeItemModifierType) {
    await game.scene.ui.setMode(UiMode.PARTY, mode, 0, vi.fn(), type.selectFilter);
  }

  function labels() {
    return party["partySlots"].map(slot => slot.slotDescriptionLabel.text);
  }

  it("shows Able/Not Able for evolution stones and retains the Apply action", async () => {
    await openItem(PartyUiMode.EVO_ITEM_MODIFIER, new EvolutionItemModifierType(EvolutionItem.FIRE_STONE));
    expect(labels()).toEqual([i18next.t("partyUiHandler:able"), i18next.t("partyUiHandler:notAble")]);
    party.showOptions();
    expect(party["options"]).toContain(PartyOption.APPLY);
  });

  it("recognizes an evolution item for the fusion half", async () => {
    const pokemon = game.scene.getPlayerParty()[1];
    pokemon.fusionSpecies = getPokemonSpecies(SpeciesId.EEVEE);
    pokemon.fusionFormIndex = 0;
    const type = new EvolutionItemModifierType(EvolutionItem.FIRE_STONE);
    expect(type.selectFilter!(pokemon)).toBeNull();
    await openItem(PartyUiMode.EVO_ITEM_MODIFIER, type);
    expect(labels()).toEqual([i18next.t("partyUiHandler:able"), i18next.t("partyUiHandler:able")]);
  });

  it("recognizes form items for the fusion half without replacing our eligibility rules", async () => {
    const pokemon = game.scene.getPlayerParty()[1];
    pokemon.fusionSpecies = getPokemonSpecies(SpeciesId.CHARIZARD);
    pokemon.fusionFormIndex = 0;
    const type = new FormChangeItemModifierType(FormChangeItem.CHARIZARDITE_X);
    expect(type.selectFilter!(pokemon)).toBeNull();
    await openItem(PartyUiMode.FORM_CHANGE_ITEM_MODIFIER, type);
    expect(labels()).toEqual([i18next.t("partyUiHandler:notAble"), i18next.t("partyUiHandler:able")]);
  });

  it.each([true, false])("respects the custom Legend Plate ability condition (%s)", async multitype => {
    const pokemon = game.scene.getPlayerParty()[1];
    pokemon.fusionSpecies = getPokemonSpecies(SpeciesId.ARCEUS);
    pokemon.fusionFormIndex = 0;
    vi.spyOn(pokemon, "hasAbility").mockImplementation(ability => ability === AbilityId.MULTITYPE && multitype);
    await openItem(PartyUiMode.FORM_CHANGE_ITEM_MODIFIER, new FormChangeItemModifierType(FormChangeItem.LEGEND_PLATE));
    expect(labels()[1]).toBe(i18next.t(multitype ? "partyUiHandler:able" : "partyUiHandler:notAble"));
  });

  it.each(["evolution", "form"])("routes %s rewards to compatibility mode with the original filter", kind => {
    const type =
      kind === "evolution"
        ? new EvolutionItemModifierType(EvolutionItem.FIRE_STONE)
        : new FormChangeItemModifierType(FormChangeItem.CHARIZARDITE_X);
    const mode = kind === "evolution" ? PartyUiMode.EVO_ITEM_MODIFIER : PartyUiMode.FORM_CHANGE_ITEM_MODIFIER;
    const setMode = vi.spyOn(game.scene.ui, "setModeWithoutClear").mockResolvedValue(undefined);
    new SelectModifierPhase()["openModifierMenu"](type, 0, () => true);
    expect(setMode).toHaveBeenCalledWith(
      UiMode.PARTY,
      mode,
      0,
      expect.any(Function),
      type.selectFilter,
      undefined,
      undefined,
      false,
      undefined,
    );
    expect(mode).not.toBe(PartyUiMode.ENEMY_SWITCH);
    expect(PartyUiMode.ENEMY_SWITCH).toBe(14);
  });

  it("leaves ordinary party checks on their HP display", async () => {
    await game.scene.ui.setMode(UiMode.PARTY, PartyUiMode.CHECK, 0, vi.fn());
    expect(labels()).toEqual(["", ""]);
  });

  it.each([1, 2])("discards a private submenu on slot %i before shared reward targeting", async privateSlot => {
    const scene = game.scene;
    scene.configureTwoPlayerMode(true, 6, false, 2);
    for (const species of [SpeciesId.EEVEE, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE]) {
      scene.getPlayerParty(1).push(scene.addPlayerPokemon(getPokemonSpecies(species), 20));
    }
    const current = vi.spyOn(scene.phaseManager, "getCurrentPhase").mockReturnValue(new PrivateFightPhase(new Map()));
    const abandoned = vi.fn();
    party["lastRightPokemonCursor"] = 2;
    await scene.ui.setMode(UiMode.PARTY, PartyUiMode.MODIFIER, 1, abandoned);
    expect(party["lastRightPokemonCursor"]).toBe(0);
    party.setCursor(privateSlot);
    party.showOptions();
    expect(party["optionsMode"]).toBe(true);
    await scene.ui.dismissPrivateDraft();
    expect(party["optionsMode"]).toBe(false);
    expect(party["options"]).toHaveLength(0);
    expect(party["selectCallback"]).toBeNull();
    expect(party["lastRightPokemonCursor"]).toBe(2);

    current.mockReturnValue(new SelectModifierPhase());
    const apply = vi.fn();
    await scene.ui.setMode(UiMode.PARTY, PartyUiMode.MODIFIER, 1, apply);
    expect(party.getCursor()).toBe(0);
    expect(party.processInput(Button.RIGHT)).toBe(true);
    expect(party.getCursor()).toBe(1);
    party.processInput(Button.ACTION);
    party.processInput(Button.ACTION);
    expect(apply).toHaveBeenCalledWith(1, PartyOption.APPLY);
    expect(abandoned).not.toHaveBeenCalled();
  });

  it("keeps the current highlight for a missing slot and uses an existing reserve on Right", async () => {
    await game.scene.ui.setMode(UiMode.PARTY, PartyUiMode.MODIFIER, 0, vi.fn());
    party["lastRightPokemonCursor"] = 4;
    const deselect = vi.spyOn(party["partySlots"][0], "deselect");
    expect(party.setCursor(4)).toBe(false);
    expect(deselect).not.toHaveBeenCalled();
    expect(party.getCursor()).toBe(0);
    expect(party.processInput(Button.RIGHT)).toBe(true);
    expect(party.getCursor()).toBe(1);
  });

  it("keeps item eligibility and confirmation on the second player's party", async () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const eevee = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20);
    const charmander = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARMANDER), 20);
    game.scene.getPlayerParty(1).push(eevee, charmander);
    const type = new EvolutionItemModifierType(EvolutionItem.FIRE_STONE);
    const confirm = vi.fn();
    await game.scene.ui.setMode(UiMode.PARTY, PartyUiMode.EVO_ITEM_MODIFIER, 1, confirm, type.selectFilter);
    expect(party["partySlots"].map(slot => slot.getPokemon())).toEqual([eevee, charmander]);
    expect(labels()).toEqual([i18next.t("partyUiHandler:able"), i18next.t("partyUiHandler:notAble")]);
    expect(game.scene.inputOwner).toBe(1);
    party.setCursor(1);
    party.showOptions();
    party["processActionButtonForOptions"](PartyOption.APPLY);
    expect(confirm).not.toHaveBeenCalled();
    party.setCursor(0);
    party.showOptions();
    party["processActionButtonForOptions"](PartyOption.APPLY);
    expect(confirm).toHaveBeenCalledWith(0, PartyOption.APPLY);
  });

  it("allows cancelling an evolution item without applying it", async () => {
    const confirm = vi.fn();
    const type = new EvolutionItemModifierType(EvolutionItem.FIRE_STONE);
    await game.scene.ui.setMode(UiMode.PARTY, PartyUiMode.EVO_ITEM_MODIFIER, 0, confirm, type.selectFilter);
    party.processInput(Button.CANCEL);
    expect(confirm).toHaveBeenCalledWith(6, PartyOption.CANCEL);
  });

  function renderMenu(reward = true) {
    vi.spyOn(game.scene.phaseManager, "getCurrentPhase").mockReturnValue(
      reward ? new SelectModifierPhase() : new CommandPhase(0),
    );
    menu.render();
  }

  it("keeps gacha visible but grey and blocked during rewards, while egg viewing remains available", () => {
    renderMenu();
    const text = menu["optionSelectText"].text;
    expect(text).toContain(getBBCodeFrag(i18next.t("menuUiHandler:eggGacha"), TextStyle.SUMMARY_GRAY));
    expect(text).toContain(getBBCodeFrag(i18next.t("menuUiHandler:eggList"), TextStyle.WINDOW));
    const overlay = vi.spyOn(game.scene.ui, "setOverlayMode");
    const error = vi.spyOn(game.scene.ui, "playError");
    menu.setCursor(menu["menuOptions"].indexOf(4));
    menu.processInput(Button.ACTION);
    expect(overlay).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });

  it("still opens gacha outside the reward phase", () => {
    renderMenu(false);
    const overlay = vi.spyOn(game.scene.ui, "setOverlayMode").mockResolvedValue(undefined);
    vi.spyOn(game.scene.ui, "revertMode").mockResolvedValue(true);
    menu.setCursor(menu["menuOptions"].indexOf(4));
    menu.processInput(Button.ACTION);
    expect(overlay).toHaveBeenCalledWith(UiMode.EGG_GACHA);
  });

  it.each([0, 1] as const)("uses P2's collection in a shared pause and keeps file and browser actions local (seat %i)", seat => {
    const scene = game.scene;
    scene.configureTwoPlayerMode(true, 6, false, 2);
    scene.twoPlayerLocalInputSeat = seat;
    const clock = Date.UTC(2026, 9, 31, 23, 59);
    const pause = new PrivatePauseMenuPhase(1, new Map(), 1, clock);
    vi.spyOn(scene.phaseManager, "getCurrentPhase").mockReturnValue(pause);
    scene.waitForPlayerInput(1);
    menu.render();
    const overlay = vi.spyOn(scene.ui, "setOverlayMode").mockResolvedValue();
    const revert = vi.spyOn(scene.ui, "revertMode").mockResolvedValue(true);
    const choose = (id: number) => {
      const index = menu["menuOptions"].findIndex(option => option === id);
      expect(index).toBeGreaterThanOrEqual(0);
      menu.setCursor(index);
      menu.processInput(Button.ACTION);
    };
    const gacha = scene.ui.handlers[UiMode.EGG_GACHA] as EggGachaUiHandler;
    const before = [scene.getPlayerGameData(0).eggs.length, scene.getPlayerGameData(1).eggs.length];
    choose(4);
    expect(overlay).toHaveBeenLastCalledWith(UiMode.EGG_GACHA);
    const [egg] = gacha["pullEggs"](1);
    expect(egg.timestamp).toBe(clock);
    expect(scene.getPlayerGameData(0).eggs.length).toBe(before[0]);
    expect(scene.getPlayerGameData(1).eggs.length).toBe(before[1] + 1);
    choose(3);
    expect(overlay).toHaveBeenLastCalledWith(UiMode.EGG_LIST);
    choose(5);
    expect(overlay).toHaveBeenLastCalledWith(UiMode.POKEDEX);
    expect(revert).not.toHaveBeenCalled();
    const download = vi.spyOn(scene.gameData, "tryExportData").mockResolvedValue(true);
    choose(6);
    const exports = overlay.mock.lastCall![1].options;
    expect(exports.map(o => o.label)).toEqual(["exportSession", "exportRunHistory", "exportData", "cancel"]
      .map(key => i18next.t("menuUiHandler:" + key)));
    exports[2].handler();
    if (seat === 1) expect(download).toHaveBeenCalledWith(GameDataType.SYSTEM, 0);
    else expect(download).not.toHaveBeenCalled();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    choose(7);
    const links = overlay.mock.lastCall![1].options;
    expect(links.some(o => o.label === "Admin")).toBe(false);
    links[0].handler();
    expect(open).toHaveBeenCalledTimes(seat === 1 ? 1 : 0);
  });

  it("retains enemy-player menu restrictions", () => {
    game.scene.twoPlayerEnemyPlayerMode = true;
    game.scene.twoPlayerLocalInputSeat = "ep";
    renderMenu();
    expect(menu["menuOptions"]).not.toContain(3);
    expect(menu["menuOptions"]).not.toContain(4);
    expect(menu["menuOptions"]).toContain(9);
  });

  it("renders the pause owner's menu on both sides of an EP lobby", () => {
    const scene = game.scene;
    scene.configureTwoPlayerMode(true, 6, false, 1, undefined, false, true);
    for (const owner of [0, "ep"] as const) {
      const pause = new PrivatePauseMenuPhase(owner, new Map(), 1, 0);
      vi.spyOn(scene.phaseManager, "getCurrentPhase").mockReturnValue(pause);
      scene.setInputOwner(owner);
      for (const seat of [0, "ep"] as const) {
        scene.twoPlayerLocalInputSeat = seat;
        menu.render();
        expect(menu["menuOptions"].includes(9)).toBe(owner === "ep");
        expect(menu["menuOptions"].includes(4)).toBe(owner === 0);
      }
    }
  });

  it("layers held item icons below stats and still shows the inspected player's items", async () => {
    const pokemon = game.scene.getPlayerParty()[0];
    const heldItem = modifierTypes.LEFTOVERS().newModifier(pokemon);
    game.scene.getPlayerModifiers(0).push(heldItem);
    const icon = game.scene.add.container(0, 0);
    const getIcon = vi.spyOn(heldItem, "getIcon").mockReturnValue(icon);
    await game.scene.ui.setMode(UiMode.SUMMARY, pokemon, SummaryUiMode.DEFAULT, 1);
    const summary = game.scene.ui.getHandler<SummaryUiHandler>();
    const stats = summary["statsContainer"];
    const items = stats.list[0] as Phaser.GameObjects.Container;
    expect(items.list).toContain(icon);
    expect(stats.list.indexOf(summary["permStatsContainer"])).toBeGreaterThan(0);
    expect(stats.list.indexOf(summary["ivContainer"])).toBeGreaterThan(0);
    expect(stats.list.indexOf(summary["contestStatsContainer"])).toBeGreaterThan(0);
    expect(getIcon).toHaveBeenCalledWith(true);
  });
});
