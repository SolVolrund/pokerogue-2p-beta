import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import {
  ALPH_TILE_CHARACTERS,
  type AlphTileCharacter,
  type AlphTileCounts,
  type AlphWallConfig,
  addAlphTile,
  getAlphTileCount,
  getAlphTileDisplayCharacter,
  getAlphTileLookupKey,
  getAlphTileTextureKey,
  isFiniteAlphTileCharacter,
  normalizeAlphTileCharacter,
  removeAlphTile,
} from "#data/alph/alph-tiles";
import {
  ALPH_LEGENDARY_HELPER_CONFIGS,
  type AlphLegendaryHelperId,
} from "#data/alph/legendary-helpers";
import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { CustomPokemonData } from "#data/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { type PermanentStat, Stat } from "#enums/stat";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { PlayerPokemon } from "#field/pokemon";
import { LegendaryHelperModifier, UnownBoxModifier } from "#modifiers/modifier";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";

type AlphWallObjectType = "tile-selector" | "tile-count" | "character-input" | "menu-option";

interface AlphWallObject {
  type: AlphWallObjectType;
  character: AlphTileCharacter;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AlphWallInteractive extends AlphWallObject {
  index: number;
  image?: Phaser.GameObjects.Image;
  text?: Phaser.GameObjects.Text;
}

const WALL_SCALE = 1;
const WALL_X = 0;
const WALL_Y = -180;
const DENIED_ALPH_MOVE_IDS = new Set<MoveId>([MoveId.NONE]);
const DENIED_ALPH_ABILITY_IDS = new Set<AbilityId>([AbilityId.NONE, AbilityId.WONDER_GUARD]);
const ALPH_STAT_SPELLS: Partial<Record<string, { stat: PermanentStat; label: string }>> = {
  HEALTH: { stat: Stat.HP, label: "HP" },
  PHATK: { stat: Stat.ATK, label: "Attack" },
  PHDEF: { stat: Stat.DEF, label: "Defense" },
  SPATK: { stat: Stat.SPATK, label: "Sp. Atk" },
  SPDEF: { stat: Stat.SPDEF, label: "Sp. Def" },
  SPEED: { stat: Stat.SPD, label: "Speed" },
};
const ALPH_LEGENDARY_HELPER_SPELLS: Partial<Record<string, AlphLegendaryHelperId>> = {
  "PAPA!?": "papa",
  "MAMA!?": "mama",
  "UNCLE?": "uncle",
};
const SELECTOR_LAYOUT: [AlphTileCharacter, number, number, number, number][] = [
  ["A", 69, 8, 71, 22],
  ["B", 81, 8, 83, 22],
  ["C", 94, 8, 95, 22],
  ["D", 105, 8, 107, 22],
  ["E", 117, 8, 119, 22],
  ["F", 129, 8, 131, 22],
  ["G", 141, 8, 143, 22],
  ["H", 153, 8, 155, 22],
  ["I", 165, 8, 167, 22],
  ["J", 177, 8, 179, 22],
  ["K", 189, 8, 191, 22],
  ["L", 201, 8, 203, 22],
  ["M", 213, 8, 215, 22],
  ["N", 225, 8, 227, 22],
  ["O", 69, 32, 71, 46],
  ["P", 81, 32, 83, 46],
  ["Q", 93, 32, 95, 46],
  ["R", 105, 32, 107, 46],
  ["S", 117, 32, 119, 46],
  ["T", 129, 32, 131, 46],
  ["U", 141, 32, 143, 46],
  ["V", 153, 32, 155, 46],
  ["W", 165, 32, 167, 46],
  ["X", 177, 32, 179, 46],
  ["Y", 189, 32, 191, 46],
  ["Z", 201, 32, 203, 46],
  ["QuestionMark", 213, 32, 215, 46],
  ["Exclamation", 225, 32, 227, 46],
  ["hyphen", 237, 8, 239, 22],
  ["blank", 237, 32, 239, 46],
];
const WALL_OBJECTS: AlphWallObject[] = [
  ...SELECTOR_LAYOUT.flatMap(([character, tileX, tileY, countX, countY]) => [
    {
      type: "tile-selector" as const,
      character,
      label: `tile ${getAlphTileDisplayCharacter(character)}`,
      x: tileX,
      y: tileY,
      w: 11,
      h: 11,
    },
    {
      type: "tile-count" as const,
      character,
      label: `tile count ${getAlphTileDisplayCharacter(character)}`,
      x: countX,
      y: countY,
      w: 7,
      h: 7,
    },
  ]),
  ...Array.from({ length: 48 }, (_, index) => ({
    type: "character-input" as const,
    character: "blank" as const,
    label: `character input ${index + 1}`,
    x: 71 + (index % 16) * 11,
    y: 90 + Math.floor(index / 16) * 16,
    w: 11,
    h: 11,
  })),
  { type: "menu-option", character: "blank", label: "Exit", x: 182, y: 144, w: 29, h: 15 },
  { type: "menu-option", character: "blank", label: "Proceed", x: 212, y: 144, w: 38, h: 15 },
];

export class AlphWallUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private cursorObj: Phaser.GameObjects.Image;
  private selectedTileCursorObj: Phaser.GameObjects.Image;
  private interactives: AlphWallInteractive[] = [];
  private config: AlphWallConfig | undefined;
  private workingCounts: AlphTileCounts = {};
  private selectedTile: AlphTileCharacter | undefined;
  private selectedTileSourceCharacter: AlphTileCharacter | undefined;
  private inputCharacters: AlphTileCharacter[] = [];

