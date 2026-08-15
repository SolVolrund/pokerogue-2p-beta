import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { PLAYER_PARTY_MAX_SIZE } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { EvolutionItem } from "#balance/pokemon-evolutions";
import { modifierTypes } from "#data/data-lists";
import { ALPH_LEGENDARY_HELPER_CONFIGS, type AlphLegendaryHelperId } from "#data/alph/legendary-helpers";
import {
  getMiningIronTemplates,
  getMiningRewardTemplates,
  loadMiningLayout,
  type MiningLayoutData,
  type MiningTemplate,
} from "#data/mining/mining-layout";
import { AbilityId } from "#enums/ability-id";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { ZCrystal } from "#enums/z-crystal";
import type { PlayerPokemon } from "#field/pokemon";
import {
  LegendaryHelperModifier,
  MegaEvolutionAccessModifier,
  TerastallizeAccessModifier,
  ZMoveAccessModifier,
} from "#modifiers/modifier";
import { ModifierType, ModifierTypeGenerator, ModifierTypeOption, PokemonModifierType } from "#modifiers/modifier-type";
import type { ModifierTypeFunc } from "#types/modifier-types";
import type { PartyOption } from "#ui/party-ui-handler";
import { PartyUiMode } from "#ui/party-ui-handler";
import { clearMiningInputMode, setMiningInputMode } from "#ui/mining-input-ui-handler";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
import { getCachedUrl } from "#utils/fetch-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

const INITIAL_INTEGRITY = 216;
const REWARD_COUNT = 6;
const IRON_COUNT = 4;
const MINING_BGM_KEY = "mining_underground";
const MINING_ANIMATION_FRAME_MS = 65;
const MINING_ANIMATION_FRAME_COUNT = 9;

type MiningTool = "hammer" | "pickaxe";
type MiningSound = "impact" | "clank" | "item_reveal" | "wall_collapse";

interface MiningCell {
  durability: number;
  iron: boolean;
  clank: boolean;
}

interface PlacedMiningTemplate {
  template: MiningTemplate;
  x: number;
  y: number;
  uncovered: boolean;
}

interface MiningHitAnimation {
  tool: MiningTool;
  x: number;
  y: number;
  clanked: boolean;
  startedAt: number;
}

interface MiningHitAnimationFrame {
  active?: boolean;
  impactFrame?: number;
  shakeX?: number;
  hidden?: boolean;
}

const MINING_DIRECT_REWARD_MODIFIERS = {
  nugget: "NUGGET",
  bignugget: "BIG_NUGGET",
  relicgold: "RELIC_GOLD",
  revive: "REVIVE",
  maxrevive: "MAX_REVIVE",
  heartscale: "MEMORY_MUSHROOM",
  lightclay: "LIGHT_CLAY",
  unownbox: "UNOWN_BOX",
} as const;
const MINING_REPEATABLE_REWARD_GROUPS = new Set(["nugget_item"]);
const MINING_UNSUPPORTED_REWARD_GROUPS = new Set(["special_fossil"]);
const MINING_FOSSIL_REWARD_SPECIES = {
  domefossil: SpeciesId.KABUTO,
  helixfossil: SpeciesId.OMANYTE,
  oldamber: SpeciesId.AERODACTYL,
  rootfossil: SpeciesId.LILEEP,
  clawfossil: SpeciesId.ANORITH,
  skullfossil: SpeciesId.CRANIDOS,
  armorfossil: SpeciesId.SHIELDON,
  coverfossil: SpeciesId.TIRTOUGA,
  plumefossil: SpeciesId.ARCHEN,
  jawfossil: SpeciesId.TYRUNT,
  sailfossil: SpeciesId.AMAURA,
  oddkeystone: SpeciesId.SPIRITOMB,
} as const;
const MINING_REWARD_LABELS = {
  domefossil: "Dome Fossil",
  helixfossil: "Helix Fossil",
  oldamber: "Old Amber",
  rootfossil: "Root Fossil",
  clawfossil: "Claw Fossil",
  skullfossil: "Skull Fossil",
  armorfossil: "Armor Fossil",
  coverfossil: "Cover Fossil",
  plumefossil: "Plume Fossil",
  jawfossil: "Jaw Fossil",
  sailfossil: "Sail Fossil",
  oddkeystone: "Odd Keystone",
  cometshard: "Comet Shard",
} as const;
const MINING_COMET_SHARD_HELPER_ID: AlphLegendaryHelperId = "jirachi";
const MINING_MYSTICAL_ROCK_ITEM_IDS = new Set([
  "heatrock",
  "damprock",
  "smoothrock",
  "icyrock",
]);
const MINING_WEATHER_OR_TERRAIN_MOVE_IDS = new Set<MoveId>([
  MoveId.SUNNY_DAY,
  MoveId.RAIN_DANCE,
  MoveId.SANDSTORM,
  MoveId.SNOWSCAPE,
  MoveId.HAIL,
  MoveId.CHILLY_RECEPTION,
  MoveId.ELECTRIC_TERRAIN,
  MoveId.PSYCHIC_TERRAIN,
  MoveId.GRASSY_TERRAIN,
  MoveId.MISTY_TERRAIN,
]);
const MINING_WEATHER_OR_TERRAIN_ABILITY_IDS = [
  AbilityId.DROUGHT,
  AbilityId.ORICHALCUM_PULSE,
  AbilityId.DRIZZLE,
  AbilityId.SAND_STREAM,
  AbilityId.SAND_SPIT,
  AbilityId.SNOW_WARNING,
  AbilityId.ELECTRIC_SURGE,
  AbilityId.HADRON_ENGINE,
  AbilityId.PSYCHIC_SURGE,
  AbilityId.GRASSY_SURGE,
  AbilityId.SEED_SOWER,
  AbilityId.MISTY_SURGE,
] as const;
const MINING_ATTACK_TYPE_BOOSTER_ITEM_TYPES = {
  hardstone: PokemonType.ROCK,
} as const;
const MINING_TYPE_IDS = {
  normal: PokemonType.NORMAL,
  fighting: PokemonType.FIGHTING,
  flying: PokemonType.FLYING,
  poison: PokemonType.POISON,
  ground: PokemonType.GROUND,
  rock: PokemonType.ROCK,
  bug: PokemonType.BUG,
  ghost: PokemonType.GHOST,
  steel: PokemonType.STEEL,
  fire: PokemonType.FIRE,
  water: PokemonType.WATER,
  grass: PokemonType.GRASS,
  electric: PokemonType.ELECTRIC,
  psychic: PokemonType.PSYCHIC,
  ice: PokemonType.ICE,
  dragon: PokemonType.DRAGON,
  dark: PokemonType.DARK,
  fairy: PokemonType.FAIRY,
  stellar: PokemonType.STELLAR,
};
const MINING_ASSET_KEY_PREFIX = "mining_asset";
const MINING_WALL_LAYER_PATHS = Array.from({ length: 7 }, (_, index) => `images/digging/wall layer ${index}.png`);
const MINING_TOOL_BUTTON_PATHS = {
  hammerSelected: "images/digging/hammer selected.png",
  hammerDeselected: "images/digging/hammer deselected.png",
  pickaxeSelected: "images/digging/pickaxe selected.png",
  pickaxeDeselected: "images/digging/pickaxe deselected.png",
};
const MINING_TOOL_SELECTION_CURSOR_PATHS = {
  hammer: "images/digging/imported mining bg test items/Screen's Updated Mining Resources/Graphics/Pictures/Mining/hammer cursor.png",
  pickaxe: "images/digging/imported mining bg test items/Screen's Updated Mining Resources/Graphics/Pictures/Mining/pickaxe cursor.png",
};
const MINING_TOOL_CURSOR_PATHS = {
  hammer: "images/digging/hammer sprite idle.png",
  pickaxe: "images/digging/pickaxe sprite idle.png",
};
const MINING_TOOL_ACTIVE_PATHS = {
  hammer: "images/digging/hammer sprite active.png",
  pickaxe: "images/digging/pickaxe sprite active.png",
};
const MINING_IMPACT_PATHS = {
  hammer: [
    "images/digging/hammer impact anim 0.png",
    "images/digging/hammer impact anim 1.png",
    "images/digging/hammer impact anim 2.png",
    "images/digging/hammer impact anim 3.png",
  ],
  pickaxe: [
    "images/digging/pickaxe impact anim 0.png",
    "images/digging/pickaxe impact anim 1.png",
    "images/digging/pickaxe impact anim 2.png",
    "images/digging/pickaxe impact anim 3.png",
  ],
};
const MINING_CLANK_IMPACT_PATHS = {
  hammer: "images/digging/hammer impact anim clank.png",
  pickaxe: "images/digging/pickaxe impact anim clank.png",
};
const MINING_TOOL_DRAW_OFFSETS = {
  hammer: {
    idle: { x: -7, y: -24 },
    active: { x: -10, y: -23 },
  },
  pickaxe: {
    idle: { x: -7, y: -24 },
    active: { x: -10, y: -23 },
  },
} as const;
const MINING_SOUND_SETTINGS = {
  impact: { volume: 0.28, rateMin: 0.86, rateMax: 1.08, startJitter: 0.012 },
  clank: { volume: 0.22, rateMin: 0.78, rateMax: 1.04, startJitter: 0.018 },
  item_reveal: { volume: 0.32, rateMin: 0.94, rateMax: 1.06, startJitter: 0.006 },
  wall_collapse: { volume: 0.34, rateMin: 0.88, rateMax: 1, startJitter: 0 },
} as const;

