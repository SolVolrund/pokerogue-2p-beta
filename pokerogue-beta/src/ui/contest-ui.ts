import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { ContestRank } from "#data/contests/contest-opponents";
import { getContestSpectacularEffect } from "#data/contests/contest-spectacular-effects";
import { contestLayout, getContestLayoutSpriteObjects } from "#data/contests/contest-layout";
import type { ContestLayoutObject } from "#data/contests/contest-layout";
import { getContestSpectacularMove } from "#data/contests/contest-spectacular-moves";
import type { ContestParticipant, ContestState } from "#data/contests/contest-state";
import { ContestType } from "#data/contests/contest-type";
import { MoveId } from "#enums/move-id";
import { TextStyle } from "#enums/text-style";
import { addTextObject } from "#ui/text";
import { getCachedUrl } from "#utils/fetch-utils";

type ContestLayoutSprite = Phaser.GameObjects.Image & { layoutObject: ContestLayoutObject };
type ContestLayoutText = Phaser.GameObjects.Text & { layoutObject: ContestLayoutObject };

const CONTEST_TEXTURE_PREFIX = "contest_layout";
const MAX_APPEAL_HEARTS = 8;
const MAX_JAM_HEARTS = 8;
const CURTAIN_TRAVEL_DISTANCE = 161;
const CURTAIN_TWEEN_DURATION = 450;
const FALLBACK_CONTEST_MOVES = [
  MoveId.TACKLE,
  MoveId.GROWL,
  MoveId.TAIL_WHIP,
  MoveId.QUICK_ATTACK,
] as const;

let contestUi: ContestUi | undefined;
let contestAssetsLoading: Promise<void> | undefined;

export function getContestUi(): ContestUi {
  contestUi ??= new ContestUi();
  return contestUi;
}

export function destroyContestUi(): void {
  contestUi?.destroy();
  contestUi = undefined;
}

export function ensureContestUiAssetsLoaded(): Promise<void> {
  const missingAssets = getContestLayoutSpriteObjects()
    .filter(object => object.assetPath && !globalScene.textures.exists(getContestLayoutTextureKey(object)))
    .filter((object, index, objects) =>
      objects.findIndex(candidate => candidate.assetPath === object.assetPath) === index,
    );

  if (missingAssets.length === 0) {
    return Promise.resolve();
  }

  if (contestAssetsLoading) {
    return contestAssetsLoading;
  }

  contestAssetsLoading = new Promise(resolve => {
    for (const object of missingAssets) {
      const assetPath = getRuntimeImagePath(object);
      if (assetPath) {
        globalScene.load.image(getContestLayoutTextureKey(object), getCachedUrl(assetPath));
      }
    }

    globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      contestAssetsLoading = undefined;
      resolve();
    });
    globalScene.load.start();
  });

  return contestAssetsLoading;
}

export class ContestUi {
  private readonly container: Phaser.GameObjects.Container;
  private readonly sprites: ContestLayoutSprite[] = [];
  private readonly textFields: ContestLayoutText[] = [];
  private curtainSprite: ContestLayoutSprite | undefined;
  private curtainBaseY = 0;
  private curtainVisible = false;
  private messageText = "";
  private commandSelectionIndex = 0;

  constructor() {
    this.container = globalScene.add.container(0, 0);
    this.container.setVisible(false);
    this.container.setName("contest-ui");
    globalScene.field.add(this.container);

    for (const object of contestLayout.objects.slice().sort((a, b) => a.z - b.z)) {
      if (object.kind === "sprite") {
        this.addSprite(object);
      } else if (object.kind === "text-field") {
        this.addTextField(object);
      }
    }
  }

  showPhase(phaseName: string, contestState: ContestState): void {
    this.container.setVisible(true);

    for (const sprite of this.sprites) {
      sprite.setVisible(this.shouldShowSprite(sprite.layoutObject, phaseName, contestState));
    }

    for (const textField of this.textFields) {
      const text = this.getTextFieldText(textField.layoutObject, phaseName, contestState);
      textField.setText(text);
      textField.setVisible(text.length > 0 && textField.layoutObject.phaseAppearance.includes(phaseName));
    }
  }