  constructor() {
    super(UiMode.ALPH_WALL);
  }

  setup(): void {
    this.container = globalScene.add.container(WALL_X, WALL_Y).setScale(WALL_SCALE).setVisible(false);
    this.getUi().add(this.container);

    const wall = globalScene.add.image(0, 0, "alph_wall").setOrigin(0);
    this.selectedTileCursorObj = this.createSelectedTileCursor();
    this.cursorObj = globalScene.add.image(0, 0, "select_cursor").setOrigin(0).setScale(0.45);
    this.container.add([wall, this.selectedTileCursorObj, this.cursorObj]);
  }

  show(args: any[]): boolean {
    super.show(args);

    this.config = args[0] as AlphWallConfig;
    this.workingCounts = { ...globalScene.getPlayerAlphTiles(this.config.playerIndex) };
    this.inputCharacters = Array.from({ length: 48 }, () => "blank" as const);
    this.selectedTile = undefined;
    this.selectedTileSourceCharacter = undefined;
    this.cursor = 0;
    this.renderWall();
    this.container.setVisible(true);
    this.getUi().bringToTop(this.container);
    this.updateCursor();
    this.showSelectionText();
    return true;
  }

  processInput(button: Button): boolean {
    if (!this.config) {
      return false;
    }

    switch (button) {
      case Button.UP:
        return this.moveCursor(0, -1);
      case Button.DOWN:
        return this.moveCursor(0, 1);
      case Button.LEFT:
        return this.moveCursor(-1, 0);
      case Button.RIGHT:
        return this.moveCursor(1, 0);
      case Button.ACTION:
        return this.confirmSelection();
      case Button.CANCEL:
        return this.cancelSelection();
      default:
        return false;
    }
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.config = undefined;
    this.interactives = [];
    this.selectedTile = undefined;
    this.selectedTileSourceCharacter = undefined;
    this.container.removeAll(true);
    this.selectedTileCursorObj = this.createSelectedTileCursor();
    this.container.add([
      globalScene.add.image(0, 0, "alph_wall").setOrigin(0),
      this.selectedTileCursorObj,
      (this.cursorObj = globalScene.add.image(0, 0, "select_cursor").setOrigin(0).setScale(0.45)),
    ]);
  }

  private renderWall(): void {
    this.container.removeAll(true);
    this.interactives = [];
    this.container.add(globalScene.add.image(0, 0, "alph_wall").setOrigin(0));

    for (const object of WALL_OBJECTS) {
      this.addWallObject(object);
    }

    this.selectedTileCursorObj = this.createSelectedTileCursor();
    this.container.add(this.selectedTileCursorObj);
    this.container.add((this.cursorObj = globalScene.add.image(0, 0, "select_cursor").setOrigin(0).setScale(0.45)));
    this.updateSelectedTileCursor();
  }