export class MiningPhase extends Phase {
  public readonly phaseName = "MiningPhase";
  private readonly playerIndex: PlayerIndex;
  private readonly queuePostEncounterPhase: boolean;
  private container: Phaser.GameObjects.Container | undefined;
  private layout: MiningLayoutData | undefined;
  private cells: MiningCell[][] = [];
  private rewards: PlacedMiningTemplate[] = [];
  private irons: PlacedMiningTemplate[] = [];
  private assetKeys = new Map<string, string>();
  private cursorX = 0;
  private cursorY = 0;
  private tool: MiningTool = "pickaxe";
  private integrity = INITIAL_INTEGRITY;
  private complete = false;
  private animating = false;
  private hitAnimation: MiningHitAnimation | undefined;

  constructor(playerIndex: PlayerIndex = globalScene.activePlayerIndex, queuePostEncounterPhase = true) {
    super();
    this.playerIndex = playerIndex;
    this.queuePostEncounterPhase = queuePostEncounterPhase;
  }

  start(): void {
    super.start();

    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(this.playerIndex);
    } else {
      globalScene.setActivePlayerIndex(this.playerIndex);
    }

    globalScene.ui.clearText();
    void loadMiningLayout()
      .then(async layout => {
        this.layout = layout;
        await this.loadMiningAssets(layout);
        this.createBoard(layout);
        this.createUi();
        this.render();
        audioManager.playBgm(MINING_BGM_KEY, true);
        this.enableMiningInput(150);
      })
      .catch(error => {
        console.warn("Failed to load mining layout", error);
        this.finish(false, "The wall crumbles before you can begin mining.");
      });
  }

  override end(): void {
    clearMiningInputMode();
    this.container?.destroy(true);
    this.container = undefined;
    super.end();
  }

  private enableMiningInput(inputDelayMs = 0): void {
    setMiningInputMode({
      inputDelayMs,
      onMove: (dx, dy) => this.moveCursor(dx, dy),
      onConfirm: () => this.dig(),
      onToolToggle: () => this.toggleTool(),
    });
  }

  private async loadMiningAssets(layout: MiningLayoutData): Promise<void> {
    const assetPaths = new Set<string>();

    this.addAssetPath(assetPaths, layout.baseImage);
    for (const path of MINING_WALL_LAYER_PATHS) {
      this.addAssetPath(assetPaths, path);
    }
    for (const path of Object.values(MINING_TOOL_BUTTON_PATHS)) {
      this.addAssetPath(assetPaths, path);
    }
    for (const path of Object.values(MINING_TOOL_SELECTION_CURSOR_PATHS)) {
      this.addAssetPath(assetPaths, path);
    }
    for (const path of Object.values(MINING_TOOL_CURSOR_PATHS)) {
      this.addAssetPath(assetPaths, path);
    }
    for (const path of Object.values(MINING_TOOL_ACTIVE_PATHS)) {
      this.addAssetPath(assetPaths, path);
    }
    for (const paths of Object.values(MINING_IMPACT_PATHS)) {
      for (const path of paths) {
        this.addAssetPath(assetPaths, path);
      }
    }
    for (const path of Object.values(MINING_CLANK_IMPACT_PATHS)) {
      this.addAssetPath(assetPaths, path);
    }
    for (const object of layout.objects ?? []) {
      this.addAssetPath(assetPaths, object.assetPath);
    }
    for (const template of [...getMiningRewardTemplates(layout), ...getMiningIronTemplates(layout)]) {
      this.addAssetPath(assetPaths, template.assetPath);
    }
    for (const path of layout.supportSheets?.cracks?.framePaths ?? []) {
      this.addAssetPath(assetPaths, path);
    }

    const pathsToLoad = [...assetPaths].filter(path => !globalScene.textures.exists(this.getAssetKey(path)!));
    const soundsToLoad = (Object.keys(MINING_SOUND_SETTINGS) as MiningSound[])
      .filter(sound => !globalScene.cache.audio.exists(this.getMiningSoundKey(sound)));
    if (pathsToLoad.length === 0 && soundsToLoad.length === 0) {
      return;
    }

    await new Promise<void>(resolve => {
      globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      for (const path of pathsToLoad) {
        globalScene.load.image(this.getAssetKey(path)!, getCachedUrl(path));
      }
      for (const sound of soundsToLoad) {
        globalScene.load.audio(this.getMiningSoundKey(sound), getCachedUrl(`audio/se/digging/${sound}.wav`));
      }
      globalScene.load.start();
    });
  }

  private addAssetPath(paths: Set<string>, path: string | undefined): void {
    const normalizedPath = this.normalizeAssetPath(path);
    if (normalizedPath) {
      paths.add(normalizedPath);
      this.assetKeys.set(normalizedPath, this.buildAssetKey(normalizedPath));
    }
  }

  private getAssetKey(path: string | undefined): string | undefined {
    const normalizedPath = this.normalizeAssetPath(path);
    if (!normalizedPath) {
      return undefined;
    }

    const existingKey = this.assetKeys.get(normalizedPath);
    if (existingKey) {
      return existingKey;
    }

    const key = this.buildAssetKey(normalizedPath);
    this.assetKeys.set(normalizedPath, key);
    return key;
  }

  private normalizeAssetPath(path: string | undefined): string | undefined {
    if (!path) {
      return undefined;
    }

    return path.replace("images/digging/components/", "images/digging/");
  }

  private buildAssetKey(path: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < path.length; i++) {
      hash ^= path.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `${MINING_ASSET_KEY_PREFIX}_${(hash >>> 0).toString(16)}`;
  }

  private createBoard(layout: MiningLayoutData): void {
    this.integrity = INITIAL_INTEGRITY;
    this.cursorX = Math.floor(layout.board.cols / 2);
    this.cursorY = Math.floor(layout.board.rows / 2);
    this.tool = "pickaxe";
    this.complete = false;

    this.cells = Array.from({ length: layout.board.rows }, () =>
      Array.from({ length: layout.board.cols }, () => ({
        durability: this.rollDurability(),
        iron: false,
        clank: false,
      })),
    );

    const occupied = Array.from({ length: layout.board.rows }, () =>
      Array.from({ length: layout.board.cols }, () => false),
    );

    this.rewards = this.placeRewards(layout, occupied);
    this.irons = this.placeIrons(layout, occupied);
    for (const iron of this.irons) {
      this.forEachMaskedCell(iron, (x, y) => {
        this.cells[y][x].iron = true;
      });
      this.forEachMaskedCell(iron, (x, y, localX, localY) => {
        this.cells[y][x].clank = iron.template.clankMask?.[localY]?.[localX] ?? true;
      });
    }
  }

  private createUi(): void {
    this.container?.destroy(true);
    this.container = globalScene.add.container(0, 0);
    this.container.setName("mining-phase-ui");
    globalScene.uiContainer.add(this.container);
  }

  private render(): void {
    if (!this.container || !this.layout) {
      return;
    }

    const { board } = this.layout;
    this.container.removeAll(true);

    this.renderBackground();

    for (const reward of this.rewards) {
      this.renderTemplateSprite(reward);
    }
    for (const iron of this.irons) {
      this.renderTemplateSprite(iron);
    }

    for (let y = 0; y < board.rows; y++) {
      for (let x = 0; x < board.cols; x++) {
        const cell = this.cells[y][x];
        this.renderWallCell(x, y, cell);
      }
    }

    this.renderCracks();
    this.renderToolButtons();

    this.renderCursor();
    this.renderHitAnimation();
  }

  private renderBackground(): void {
    if (!this.container || !this.layout) {
      return;
    }

    const frame = this.getBaseFrame();
    const key = this.getAssetKey(this.layout.baseImage);
    if (!key) {
      const fallback = globalScene.add.rectangle(0, 0, frame.width, frame.height, 0x111827, 0.9);
      fallback.setOrigin(0);
      this.container.add(fallback);
      return;
    }

    const bg = globalScene.add.image(0, 0, key);
    bg.setOrigin(0);
    const sourceSize = this.getTextureSourceSize(key);

    const frameAspect = frame.width / frame.height;
    const sourceAspect = sourceSize.width / sourceSize.height;
    const sourceMatchesFrame = Math.abs(frameAspect - sourceAspect) < 0.01;
    if (!sourceMatchesFrame) {
      const layoutScaleX = sourceSize.width / this.layout.canvas.width;
      const layoutScaleY = sourceSize.height / this.layout.canvas.height;
      bg.setCrop(frame.x * layoutScaleX, frame.y * layoutScaleY, frame.width * layoutScaleX, frame.height * layoutScaleY);
    }
    bg.setDisplaySize(frame.width, frame.height);
    this.container.add(bg);
  }

  private renderTemplateSprite(placement: PlacedMiningTemplate): void {
    if (!this.container || !this.layout || placement.template.visible === false) {
      return;
    }

    const key = this.getAssetKey(placement.template.assetPath);
    if (!key) {
      return;
    }

    const { board } = this.layout;
    const template = placement.template;
    const sourceX = template.sourceX ?? 0;
    const sourceY = template.sourceY ?? 0;
    const sourceWidth = template.sourceWidth ?? template.widthCells * board.cellSize;
    const sourceHeight = template.sourceHeight ?? template.heightCells * board.cellSize;
    const frameName = this.getTemplateFrameName(template, sourceX, sourceY, sourceWidth, sourceHeight);
    const texture = globalScene.textures.get(key);
    if (!texture.has(frameName)) {
      texture.add(frameName, 0, sourceX, sourceY, sourceWidth, sourceHeight);
    }
    const image = globalScene.add.image(
      this.toFrameX(board.x + placement.x * board.cellSize),
      this.toFrameY(board.y + placement.y * board.cellSize),
      key,
      frameName,
    );
    image.setOrigin(0);
    image.setDisplaySize(template.widthCells * board.cellSize, template.heightCells * board.cellSize);
    this.container.add(image);
  }

  private getTemplateFrameName(
    template: MiningTemplate,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
  ): string {
    return [
      "mining-template",
      template.key,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
    ].join("-");
  }

  private renderWallCell(x: number, y: number, cell: MiningCell): void {
    if (!this.container || !this.layout) {
      return;
    }

    const layer = Math.max(0, Math.min(6, cell.durability));
    if (layer === 0) {
      return;
    }

    const key = this.getAssetKey(MINING_WALL_LAYER_PATHS[layer]);
    const { board } = this.layout;
    if (!key) {
      const rect = globalScene.add.rectangle(
        this.toFrameX(board.x + x * board.cellSize),
        this.toFrameY(board.y + y * board.cellSize),
        board.cellSize,
        board.cellSize,
        this.getCellColor(cell),
        1,
      );
      rect.setOrigin(0);
      this.container.add(rect);
      return;
    }

    const image = globalScene.add.image(
      this.toFrameX(board.x + x * board.cellSize),
      this.toFrameY(board.y + y * board.cellSize),
      key,
    );
    image.setOrigin(0);
    image.setDisplaySize(board.cellSize, board.cellSize);
    this.container.add(image);
  }

  private renderToolButtons(): void {
    if (!this.container || !this.layout) {
      return;
    }

    const configured = new Map((this.layout.objects ?? []).map(object => [object.key, object]));
    const buttonConfigs = [
      {
        key: this.tool === "hammer" ? "hammer_selected" : "hammer_deselected",
        fallbackPath: this.tool === "hammer" ? MINING_TOOL_BUTTON_PATHS.hammerSelected : MINING_TOOL_BUTTON_PATHS.hammerDeselected,
        fallbackX: 281,
        fallbackY: 42,
      },
      {
        key: this.tool === "pickaxe" ? "pickaxe_selected" : "pickaxe_deselected",
        fallbackPath: this.tool === "pickaxe" ? MINING_TOOL_BUTTON_PATHS.pickaxeSelected : MINING_TOOL_BUTTON_PATHS.pickaxeDeselected,
        fallbackX: 281,
        fallbackY: 114,
      },
    ];

    for (const config of buttonConfigs) {
      const object = configured.get(config.key);
      const path = object?.assetPath ?? config.fallbackPath;
      const textureKey = this.getAssetKey(path);
      if (!textureKey) {
        continue;
      }

      const image = globalScene.add.image(
        this.toFrameX(object?.x ?? config.fallbackX),
        this.toFrameY(object?.y ?? config.fallbackY),
        textureKey,
      );
      image.setOrigin(0);
      if (object?.width && object.height) {
        image.setDisplaySize(object.width, object.height);
      }
      this.container.add(image);
    }
  }

  private renderCracks(): void {
    if (!this.container || !this.layout) {
      return;
    }

    const framePaths = this.layout.supportSheets?.cracks?.framePaths ?? [];
    const segments = this.layout.crackSegments ?? [];
    if (framePaths.length < 7 || segments.length === 0) {
      return;
    }

    const totalProgressFrames = segments.length * 6;
    const progress = Math.min(
      totalProgressFrames,
      Math.ceil(((INITIAL_INTEGRITY - Math.max(0, this.integrity)) / INITIAL_INTEGRITY) * totalProgressFrames),
    );

    for (let index = 0; index < segments.length; index++) {
      const segmentProgress = progress - index * 6;
      if (segmentProgress <= 0) {
        continue;
      }

      const frameIndex = segmentProgress > 6 ? 0 : segmentProgress;
      const key = this.getAssetKey(framePaths[frameIndex]);
      if (!key) {
        continue;
      }

      const segment = segments[index];
      const image = globalScene.add.image(this.toFrameX(segment.x), this.toFrameY(segment.y), key);
      image.setOrigin(0);
      image.setDisplaySize(segment.width, segment.height);
      this.container.add(image);
    }
  }

  private renderCursor(): void {
    if (!this.container || !this.layout || this.hitAnimation) {
      return;
    }

    const { board } = this.layout;
    const x = this.toFrameX(board.x + this.cursorX * board.cellSize);
    const y = this.toFrameY(board.y + this.cursorY * board.cellSize);
    const cursorKey = this.getAssetKey(MINING_TOOL_SELECTION_CURSOR_PATHS[this.tool]);

    if (cursorKey) {
      const cursor = globalScene.add.image(x, y, cursorKey);
      cursor.setOrigin(0);
      cursor.setDisplaySize(board.cellSize, board.cellSize);
      this.container.add(cursor);
    } else {
      const cursor = globalScene.add.rectangle(x, y, board.cellSize, board.cellSize, 0xffffff, 0);
      cursor.setOrigin(0);
      cursor.setStrokeStyle(2, this.tool === "hammer" ? 0xff685a : 0x7da7ff, 1);
      this.container.add(cursor);
    }

    const toolKey = this.getAssetKey(MINING_TOOL_CURSOR_PATHS[this.tool]);
    if (!toolKey) {
      return;
    }

    const tool = globalScene.add.image(
      this.toFrameX(board.x + Math.min(board.cols - 1, this.cursorX + 1) * board.cellSize),
      this.toFrameY(board.y + this.cursorY * board.cellSize),
      toolKey,
    );
    tool.setOrigin(0.5, 0.65);
    this.container.add(tool);
  }

  private renderHitAnimation(): void {
    if (!this.container || !this.layout || !this.hitAnimation) {
      return;
    }

    const frameIndex = Math.floor((Date.now() - this.hitAnimation.startedAt) / MINING_ANIMATION_FRAME_MS);
    if (frameIndex >= MINING_ANIMATION_FRAME_COUNT) {
      return;
    }

    const frames: MiningHitAnimationFrame[] = [
      { active: true, impactFrame: 0 },
      { active: true, impactFrame: 1 },
      { active: true, impactFrame: 2 },
      { active: false },
      { active: false, impactFrame: 3 },
      { active: false, shakeX: 1 },
      { active: false, shakeX: -1 },
      { active: false, shakeX: 1 },
      { hidden: true },
    ];
    const frame = frames[frameIndex];
    if (frame.hidden) {
      return;
    }

    const { board } = this.layout;
    const centerX = this.toFrameX(board.x + this.hitAnimation.x * board.cellSize + board.cellSize / 2);
    const centerY = this.toFrameY(board.y + this.hitAnimation.y * board.cellSize + board.cellSize / 2);

    if (frame.impactFrame !== undefined) {
      const impactPath = this.hitAnimation.clanked
        ? MINING_CLANK_IMPACT_PATHS[this.hitAnimation.tool]
        : MINING_IMPACT_PATHS[this.hitAnimation.tool][frame.impactFrame];
      const impactKey = this.getAssetKey(impactPath);
      if (impactKey) {
        const impact = globalScene.add.image(centerX, centerY, impactKey);
        impact.setOrigin(0.5);
        this.container.add(impact);
      }
    }

    const toolPath = frame.active
      ? MINING_TOOL_ACTIVE_PATHS[this.hitAnimation.tool]
      : MINING_TOOL_CURSOR_PATHS[this.hitAnimation.tool];
    const toolKey = this.getAssetKey(toolPath);
    if (!toolKey) {
      return;
    }

    const offsetType = frame.active ? "active" : "idle";
    const offset = MINING_TOOL_DRAW_OFFSETS[this.hitAnimation.tool][offsetType];
    const tool = globalScene.add.image(
      Math.round(centerX + offset.x + (frame.shakeX ?? 0)),
      Math.round(centerY + offset.y),
      toolKey,
    );
    tool.setOrigin(0);
    this.container.add(tool);
  }

  private getBaseFrame(): { x: number; y: number; width: number; height: number } {
    return this.layout?.baseFrame ?? {
      x: 0,
      y: 0,
      width: this.layout?.canvas.width ?? globalScene.scaledCanvas.width,
      height: globalScene.scaledCanvas.height,
    };
  }

  private getTextureSourceSize(key: string): { width: number; height: number } {
    const sourceImage = globalScene.textures.get(key).getSourceImage() as { width?: number; height?: number };
    return {
      width: sourceImage.width ?? this.getBaseFrame().width,
      height: sourceImage.height ?? this.getBaseFrame().height,
    };
  }

  private toFrameX(x: number): number {
    return x - this.getBaseFrame().x;
  }

  private toFrameY(y: number): number {
    return y - this.getBaseFrame().y;
  }

  private moveCursor(dx: number, dy: number): boolean {
    if (!this.layout || this.complete || this.animating) {
      return false;
    }

    this.cursorX = Math.max(0, Math.min(this.layout.board.cols - 1, this.cursorX + dx));
    this.cursorY = Math.max(0, Math.min(this.layout.board.rows - 1, this.cursorY + dy));
    this.render();
    return true;
  }

  private toggleTool(): boolean {
    if (this.complete || this.animating) {
      return false;
    }

    this.tool = this.tool === "pickaxe" ? "hammer" : "pickaxe";
    this.render();
    return true;
  }

  private dig(): boolean {
    if (!this.layout || this.complete || this.animating) {
      return false;
    }

    this.playMiningSound("impact");
    const previouslyUncoveredRewards = this.rewards.filter(reward => reward.uncovered).length;
    const center = this.cells[this.cursorY][this.cursorX];
    const integrityDamage = this.tool === "pickaxe" ? 4 : 8;
    this.integrity -= integrityDamage;

    const hitIron = center.clank && center.durability <= 0;
    if (!hitIron) {
      center.durability = Math.max(0, center.durability - 2);
    }

    const newlyRevealedIron = center.clank && center.durability <= 0;
    if (!hitIron && !newlyRevealedIron) {
      for (const hit of this.getToolPattern()) {
        if (hit.dx === 0 && hit.dy === 0) {
          continue;
        }
        const x = this.cursorX + hit.dx;
        const y = this.cursorY + hit.dy;
        if (this.isInBounds(x, y)) {
          this.cells[y][x].durability = Math.max(0, this.cells[y][x].durability - hit.damage);
        }
      }
    }

    const clanked = hitIron || newlyRevealedIron;
    const newlyUncoveredRewards = this.updateRewardReveals();
    const shouldFinish = this.integrity <= 0 || this.rewards.every(reward => reward.uncovered);

    if (clanked) {
      this.playMiningSound("clank");
    }
    if (newlyUncoveredRewards > previouslyUncoveredRewards) {
      this.playMiningSound("item_reveal");
    }
    if (this.integrity <= 0) {
      this.playMiningSound("wall_collapse");
    }

    const hitTool = this.tool;
    const hitX = this.cursorX;
    const hitY = this.cursorY;
    this.startHitAnimation(hitTool, hitX, hitY, clanked, () => {
      if (shouldFinish) {
        this.finish(false);
      } else {
        this.render();
      }
    });

    return true;
  }

  private startHitAnimation(
    tool: MiningTool,
    x: number,
    y: number,
    clanked: boolean,
    onComplete: () => void,
  ): void {
    this.animating = true;
    this.hitAnimation = {
      tool,
      x,
      y,
      clanked,
      startedAt: Date.now(),
    };
    this.render();

    for (let frame = 1; frame <= MINING_ANIMATION_FRAME_COUNT; frame++) {
      globalScene.time.delayedCall(frame * MINING_ANIMATION_FRAME_MS, () => {
        if (!this.animating || !this.hitAnimation || this.complete) {
          return;
        }

        if (frame >= MINING_ANIMATION_FRAME_COUNT) {
          this.animating = false;
          this.hitAnimation = undefined;
          onComplete();
          return;
        }

        this.render();
      });
    }
  }

  private finish(cancelled: boolean, overrideMessage?: string): boolean {
    if (this.complete) {
      return false;
    }

    this.complete = true;
    clearMiningInputMode();
    this.container?.destroy(true);
    this.container = undefined;
    audioManager.playBgm(undefined, true);

    const foundRewards = this.rewards.filter(reward => reward.uncovered);
    void this.finishMining(cancelled, foundRewards, overrideMessage);

    return true;
  }

  private async finishMining(
    cancelled: boolean,
    foundRewards: PlacedMiningTemplate[],
    overrideMessage?: string,
  ): Promise<void> {
    if (overrideMessage) {
      await this.showMiningText(overrideMessage);
    } else if (cancelled) {
      await this.showMiningText("You step away from the mining wall.");
    } else if (foundRewards.length === 0) {
      await this.showMiningText("The wall collapsed before you uncovered anything.");
    } else {
      for (const reward of foundRewards) {
        if (await this.tryAwardSpecialReward(reward.template)) {
          continue;
        }

        this.queueModifierReward(reward.template);
      }
    }

    if (this.queuePostEncounterPhase) {
      globalScene.phaseManager.pushNew("PostMysteryEncounterPhase");
    }
    this.end();
  }

  private getMiningSoundKey(sound: MiningSound): string {
    return `se/digging/${sound}`;
  }

  private playMiningSound(sound: MiningSound): void {
    const settings = MINING_SOUND_SETTINGS[sound];
    const rateRange = Math.max(0, settings.rateMax - settings.rateMin);
    const rate = settings.rateMin + Math.random() * rateRange;
    const seek = settings.startJitter > 0 ? Math.random() * settings.startJitter : 0;
    audioManager.playSound(this.getMiningSoundKey(sound), {
      volume: settings.volume,
      rate,
      seek,
    });
  }

  private queueModifierReward(template: MiningTemplate): void {
    const modifierType = this.getRewardModifierType(template);
    if (!modifierType) {
      return;
    }

    globalScene.phaseManager.pushNew(
      "MessagePhase",
      `You dug up ${this.formatItemLabel(template.itemId ?? "an item")}!`,
      null,
      true,
    );
    globalScene.phaseManager.pushNew(
      "SelectModifierPhase",
      0,
      undefined,
      {
        guaranteedModifierTypeOptions: [new ModifierTypeOption(modifierType, 0)],
        fillRemaining: false,
        rerollMultiplier: -1,
      },
      false,
      this.playerIndex,
    );
  }

  private async tryAwardSpecialReward(template: MiningTemplate): Promise<boolean> {
    const itemId = this.getNormalizedItemId(template);
    if (!itemId) {
      return false;
    }

    if (itemId === "cometshard") {
      await this.awardCometShard();
      return true;
    }

    const fossilSpecies = MINING_FOSSIL_REWARD_SPECIES[itemId as keyof typeof MINING_FOSSIL_REWARD_SPECIES];
    if (fossilSpecies !== undefined) {
      await this.awardFossilPokemon(fossilSpecies, template.itemId ?? itemId);
      return true;
    }

    return false;
  }

  private async awardCometShard(): Promise<void> {
    const helperConfig = ALPH_LEGENDARY_HELPER_CONFIGS[MINING_COMET_SHARD_HELPER_ID];

    if (this.hasCometShardHelper()) {
      await this.showMiningText(`${helperConfig.nickname} has already answered this run.`);
      return;
    }

    const modifierType = modifierTypes.GLASS_BALL().withIdFromFunc(modifierTypes.GLASS_BALL);
    const modifier = modifierType.newModifier(MINING_COMET_SHARD_HELPER_ID);
    if (globalScene.addModifier(modifier, false, true, false, true, undefined, this.playerIndex)) {
      globalScene.markAlphLegendaryHelperUsed(MINING_COMET_SHARD_HELPER_ID, this.playerIndex);
      this.savePlayerSystemData();
      await this.showMiningText("The Comet Shard began to shine. Jirachi will answer your call!");
    } else {
      await this.showMiningText("The Comet Shard did not respond.");
    }
  }

  private async awardFossilPokemon(speciesId: SpeciesId, itemLabel: string): Promise<void> {
    const species = getPokemonSpecies(speciesId);
    const pokemon = globalScene.addPlayerPokemon(species, this.getFossilRewardLevel());
    pokemon.generateAndPopulateMoveset();

    await this.showMiningText(`${this.formatItemLabel(itemLabel)} restored into ${pokemon.getNameToRender()}!`);
    await this.addRewardPokemonToParty(pokemon);
  }

  private async addRewardPokemonToParty(pokemon: PlayerPokemon): Promise<void> {
    const addToParty = async (slotIndex?: number): Promise<void> => {
      const newPokemon = globalScene.addPlayerPokemon(
        pokemon.species,
        pokemon.level,
        pokemon.abilityIndex,
        pokemon.formIndex,
        pokemon.gender,
        pokemon.shiny,
        pokemon.variant,
        pokemon.ivs,
        pokemon.nature,
        pokemon,
      );
      newPokemon.pokeball = PokeballType.POKEBALL;
      newPokemon.setVisible(false);

      const party = globalScene.getPlayerParty(this.playerIndex);
      if (slotIndex != null && slotIndex <= party.length) {
        party.splice(slotIndex, 0, newPokemon);
      } else {
        party.push(newPokemon);
      }

      pokemon.destroy();

      await newPokemon.loadAssets();
      await this.updateCaughtDataForReward(newPokemon);
      this.savePlayerSystemData();
      await this.showMiningText(`${newPokemon.getNameToRender()} joined your team!`);
    };

    if (globalScene.isPlayerPartyFull(this.playerIndex)) {
      const pokemonName = pokemon.getNameToRender();
      await this.promptReleaseForRewardPokemon(pokemonName, addToParty, async () => {
        pokemon.destroy();
        await this.showMiningText(`${pokemonName} was left behind.`);
      });
    } else {
      await addToParty();
    }
  }

  private promptReleaseForRewardPokemon(
    pokemonName: string,
    addToParty: (slotIndex?: number) => Promise<void>,
    declineReward: () => Promise<void>,
  ): Promise<void> {
    return new Promise(resolve => {
      const finishDecline = () => {
        void globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
          declineReward().then(() => resolve());
        });
      };

      const showReleaseMenu = () => {
        globalScene.ui.setMode(
          UiMode.PARTY,
            PartyUiMode.RELEASE,
            this.getPartyUiFieldSlotForPlayer(),
            (slotIndex: number, _option: PartyOption) => {
              globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                if (slotIndex < PLAYER_PARTY_MAX_SIZE) {
                  addToParty(slotIndex).then(() => resolve());
                } else {
                  promptRelease();
                }
              });
          },
        );
      };

      const promptRelease = () => {
        if (globalScene.twoPlayerMode) {
          globalScene.waitForPlayerInput(this.playerIndex);
        } else {
          globalScene.setActivePlayerIndex(this.playerIndex);
        }

        updateWindowType(this.playerIndex + 1);
        globalScene.ui.showText(
          i18next.t("battle:partyFull", { pokemonName }),
          null,
          () => {
            globalScene.pokemonInfoContainer.makeRoomForConfirmUi(1, true);
            globalScene.ui.setMode(UiMode.CONFIRM, showReleaseMenu, finishDecline);
          },
          0,
          true,
        );
      };

      promptRelease();
    });
  }

  private async updateCaughtDataForReward(pokemon: PlayerPokemon): Promise<void> {
    const gameData = globalScene.getPlayerGameData(this.playerIndex);
    gameData.updateSpeciesDexIvs(pokemon.species.getRootSpeciesId(true), pokemon.ivs, this.playerIndex);
    await gameData.setPokemonCaught(pokemon, true, false, false);
  }

  private getFossilRewardLevel(): number {
    const party = globalScene.getPlayerParty(this.playerIndex);
    const partyLevel = party.length > 0
      ? Math.max(...party.map(pokemon => pokemon.level))
      : 1;
    return Math.max(1, Math.min(globalScene.getMaxExpLevel(), partyLevel));
  }

  private showMiningText(message: string): Promise<void> {
    return new Promise(resolve => {
      globalScene.setActivePlayerIndex(this.playerIndex);
      if (globalScene.twoPlayerMode) {
        globalScene.waitForSharedInput();
      }

      updateWindowType(this.playerIndex + 1);
      void globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
        globalScene.ui.showText(message, null, () => resolve(), null, true);
      });
    });
  }

  private savePlayerSystemData(): void {
    if (globalScene.twoPlayerMode) {
      globalScene.savePlayerSystemSaveLocal(this.playerIndex);
    } else {
      globalScene.gameData.saveSystemLocal();
    }
  }

  private getPartyUiFieldSlotForPlayer(): number {
    const fieldSlot = globalScene.getPlayerFieldOwners().indexOf(this.playerIndex);
    return fieldSlot > -1 ? fieldSlot : this.playerIndex;
  }

  private formatItemLabel(itemId: string): string {
    const normalizedItemId = itemId.replaceAll("_", "").toLowerCase();
    const mappedLabel = MINING_REWARD_LABELS[normalizedItemId as keyof typeof MINING_REWARD_LABELS];
    if (mappedLabel) {
      return mappedLabel;
    }

    return itemId
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, letter => letter.toUpperCase());
  }

  private rollDurability(): number {
    const roll = randSeedInt(100);
    if (roll < 8) {
      return 1;
    }
    if (roll < 24) {
      return 2;
    }
    if (roll < 46) {
      return 3;
    }
    if (roll < 70) {
      return 4;
    }
    if (roll < 90) {
      return 5;
    }
    return 6;
  }

  private placeRewards(layout: MiningLayoutData, occupied: boolean[][]): PlacedMiningTemplate[] {
    const candidates = getMiningRewardTemplates(layout).filter(template => this.canRewardTemplateSpawn(template));
    const placed: PlacedMiningTemplate[] = [];
    const usedGroups = new Set<string>();

    for (let i = 0; i < REWARD_COUNT && candidates.length > 0; i++) {
      const availableCandidates = candidates.filter(template => {
        const group = this.getRewardGroup(template);
        return MINING_REPEATABLE_REWARD_GROUPS.has(group) || !usedGroups.has(group);
      });
      if (availableCandidates.length === 0) {
        break;
      }

      const template = this.pickWeightedTemplate(availableCandidates);
      const placement = this.tryPlaceTemplate(template, layout, occupied);
      if (placement) {
        placed.push(placement);
        const group = this.getRewardGroup(template);
        if (!MINING_REPEATABLE_REWARD_GROUPS.has(group)) {
          usedGroups.add(group);
        }
      }
    }

    return placed;
  }

  private placeIrons(layout: MiningLayoutData, occupied: boolean[][]): PlacedMiningTemplate[] {
    const candidates = getMiningIronTemplates(layout);
    const placed: PlacedMiningTemplate[] = [];

    for (let i = 0; i < IRON_COUNT && candidates.length > 0; i++) {
      const template = this.pickWeightedTemplate(candidates);
      const placement = this.tryPlaceTemplate(template, layout, occupied);
      if (placement) {
        placed.push(placement);
      }
    }

    return placed;
  }

  private pickWeightedTemplate(templates: MiningTemplate[]): MiningTemplate {
    const totalWeight = templates.reduce((total, template) => total + Math.max(1, template.weight ?? 1), 0);
    let roll = randSeedInt(totalWeight);
    for (const template of templates) {
      roll -= Math.max(1, template.weight ?? 1);
      if (roll < 0) {
        return template;
      }
    }
    return templates[0];
  }

  private tryPlaceTemplate(
    template: MiningTemplate,
    layout: MiningLayoutData,
    occupied: boolean[][],
  ): PlacedMiningTemplate | null {
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = randSeedInt(Math.max(1, layout.board.cols - template.widthCells + 1));
      const y = randSeedInt(Math.max(1, layout.board.rows - template.heightCells + 1));
      const placement = { template, x, y, uncovered: false };
      if (this.canPlaceTemplate(placement, layout, occupied)) {
        this.forEachMaskedCell(placement, (cellX, cellY) => {
          occupied[cellY][cellX] = true;
        });
        return placement;
      }
    }

    return null;
  }

  private canPlaceTemplate(
    placement: PlacedMiningTemplate,
    layout: MiningLayoutData,
    occupied: boolean[][],
  ): boolean {
    if (
      placement.x + placement.template.widthCells > layout.board.cols
      || placement.y + placement.template.heightCells > layout.board.rows
    ) {
      return false;
    }

    let canPlace = true;
    this.forEachMaskedCell(placement, (x, y) => {
      if (occupied[y][x]) {
        canPlace = false;
      }
    });
    return canPlace;
  }

  private updateRewardReveals(): number {
    let uncoveredCount = 0;
    for (const reward of this.rewards) {
      if (!reward.uncovered && this.isTemplateFullyRevealed(reward)) {
        reward.uncovered = true;
      }
      if (reward.uncovered) {
        uncoveredCount++;
      }
    }
    return uncoveredCount;
  }

  private isTemplateFullyRevealed(placement: PlacedMiningTemplate): boolean {
    let fullyRevealed = true;
    this.forEachMaskedCell(placement, (x, y) => {
      if (this.cells[y][x].durability > 0) {
        fullyRevealed = false;
      }
    });
    return fullyRevealed;
  }

  private getVisibleMaskedCellCount(placement: PlacedMiningTemplate): number {
    let count = 0;
    this.forEachMaskedCell(placement, (x, y) => {
      if (this.cells[y][x].durability <= 0) {
        count++;
      }
    });
    return count;
  }

  private forEachMaskedCell(
    placement: PlacedMiningTemplate,
    callback: (x: number, y: number, localX: number, localY: number) => void,
  ): void {
    const mask = placement.template.mask ?? [];
    for (let y = 0; y < placement.template.heightCells; y++) {
      for (let x = 0; x < placement.template.widthCells; x++) {
        if (mask[y]?.[x] ?? true) {
          callback(placement.x + x, placement.y + y, x, y);
        }
      }
    }
  }

  private getCellColor(cell: MiningCell): number {
    if (cell.iron && cell.durability <= 0) {
      return 0x6b7280;
    }

    switch (cell.durability) {
      case 0:
        return 0xc7b79b;
      case 1:
        return 0xb5a78f;
      case 2:
        return 0xa3947e;
      case 3:
        return 0x917f6d;
      case 4:
        return 0x806f61;
      case 5:
        return 0x6f6258;
      default:
        return 0x5f534b;
    }
  }

  private getToolPattern(): { dx: number; dy: number; damage: number }[] {
    if (this.tool === "pickaxe") {
      return [
        { dx: 0, dy: 0, damage: 2 },
        { dx: 0, dy: -1, damage: 1 },
        { dx: -1, dy: 0, damage: 1 },
        { dx: 1, dy: 0, damage: 1 },
        { dx: 0, dy: 1, damage: 1 },
      ];
    }

    return [
      { dx: -1, dy: -1, damage: 1 },
      { dx: 0, dy: -1, damage: 2 },
      { dx: 1, dy: -1, damage: 1 },
      { dx: -1, dy: 0, damage: 2 },
      { dx: 0, dy: 0, damage: 2 },
      { dx: 1, dy: 0, damage: 2 },
      { dx: -1, dy: 1, damage: 1 },
      { dx: 0, dy: 1, damage: 2 },
      { dx: 1, dy: 1, damage: 1 },
    ];
  }

  private isInBounds(x: number, y: number): boolean {
    return !!this.layout && x >= 0 && y >= 0 && x < this.layout.board.cols && y < this.layout.board.rows;
  }

  private getRewardModifierType(template: MiningTemplate): ModifierType | null {
    const itemId = this.getNormalizedItemId(template);
    if (!itemId) {
      return null;
    }

    const directModifierKey = MINING_DIRECT_REWARD_MODIFIERS[itemId as keyof typeof MINING_DIRECT_REWARD_MODIFIERS];
    if (directModifierKey) {
      return this.generateRewardModifierType(modifierTypes[directModifierKey]);
    }

    if (MINING_MYSTICAL_ROCK_ITEM_IDS.has(itemId)) {
      return this.generateRewardModifierType(modifierTypes.MYSTICAL_ROCK);
    }

    const attackType = MINING_ATTACK_TYPE_BOOSTER_ITEM_TYPES[itemId as keyof typeof MINING_ATTACK_TYPE_BOOSTER_ITEM_TYPES];
    if (attackType !== undefined) {
      return this.generateRewardModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, [attackType]);
    }

    const gemType = this.getTypeReward(itemId, "gem");
    if (gemType !== null && gemType !== PokemonType.STELLAR) {
      return this.generateRewardModifierType(modifierTypes.TYPE_GEM, [gemType]);
    }

    const teraType = this.getTypeReward(itemId, "terashard");
    if (teraType !== null) {
      return this.generateRewardModifierType(modifierTypes.TERA_SHARD, [teraType]);
    }

    const zCrystal = this.getEnumReward(ZCrystal, itemId);
    if (zCrystal !== null) {
      return this.generateRewardModifierType(modifierTypes.Z_CRYSTAL, [zCrystal]);
    }

    const evolutionItem = this.getEnumReward(EvolutionItem, itemId);
    if (evolutionItem !== null && evolutionItem !== EvolutionItem.NONE) {
      return this.generateRewardModifierType(modifierTypes.EVOLUTION_ITEM, [evolutionItem]);
    }

    const formChangeItem = this.getEnumReward(FormChangeItem, itemId);
    if (formChangeItem !== null && formChangeItem !== FormChangeItem.NONE) {
      return this.generateRewardModifierType(
        this.isRareFormChangeItem(formChangeItem) ? modifierTypes.RARE_FORM_CHANGE_ITEM : modifierTypes.FORM_CHANGE_ITEM,
        [formChangeItem],
      );
    }

    return null;
  }

  private canRewardTemplateSpawn(template: MiningTemplate): boolean {
    const group = this.getRewardGroup(template);
    if (MINING_UNSUPPORTED_REWARD_GROUPS.has(group)) {
      return false;
    }

    const itemId = this.getNormalizedItemId(template);
    if (itemId === "cometshard") {
      return !this.hasCometShardHelper();
    }

    if (
      itemId
      && MINING_FOSSIL_REWARD_SPECIES[itemId as keyof typeof MINING_FOSSIL_REWARD_SPECIES] !== undefined
    ) {
      return true;
    }

    if (group === "mega_stone" && !this.hasAccessModifier(MegaEvolutionAccessModifier)) {
      return false;
    }

    if (group === "tera_shard" && !this.hasAccessModifier(TerastallizeAccessModifier)) {
      return false;
    }

    if (group === "z_crystal" && !this.hasAccessModifier(ZMoveAccessModifier)) {
      return false;
    }

    if (itemId && MINING_MYSTICAL_ROCK_ITEM_IDS.has(itemId) && !this.hasWeatherOrTerrainSource()) {
      return false;
    }

    const modifier = this.getRewardModifierType(template);
    return !!modifier && this.canAnyPartyMemberUseModifier(modifier);
  }

  private hasWeatherOrTerrainSource(): boolean {
    return globalScene.getPlayerParty(this.playerIndex).some(pokemon => {
      const hasMove = pokemon
        .getMoveset(true)
        .some(move => move != null && MINING_WEATHER_OR_TERRAIN_MOVE_IDS.has(move.moveId));
      return hasMove || MINING_WEATHER_OR_TERRAIN_ABILITY_IDS.some(ability => pokemon.hasAbility(ability, false, true));
    });
  }

  private hasCometShardHelper(): boolean {
    return (
      globalScene.hasUsedAlphLegendaryHelper(MINING_COMET_SHARD_HELPER_ID, this.playerIndex)
      || !!globalScene.findModifierForPlayer(
        modifier =>
          modifier instanceof LegendaryHelperModifier
          && modifier.getHelperId() === MINING_COMET_SHARD_HELPER_ID,
        this.playerIndex,
      )
    );
  }

  private getRewardGroup(template: MiningTemplate): string {
    return template.rewardGroup?.toLowerCase() ?? "";
  }

  private getNormalizedItemId(template: MiningTemplate): string | null {
    return template.itemId?.replaceAll("_", "").toLowerCase() ?? null;
  }

  private hasAccessModifier(
    modifierType: typeof MegaEvolutionAccessModifier | typeof TerastallizeAccessModifier | typeof ZMoveAccessModifier,
  ): boolean {
    return globalScene.getModifiersForPlayer(modifierType, this.playerIndex).length > 0;
  }

  private generateRewardModifierType(modifier: ModifierTypeFunc, pregenArgs?: any[]): ModifierType | null {
    const modifierId = Object.keys(modifierTypes).find(key => modifierTypes[key] === modifier);
    if (!modifierId) {
      return null;
    }

    const modifierFunc = modifierTypes[modifierId];
    const party = globalScene.getPlayerParty(this.playerIndex);
    const result = modifierFunc().withIdFromFunc(modifierFunc).withTierFromPool(ModifierPoolType.PLAYER, party);
    return result instanceof ModifierTypeGenerator ? result.generateType(party, pregenArgs) : result;
  }

  private canAnyPartyMemberUseModifier(modifier: ModifierType): boolean {
    if (!(modifier instanceof PokemonModifierType)) {
      return true;
    }

    if (!modifier.selectFilter) {
      return true;
    }

    return globalScene.getPlayerParty(this.playerIndex).some(pokemon => modifier.selectFilter?.(pokemon) === null);
  }

  private getTypeReward(itemId: string, suffix: string): PokemonType | null {
    if (!itemId.endsWith(suffix)) {
      return null;
    }

    const typeId = itemId.slice(0, -suffix.length);
    return MINING_TYPE_IDS[typeId as keyof typeof MINING_TYPE_IDS] ?? null;
  }

  private getEnumReward<T extends Record<string, string | number>>(enumObject: T, itemId: string): T[keyof T] | null {
    for (const [key, value] of Object.entries(enumObject)) {
      if (!Number.isNaN(Number(key))) {
        continue;
      }

      if (this.normalizeEnumText(key) === itemId || this.normalizeEnumText(String(value)) === itemId) {
        return value as T[keyof T];
      }
    }

    return null;
  }

  private normalizeEnumText(value: string): string {
    return value.replaceAll("_", "").toLowerCase();
  }

  private isRareFormChangeItem(item: FormChangeItem): boolean {
    return item >= FormChangeItem.BLUE_ORB && item < FormChangeItem.SHARP_METEORITE;
  }
}