  setCommandSelection(index: number, contestState: ContestState): void {
    const moves = getContestPlayerMoves(contestState);
    this.commandSelectionIndex = clampMoveSelection(index, moves.length);
    this.showPhase("ContestCommandPhase", contestState);
  }

  getCommandSelectionIndex(): number {
    return this.commandSelectionIndex;
  }

  showMessage(phaseName: string, contestState: ContestState, message: string): void {
    this.messageText = message;
    this.showPhase(phaseName, contestState);
  }

  clearMessage(): void {
    this.messageText = "";
  }

  lowerCurtain(): Promise<void> {
    return this.animateCurtain(true);
  }

  raiseCurtain(): Promise<void> {
    return this.animateCurtain(false);
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private addSprite(object: ContestLayoutObject): void {
    if (!object.assetPath) {
      return;
    }

    const sprite = globalScene.add.image(object.x, object.y, getContestLayoutTextureKey(object))
      .setOrigin(0)
      .setDisplaySize(object.width, object.height) as ContestLayoutSprite;
    sprite.layoutObject = object;
    if (object.key.toLowerCase().includes("contest_curtain")) {
      this.curtainSprite = sprite;
      this.curtainBaseY = object.y;
      sprite.setY(this.getCurtainRaisedY());
      sprite.setVisible(false);
    }
    this.container.add(sprite);
    this.sprites.push(sprite);
  }

  private addTextField(object: ContestLayoutObject): void {
    const text = addTextObject(object.x, object.y, "", TextStyle.MESSAGE, {
      fixedWidth: object.width * 6,
      fixedHeight: object.height * 6,
      fontSize: "48px",
      maxLines: 4,
      wordWrap: { width: object.width * 6 },
    }) as ContestLayoutText;
    text.layoutObject = object;
    text.setOrigin(0);
    this.container.add(text);
    this.textFields.push(text);
  }

  private shouldShowSprite(object: ContestLayoutObject, phaseName: string, contestState: ContestState): boolean {
    const key = object.key.toLowerCase();
    const label = object.label.toLowerCase();
    const isCommandPhase = phaseName === "ContestCommandPhase";

    if (key.includes("contest_curtain")) {
      return this.curtainVisible;
    }

    if (label.includes("contest benched contestant backsplash") || label.includes("contest current contestant backsplash")) {
      if (isCommandPhase && !object.phaseAppearance.includes(phaseName)) {
        return false;
      }

      return shouldShowContestantBacksplash(object, phaseName, contestState);
    }

    if (label === "contest benched good condition star") {
      if (isCommandPhase && !object.phaseAppearance.includes(phaseName)) {
        return false;
      }

      return shouldShowGoodConditionStar(object, phaseName, contestState);
    }

    if (!object.phaseAppearance.includes(phaseName)) {
      return false;
    }

    if (key.includes("audience_idle_frame")) {
      return shouldShowAudienceFrame(key, contestState);
    }

    if (key.includes("contest_dialogue_box")) {
      return !isCommandPhase;
    }

    if (key.includes("contest_move_selector")) {
      return isCommandPhase && isPlayerCommandPhase(contestState) && shouldShowMoveSelectorPiece(key, contestState, this.commandSelectionIndex);
    }

    if (label.includes(" contest banner")) {
      return label.includes(getContestTypeLayoutName(contestState.contestType));
    }

    if (label.includes(" rank banner")) {
      return contestState.rank != null && label.includes(getContestRankLayoutName(contestState.rank));
    }

    if (key.includes("applause_meter_dot_flash")) {
      return false;
    }

    if (key.includes("applause_meter_dot")) {
      return getCopyIndex(key) < contestState.applause;
    }

    if (label === "contest benched appeal heart" || label === "contest benched appeal heart jammed") {
      return shouldShowBenchedAppealHeart(key, label, contestState);
    }

    if (label === "contest benched stand out heart") {
      return false;
    }

    if (key.includes("status_condition")) {
      return false;
    }

    if (key.includes("judge_call")) {
      return false;
    }

    if (key.includes("scorecard_")) {
      return phaseName === "ContestEndPhase" && shouldShowEndScoreSprite(key, contestState);
    }

    return true;
  }

  private getTextFieldText(object: ContestLayoutObject, phaseName: string, contestState: ContestState): string {
    const role = object.role;
    const scheduledSlot = getScheduledSlotIndex(object);

    if (this.messageText && role === "general_text") {
      return this.messageText;
    }

    if (role === "appeal_slot_pokemon_name" && scheduledSlot != null) {
      return getContestantPokemonName(contestState.getOrderedContestants()[scheduledSlot]);
    }

    if (role === "appeal_slot_trainer_name" && scheduledSlot != null) {
      return contestState.getOrderedContestants()[scheduledSlot]?.name ?? "";
    }

    if (role === "move_selector" && phaseName === "ContestCommandPhase" && isPlayerCommandPhase(contestState)) {
      return getPlayerMoveSelectorText(contestState, this.commandSelectionIndex);
    }

    if (role === "move_description" && phaseName === "ContestCommandPhase" && isPlayerCommandPhase(contestState)) {
      return getPlayerMoveDescription(contestState, this.commandSelectionIndex);
    }

    if (role === "general_text") {
      return getGeneralContestText(phaseName, contestState);
    }

    if (role === "dialogue") {
      return getDialogueText(phaseName, contestState);
    }

    return "";
  }

  private animateCurtain(lower: boolean): Promise<void> {
    if (!this.curtainSprite) {
      return Promise.resolve();
    }

    if (!lower && !this.curtainVisible) {
      return Promise.resolve();
    }

    const curtainSprite = this.curtainSprite;
    this.curtainVisible = true;
    curtainSprite.setVisible(true);
    curtainSprite.setY(lower ? this.getCurtainRaisedY() : this.curtainBaseY);

    return new Promise(resolve => {
      globalScene.tweens.killTweensOf(curtainSprite);
      globalScene.tweens.add({
        targets: curtainSprite,
        y: lower ? this.curtainBaseY : this.getCurtainRaisedY(),
        duration: CURTAIN_TWEEN_DURATION,
        ease: "Quad.easeInOut",
        onComplete: () => {
          this.curtainVisible = lower;
          curtainSprite.setVisible(lower);
          resolve();
        },
      });
    });
  }

  private getCurtainRaisedY(): number {
    return this.curtainBaseY - CURTAIN_TRAVEL_DISTANCE;
  }
}

function getContestLayoutTextureKey(object: ContestLayoutObject): string {
  return `${CONTEST_TEXTURE_PREFIX}_${normalizeTexturePart(object.assetPath ?? object.key)}`;
}

function getRuntimeImagePath(object: ContestLayoutObject): string | undefined {
  return object.assetPath?.replace(/^assets\/images\//, "images/");
}

function normalizeTexturePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/^assets\/images\//, "")
    .replace(/\.png$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function shouldShowAudienceFrame(key: string, contestState: ContestState): boolean {
  const isMaxApplause = contestState.applause >= contestState.maxApplause;
  return isMaxApplause ? key.endsWith("frame_3") : key.endsWith("frame_1");
}

function shouldShowMoveSelectorPiece(key: string, contestState: ContestState, selectionIndex: number): boolean {
  const previewMove = getPreviewContestMove(contestState, selectionIndex);
  const moveData = previewMove != null ? getContestSpectacularMove(previewMove) : undefined;

  if (key.includes("type_")) {
    return key.includes(getContestTypeLayoutName(moveData?.contestType ?? contestState.contestType));
  }

  if (key.includes("jam_heart")) {
    return getMoveSelectorHeartIndex(key) <= Math.min(moveData?.jam ?? 0, MAX_JAM_HEARTS);
  }

  if (key.includes("heart")) {
    return getMoveSelectorHeartIndex(key) <= Math.min(moveData?.appeal ?? 0, MAX_APPEAL_HEARTS);
  }

  return true;
}

function shouldShowEndScoreSprite(key: string, contestState: ContestState): boolean {
  if (key.includes("heart_flash") || key.includes("star_flash")) {
    return false;
  }

  if (key.includes("winner")) {
    return contestState.contestants.some(contestant => contestant.totalScore > 0);
  }

  return key.includes("empty");
}

function shouldShowBenchedAppealHeart(key: string, label: string, contestState: ContestState): boolean {
  const heartPosition = getBenchedAppealHeartPosition(key);
  if (!heartPosition) {
    return false;
  }

  const contestant = contestState.getOrderedContestants()[heartPosition.slotIndex];
  if (!contestant) {
    return false;
  }

  const score = contestant.roundScore;
  const isJammedHeart = label.includes("jammed") || key.endsWith("_jammed");

  if (isJammedHeart) {
    return score < 0 && heartPosition.heartIndex <= Math.abs(score);
  }

  return score > 0 && heartPosition.heartIndex <= score;
}

function shouldShowContestantBacksplash(
  object: ContestLayoutObject,
  phaseName: string,
  contestState: ContestState,
): boolean {
  const slotIndex = getScheduleRowSlotIndex(object);
  const activeSlotIndex = getActiveScheduleSlotIndex(phaseName, contestState);
  const isActiveBacksplash = object.label.toLowerCase().includes("current contestant backsplash");

  if (slotIndex == null) {
    return false;
  }

  return isActiveBacksplash ? slotIndex === activeSlotIndex : slotIndex !== activeSlotIndex;
}

function shouldShowGoodConditionStar(
  object: ContestLayoutObject,
  phaseName: string,
  contestState: ContestState,
): boolean {
  if (!isContestSchedulePhase(phaseName)) {
    return false;
  }

  const starPosition = getGoodConditionStarPosition(object);
  if (!starPosition) {
    return false;
  }

  const contestant = contestState.getOrderedContestants()[starPosition.slotIndex];
  return (contestant?.conditionStars ?? 0) >= starPosition.starIndex;
}

function getActiveScheduleSlotIndex(phaseName: string, contestState: ContestState): number | undefined {
  const orderedContestants = contestState.getOrderedContestants();

  if (phaseName === "ContestCommandPhase") {
    if (!contestState.currentCommandContestantId) {
      return undefined;
    }

    const activeSlotIndex = orderedContestants.findIndex(contestant => contestant.id === contestState.currentCommandContestantId);
    return activeSlotIndex >= 0 ? activeSlotIndex : undefined;
  }

  if (phaseName === "ContestAppealPhase") {
    const nextContestantIndex = contestState.currentRoundAppeals.length;
    return nextContestantIndex < orderedContestants.length ? nextContestantIndex : undefined;
  }

  if (phaseName === "ContestAppealResultPhase") {
    const lastAppealId = contestState.currentRoundAppeals.at(-1);
    return lastAppealId ? orderedContestants.findIndex(contestant => contestant.id === lastAppealId) : undefined;
  }

  return undefined;
}

function getScheduleRowSlotIndex(object: ContestLayoutObject): number | undefined {
  if (object.y < 0) {
    return undefined;
  }

  return Math.max(Math.round(object.y / 40), 0);
}

function getGoodConditionStarPosition(object: ContestLayoutObject): { slotIndex: number; starIndex: number } | undefined {
  if (object.y < 0) {
    return undefined;
  }

  const rowY = object.y % 40;
  return {
    slotIndex: Math.floor(object.y / 40),
    starIndex: rowY >= 20 ? 2 : 1,
  };
}

function getBenchedAppealHeartPosition(key: string): { slotIndex: number; heartIndex: number } | undefined {
  const normalizedKey = key.replace(/_jammed$/, "");
  const match = normalizedKey.match(/^contest_benched(?:_appeal)?(?:_heart)?_(\d+)_(\d+)$/);

  if (!match) {
    return undefined;
  }

  return {
    slotIndex: Number(match[1]) - 1,
    heartIndex: Number(match[2]),
  };
}

function getContestTypeLayoutName(contestType: ContestType): string {
  return contestType.toLowerCase();
}

function getContestRankLayoutName(rank: ContestRank): string {
  return rank.toLowerCase();
}

function getCopyIndex(key: string): number {
  return key.split("_copy").length - 1;
}

function getMoveSelectorHeartIndex(key: string): number {
  return key.includes("heart_empty") ? 1 : getCopyIndex(key) + 2;
}

function isPlayerCommandPhase(contestState: ContestState): boolean {
  return contestState.currentCommandContestantId
    ? !!contestState.getContestant(contestState.currentCommandContestantId).pokemon
    : false;
}

function isContestSchedulePhase(phaseName: string): boolean {
  return [
    "ContestRoundStartPhase",
    "ContestCommandPhase",
    "ContestAppealPhase",
    "ContestAppealResultPhase",
    "ContestRoundScoringPhase",
    "ContestRoundEndPhase",
  ].includes(phaseName);
}

function getScheduledSlotIndex(object: ContestLayoutObject): number | undefined {
  if (object.role === "appeal_slot_pokemon_name" || object.role === "appeal_slot_trainer_name") {
    return Math.max(Math.round((object.y - 8) / 40), 0);
  }

  const match = object.key.match(/(?:slot|contestant)_(\d+)/i) ?? object.label.match(/(?:slot|contestant)\s*(\d+)/i);
  if (!match) {
    return undefined;
  }

  return Number(match[1]) - 1;
}

function getContestantPokemonName(contestant: ContestParticipant | undefined): string {
  return contestant?.pokemon?.getNameToRender() ?? contestant?.pokemonNickname ?? "";
}

export function getContestPlayerMoves(contestState: ContestState): readonly MoveId[] {
  const contestant = contestState.contestants.find(candidate => candidate.pokemon) ?? contestState.contestants[0];

  if (contestant?.contestMoves && contestant.contestMoves.length > 0) {
    return contestant.contestMoves;
  }

  const moves = contestant?.pokemon
    ?.getMoveset()
    .map(move => move.moveId)
    .filter(moveId => moveId !== MoveId.NONE)
    ?? [];

  return moves.length > 0 ? moves : FALLBACK_CONTEST_MOVES;
}

function getPlayerMoveSelectorText(contestState: ContestState, selectionIndex: number): string {
  const moves = getContestPlayerMoves(contestState);
  const selectedIndex = clampMoveSelection(selectionIndex, moves.length);

  return moves
    .map((moveId, index) => `${index === selectedIndex ? ">" : " "} ${allMoves[moveId]?.name ?? moveId}`)
    .join("\n");
}

function getPlayerMoveDescription(contestState: ContestState, selectionIndex: number): string {
  const previewMove = getPreviewContestMove(contestState, selectionIndex);
  const moveData = previewMove != null ? getContestSpectacularMove(previewMove) : undefined;

  if (!moveData) {
    return "No contest data exists for this move.";
  }

  return getContestSpectacularEffect(moveData.effectId).flavorText;
}

function getPreviewContestMove(contestState: ContestState, selectionIndex: number) {
  const moves = getContestPlayerMoves(contestState);
  return moves[clampMoveSelection(selectionIndex, moves.length)];
}

function clampMoveSelection(selectionIndex: number, moveCount: number): number {
  if (moveCount <= 0) {
    return 0;
  }

  return ((selectionIndex % moveCount) + moveCount) % moveCount;
}

function getGeneralContestText(phaseName: string, contestState: ContestState): string {
  switch (phaseName) {
    case "ContestStartPhase":
      return "The contest is about to begin!";
    case "ContestIntroScorePhase":
      return "Primary judging is complete.";
    case "ContestRoundStartPhase":
      return `Round ${contestState.round}`;
    case "ContestRoundScoringPhase":
      return `Round ${contestState.round} results`;
    case "ContestEndPhase":
      return "Contest results";
    default:
      return "";
  }
}

function getDialogueText(phaseName: string, contestState: ContestState): string {
  if (phaseName === "ContestAppealPhase") {
    const contestant = contestState.getOrderedContestants()[contestState.currentRoundAppeals.length];
    return contestant ? `${getContestantPokemonName(contestant)} is appealing!` : "";
  }

  if (phaseName === "ContestAppealResultPhase") {
    const lastAppealId = contestState.currentRoundAppeals.at(-1);
    const contestant = lastAppealId ? contestState.getContestant(lastAppealId) : undefined;
    return contestant ? `${getContestantPokemonName(contestant)} is appealing!` : "";
  }

  return "";
}