  private addWallObject(object: AlphWallObject): void {
    const interactive: AlphWallInteractive = { ...object, index: this.interactives.length };

    if (object.type === "tile-selector") {
      const textureCharacter =
        isFiniteAlphTileCharacter(object.character) && getAlphTileCount(this.workingCounts, object.character) === 0
          ? "blank"
          : object.character;
      interactive.image = this.addTileImage(object, textureCharacter);
      this.interactives.push(interactive);
    } else if (object.type === "tile-count") {
      interactive.text = addTextObject(
        object.x + object.w / 2,
        object.y + object.h / 2,
        this.getCountText(object.character),
        TextStyle.WINDOW,
        { align: "center", fontSize: "32px" },
      ).setOrigin(0.5, 0.5);
      this.container.add(interactive.text);
    } else if (object.type === "character-input") {
      const inputIndex = this.interactives.filter(candidate => candidate.type === "character-input").length;
      interactive.character = this.inputCharacters[inputIndex] ?? "blank";
      interactive.image = this.addTileImage(object, interactive.character);
      this.interactives.push(interactive);
    } else {
      interactive.text = addTextObject(object.x + object.w / 2, object.y + 2, object.label, TextStyle.WINDOW, {
        align: "center",
        fontSize: "44px",
      }).setOrigin(0.5, 0);
      this.container.add(interactive.text);
      this.interactives.push(interactive);
    }
  }

  private addTileImage(object: AlphWallObject, character: AlphTileCharacter): Phaser.GameObjects.Image {
    const image = globalScene.add.image(object.x, object.y, getAlphTileTextureKey(character)).setOrigin(0);
    image.setDisplaySize(object.w, object.h);
    this.container.add(image);
    return image;
  }

  private getCountText(character: AlphTileCharacter): string {
    if (!isFiniteAlphTileCharacter(character)) {
      return "inf";
    }

    return String(getAlphTileCount(this.workingCounts, character));
  }

  private moveCursor(dx: number, dy: number): boolean {
    const current = this.interactives[this.cursor];
    if (!current) {
      return false;
    }

    const currentCenter = this.getCenter(current);
    const candidates = this.interactives
      .filter(candidate => candidate !== current)
      .map(candidate => {
        const center = this.getCenter(candidate);
        const deltaX = center.x - currentCenter.x;
        const deltaY = center.y - currentCenter.y;
        const inDirection = dx < 0 ? deltaX < -0.5 : dx > 0 ? deltaX > 0.5 : dy < 0 ? deltaY < -0.5 : deltaY > 0.5;
        const primary = dx === 0 ? Math.abs(deltaY) : Math.abs(deltaX);
        const secondary = dx === 0 ? Math.abs(deltaX) : Math.abs(deltaY);
        return { candidate, inDirection, score: primary + secondary * 4 };
      })
      .filter(candidate => candidate.inDirection)
      .sort((a, b) => a.score - b.score);

    if (candidates.length === 0) {
      return false;
    }

    this.cursor = candidates[0].candidate.index;
    this.updateCursor();
    this.showSelectionText();
    this.getUi().playSelect();
    return true;
  }

  private getCenter(object: AlphWallObject): { x: number; y: number } {
    return { x: object.x + object.w / 2, y: object.y + object.h / 2 };
  }

  private updateCursor(): void {
    const selected = this.interactives[this.cursor];
    if (!selected) {
      this.cursorObj.setVisible(false);
      return;
    }

    this.cursorObj.setVisible(true);
    this.cursorObj.setDisplaySize(selected.w + 8, selected.h + 8);
    this.cursorObj.setPosition(selected.x - 4, selected.y - 4);
  }

  private createSelectedTileCursor(): Phaser.GameObjects.Image {
    return globalScene.add.image(0, 0, "select_cursor_highlight").setOrigin(0).setVisible(false);
  }

  private updateSelectedTileCursor(): void {
    const selectedTileSource = this.findSelectedTileSource();
    if (!selectedTileSource) {
      this.selectedTileCursorObj.setVisible(false);
      return;
    }

    this.selectedTileCursorObj.setVisible(true);
    this.selectedTileCursorObj.setDisplaySize(selectedTileSource.w + 8, selectedTileSource.h + 8);
    this.selectedTileCursorObj.setPosition(selectedTileSource.x - 4, selectedTileSource.y - 4);
  }

  private findSelectedTileSource(): AlphWallInteractive | undefined {
    if (!this.selectedTileSourceCharacter) {
      return;
    }

    return this.interactives.find(
      object => object.type === "tile-selector" && object.character === this.selectedTileSourceCharacter,
    );
  }

  private confirmSelection(): boolean {
    const selected = this.interactives[this.cursor];
    if (!selected) {
      return false;
    }

    if (selected.type === "tile-selector") {
      return this.pickTile(selected.character);
    }
    if (selected.type === "character-input") {
      return this.placeSelectedTile(selected);
    }
    if (selected.label === "Exit") {
      this.close();
      return true;
    }
    if (selected.label === "Proceed") {
      this.proceed();
      return true;
    }

    return false;
  }

  private cancelSelection(): boolean {
    const selected = this.interactives[this.cursor];
    if (this.selectedTile) {
      this.selectedTile = undefined;
      this.selectedTileSourceCharacter = undefined;
      this.updateSelectedTileCursor();
      this.showSelectionText();
      return true;
    }

    if (selected?.type === "character-input" && selected.character !== "blank") {
      return this.clearInput(selected);
    }

    this.close();
    return true;
  }

  private pickTile(character: AlphTileCharacter): boolean {
    if (isFiniteAlphTileCharacter(character) && getAlphTileCount(this.workingCounts, character) === 0) {
      this.getUi().playError();
      return false;
    }

    this.selectedTile = normalizeAlphTileCharacter(character);
    this.selectedTileSourceCharacter = this.selectedTile;
    this.updateSelectedTileCursor();
    this.showSelectionText();
    return true;
  }

  private placeSelectedTile(selected: AlphWallInteractive): boolean {
    if (!this.selectedTile) {
      return this.clearInput(selected);
    }

    const inputIndex = this.getInputIndex(selected);
    if (inputIndex < 0) {
      return false;
    }

    const nextCharacter = this.selectedTile;
    if (nextCharacter === selected.character) {
      return false;
    }

    if (selected.character !== "blank") {
      addAlphTile(this.workingCounts, selected.character);
    }
    if (!removeAlphTile(this.workingCounts, nextCharacter)) {
      this.getUi().playError();
      return false;
    }

    selected.character = nextCharacter;
    this.inputCharacters[inputIndex] = nextCharacter;
    this.selectedTile = undefined;
    this.selectedTileSourceCharacter = undefined;
    this.renderWall();
    this.cursor = selected.index;
    this.updateCursor();
    this.showSelectionText();
    return true;
  }

  private clearInput(selected: AlphWallInteractive): boolean {
    const inputIndex = this.getInputIndex(selected);
    if (inputIndex < 0 || selected.character === "blank") {
      return false;
    }

    addAlphTile(this.workingCounts, selected.character);
    this.inputCharacters[inputIndex] = "blank";
    selected.character = "blank";
    this.renderWall();
    this.cursor = selected.index;
    this.updateCursor();
    this.showSelectionText();
    return true;
  }

  private getInputIndex(selected: AlphWallInteractive): number {
    return this.interactives
      .filter(candidate => candidate.type === "character-input")
      .findIndex(candidate => candidate.index === selected.index);
  }

  private proceed(): void {
    const word = getAlphTileLookupKey(this.inputCharacters);
    const displayWord = this.inputCharacters
      .map(character => getAlphTileDisplayCharacter(character))
      .join("")
      .trim();
    const unown = this.getUnownBoxHolder();

    if (!word) {
      globalScene.ui.showText("The wall is blank.", null, () => this.showSelectionText(), null, true);
      return;
    }

    if (!unown) {
      this.getUi().playError();
      globalScene.ui.showText(
        "No Unown is holding the Unown Box.",
        null,
        () => this.showSelectionText(),
        null,
        true,
      );
      return;
    }

    const legendaryHelperId = ALPH_LEGENDARY_HELPER_SPELLS[word];
    if (legendaryHelperId) {
      this.applyLegendaryHelperSpell(legendaryHelperId);
      return;
    }

    const statSpell = ALPH_STAT_SPELLS[word];
    if (statSpell) {
      this.applyStatSpell(unown, statSpell.stat, statSpell.label);
      return;
    }

    const moveId = this.getMoveIdForSpell(word);
    if (moveId !== undefined) {
      this.learnMoveSpell(unown, moveId);
      return;
    }

    const abilityId = this.getAbilityIdForSpell(word);
    if (abilityId !== undefined) {
      this.openAbilitySlotSelect(unown, abilityId);
      return;
    }

    globalScene.ui.showText(
      `The wall reads "${displayWord || word}".\nNothing happened.`,
      null,
      () => this.showSelectionText(),
      null,
      true,
    );
  }

  private getMoveIdForSpell(word: string): MoveId | undefined {
    const moveId = MoveId[word as keyof typeof MoveId];
    if (typeof moveId !== "number" || DENIED_ALPH_MOVE_IDS.has(moveId) || !allMoves[moveId]) {
      return;
    }

    if (allMoves[moveId].name.endsWith(" (N)")) {
      return;
    }

    return moveId;
  }

  private getAbilityIdForSpell(word: string): AbilityId | undefined {
    const abilityId = AbilityId[word as keyof typeof AbilityId];
    if (
      typeof abilityId !== "number"
      || DENIED_ALPH_ABILITY_IDS.has(abilityId)
      || word.startsWith("ABILITY_")
      || !allAbilities[abilityId]
    ) {
      return;
    }

    return abilityId;
  }

  private getUnownBoxHolder(): PlayerPokemon | undefined {
    const unownBox = globalScene.findModifierForPlayer(
      modifier => modifier instanceof UnownBoxModifier,
      this.config?.playerIndex ?? globalScene.activePlayerIndex,
    ) as UnownBoxModifier | undefined;
    const pokemon = unownBox?.getPokemon();

    return pokemon instanceof PlayerPokemon && pokemon.hasSpecies(SpeciesId.UNOWN) ? pokemon : undefined;
  }

  private learnMoveSpell(unown: PlayerPokemon, moveId: MoveId): void {
    if (unown.getMoveset().some(move => move.moveId === moveId)) {
      this.getUi().playError();
      globalScene.ui.showText(
        `${getPokemonNameWithAffix(unown)} already knows ${allMoves[moveId].name}.`,
        null,
        () => this.showSelectionText(),
        null,
        true,
      );
      return;
    }

    const partyMemberIndex = globalScene.getPlayerParty(this.config!.playerIndex).indexOf(unown);
    if (partyMemberIndex < 0) {
      this.getUi().playError();
      globalScene.ui.showText(
        "The Unown Box holder could not be found.",
        null,
        () => this.showSelectionText(),
        null,
        true,
      );
      return;
    }

    const config = this.config!;
    this.commitWorkingCounts();
    globalScene.ui.clearText();
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => config.onMoveSpell(partyMemberIndex, moveId));
  }

  private openAbilitySlotSelect(unown: PlayerPokemon, abilityId: AbilityId): void {
    const options: OptionSelectItem[] = [
      {
        label: "Ability",
        handler: () => {
          globalScene.ui.revertMode().then(() => this.applyAbilitySpell(unown, abilityId, false));
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Passive",
        handler: () => {
          globalScene.ui.revertMode().then(() => this.applyAbilitySpell(unown, abilityId, true));
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Cancel",
        handler: () => {
          globalScene.ui.revertMode().then(() => this.showSelectionText());
          return true;
        },
        keepOpen: true,
      },
    ];
    const config: OptionSelectConfig = {
      options,
      noCancel: true,
      xOffset: 62,
      yOffset: 58,
    };

    globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, config);
  }

  private applyAbilitySpell(unown: PlayerPokemon, abilityId: AbilityId, passive: boolean): void {
    const currentAbility = passive ? unown.getPassiveAbility() : unown.getAbility();
    if (currentAbility.id === abilityId) {
      this.getUi().playError();
      globalScene.ui.showText(
        `${getPokemonNameWithAffix(unown)} already has ${allAbilities[abilityId].name} in that slot.`,
        null,
        () => this.showSelectionText(),
        null,
        true,
      );
      return;
    }

    if (passive) {
      unown.customPokemonData.passive = abilityId;
    } else if (unown.isFusion()) {
      if (!unown.fusionCustomPokemonData) {
        unown.fusionCustomPokemonData = new CustomPokemonData();
      }
      unown.fusionCustomPokemonData.ability = abilityId;
    } else {
      unown.customPokemonData.ability = abilityId;
    }

    this.finishSuccessfulWallSpell();
    globalScene.ui.showText(
      `${getPokemonNameWithAffix(unown)}'s ${passive ? "Passive" : "Ability"} became ${allAbilities[abilityId].name}!`,
      null,
      () => this.showSelectionText(),
      null,
      true,
    );
  }

  private applyStatSpell(unown: PlayerPokemon, stat: PermanentStat, label: string): void {
    const boosts = (unown.customPokemonData.alphBaseStatBoosts ??= {});
    boosts[stat] = (boosts[stat] ?? 0) + 10;
    unown.calculateStats();
    void unown.updateInfo(true);

    this.finishSuccessfulWallSpell();
    globalScene.ui.showText(
      `${getPokemonNameWithAffix(unown)}'s base ${label} rose by 10!`,
      null,
      () => this.showSelectionText(),
      null,
      true,
    );
  }

  private applyLegendaryHelperSpell(helperId: AlphLegendaryHelperId): void {
    const playerIndex = this.config!.playerIndex;
    const helperConfig = ALPH_LEGENDARY_HELPER_CONFIGS[helperId];
    const alreadyClaimed =
      globalScene.hasUsedAlphLegendaryHelper(helperId, playerIndex)
      || !!globalScene.findModifierForPlayer(
        modifier => modifier instanceof LegendaryHelperModifier && modifier.getHelperId() === helperId,
        playerIndex,
      );

    if (alreadyClaimed) {
      this.getUi().playError();
      globalScene.ui.showText(
        `${helperConfig.nickname} has already answered this run.`,
        null,
        () => this.showSelectionText(),
        null,
        true,
      );
      return;
    }

    const modifierType = modifierTypes.GLASS_BALL().withIdFromFunc(modifierTypes.GLASS_BALL);
    const modifier = modifierType.newModifier(helperId);
    if (!globalScene.addModifier(modifier, false, true, false, true, undefined, playerIndex)) {
      this.getUi().playError();
      globalScene.ui.showText("The Glass Ball did not respond.", null, () => this.showSelectionText(), null, true);
      return;
    }

    globalScene.markAlphLegendaryHelperUsed(helperId, playerIndex);
    this.finishSuccessfulWallSpell();
    globalScene.ui.showText(
      `${helperConfig.nickname}'s Glass Ball began to shine!`,
      null,
      () => this.showSelectionText(),
      null,
      true,
    );
  }

  private finishSuccessfulWallSpell(): void {
    this.commitWorkingCounts();
    this.inputCharacters = Array.from({ length: 48 }, () => "blank" as const);
    this.workingCounts = { ...globalScene.getPlayerAlphTiles(this.config!.playerIndex) };
    this.renderWall();
    this.updateCursor();
  }

  private commitWorkingCounts(): void {
    const counts = globalScene.getPlayerAlphTiles(this.config!.playerIndex);
    for (const character of ALPH_TILE_CHARACTERS) {
      delete counts[character];
    }
    Object.assign(counts, this.workingCounts);
  }

  private close(): void {
    globalScene.ui.clearText();
    this.config?.onClose();
  }

  private showSelectionText(): void {
    if (globalScene.ui.getMode() !== UiMode.ALPH_WALL) {
      return;
    }

    const selected = this.interactives[this.cursor];
    const held = this.selectedTile ? getAlphTileDisplayCharacter(this.selectedTile) || "blank" : "none";
    const label = selected?.label ?? "";
    globalScene.ui.showText(`Alph Wall\nSelected: ${held}${label ? `\n${label}` : ""}`, 0, undefined, 0, true);
  }
}
