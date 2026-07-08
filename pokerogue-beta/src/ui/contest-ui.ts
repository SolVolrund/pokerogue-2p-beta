import { globalScene } from "#app/global-scene";
import { AnimConfig, initMoveAnim, loadMoveAnimAssets, moveAnims } from "#data/battle-anims";
import { allMoves } from "#data/data-lists";
import { playContestAppealHeartChange } from "#data/contests/contest-audio";
import { contestCoordinatorConfigs } from "#data/contests/contest-coordinator-types";
import { CONTEST_AD_REEL_MESSAGES, CONTEST_CHAT_MESSAGES, CONTEST_CHAT_NAMES } from "#data/contests/contest-live-feed";
import { ContestRank } from "#data/contests/contest-opponents";
import {
  ContestSpectacularEffectBehavior,
  getContestSpectacularEffect,
} from "#data/contests/contest-spectacular-effects";
import { contestLayout, getContestLayoutSpriteObjects } from "#data/contests/contest-layout";
import type { ContestLayoutObject } from "#data/contests/contest-layout";
import { getContestSpectacularMove } from "#data/contests/contest-spectacular-moves";
import { ContestJamProtection, type ContestParticipant, type ContestState } from "#data/contests/contest-state";
import { ContestType, contestTypeData } from "#data/contests/contest-type";
import { AnimBlendType, AnimFocus, AnimFrameTarget } from "#enums/move-anims-common";
import { MoveId } from "#enums/move-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { TextStyle } from "#enums/text-style";
import { trainerConfigs } from "#trainers/trainer-config";
import { addTextObject } from "#ui/text";
import { getFrameMs } from "#utils/common";
import { getCachedUrl } from "#utils/fetch-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";

type ContestLayoutSprite = Phaser.GameObjects.Image & { layoutObject: ContestLayoutObject };
type ContestLayoutText = Phaser.GameObjects.Text & { layoutObject: ContestLayoutObject };
type ContestAnimFrame = {
  x: number;
  y: number;
  zoomX?: number;
  zoomY?: number;
  angle?: number;
  mirror?: boolean;
  visible?: boolean;
  blendType?: AnimBlendType;
  target: AnimFrameTarget;
  graphicFrame?: number;
  opacity?: number;
  tone?: number[];
  locked?: boolean;
  priority?: number;
  focus?: AnimFocus;
};
type ContestAnimTimedEvent = {
  execute: (battleAnim: { bgSprite?: Phaser.GameObjects.TileSprite | Phaser.GameObjects.Rectangle }, priority?: number) => number;
  getEventType: () => string;
  resourceName?: string;
};
type ContestGraphicFrameData = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  angle: number;
};
type ContestPoint = {
  x: number;
  y: number;
};
type ContestTextFieldStyle = Phaser.Types.GameObjects.Text.TextStyle & {
  maxLines: number;
};
type ContestFeedTokens = Record<string, string>;
type ContestLiveFeedState = {
  sessionKey: string;
  latestStep: number;
  messages: string[];
};

const CONTEST_TEXTURE_PREFIX = "contest_layout";
const MAX_APPEAL_HEARTS = 8;
const MAX_JAM_HEARTS = 8;
const CURTAIN_TRAVEL_DISTANCE = 161;
const CURTAIN_TWEEN_DURATION = 450;
const FALLBACK_CONTEST_PERFORMER_ACTIVE_POINT = { x: 111, y: 118 } satisfies ContestPoint;
const FALLBACK_CONTEST_PERFORMER_HIDDEN_POINT = { x: 111, y: 220 } satisfies ContestPoint;
const FALLBACK_CONTEST_MOVE_TARGET_POINT = { x: 44, y: 92 } satisfies ContestPoint;
const FALLBACK_CONTEST_INTRO_TRAINER_STANDING_POINT = { x: 92, y: 36 } satisfies ContestPoint;
const FALLBACK_CONTEST_INTRO_TRAINER_HIDDEN_POINT = { x: 348, y: 36 } satisfies ContestPoint;
const FALLBACK_CONTEST_INTRO_POKEMON_STANDING_POINT = { x: 109, y: 53 } satisfies ContestPoint;
const FALLBACK_CONTEST_INTRO_POKEMON_HIDDEN_POINT = { x: 333, y: 53 } satisfies ContestPoint;
const CONTEST_MOVE_TARGET_HALF_HEIGHT = 24;
const CONTEST_PERFORMER_ENTER_DURATION = 700;
const CONTEST_PERFORMER_EXIT_DURATION = 550;
const CONTEST_PERFORMER_PRE_MOVE_DELAY = 200;
const CONTEST_PERFORMER_POST_MOVE_DELAY = 250;
const CONTEST_SCORE_HEART_TICK_DURATION = 140;
const CONTEST_INTRO_ENTER_DURATION = 650;
const CONTEST_INTRO_EXIT_DURATION = 500;
const CONTEST_INTRO_NAME_HOLD_DURATION = 800;
const CONTEST_INTRO_SCORE_HOLD_DURATION = 900;
const CONTEST_INTRO_SPRITE_SCALE = 0.5;
const CONTEST_AUDIENCE_FRAME_DURATION = 64;
const CONTEST_CHAT_STREAM_MAX_MESSAGES = 30;
const CONTEST_AD_REEL_MAX_MESSAGES = 3;
const CONTEST_FEED_EXTRA_MESSAGE_CHANCE = 4;
const MOVE_ANIM_USER_FOCUS_X = 106;
const MOVE_ANIM_USER_FOCUS_Y = 116;
const MOVE_ANIM_TARGET_FOCUS_X = 234;
const MOVE_ANIM_TARGET_FOCUS_Y = 52;
const FALLBACK_CONTEST_MOVES = [
  MoveId.TACKLE,
  MoveId.GROWL,
  MoveId.TAIL_WHIP,
  MoveId.QUICK_ATTACK,
] as const;

function getContestTextFieldStyle(object: ContestLayoutObject): ContestTextFieldStyle {
  switch (object.role) {
    case "move_selector":
      return { fontSize: "72px", maxLines: 4 };
    case "move_description":
      return { fontSize: "64px", maxLines: 3 };
    case "contest_chat_stream":
      return { fontSize: "30px", maxLines: CONTEST_CHAT_STREAM_MAX_MESSAGES };
    case "contest_ad_reel":
      return { fontSize: "36px", maxLines: 1 };
    default:
      return { fontSize: "48px", maxLines: 4 };
  }
}

function getContestTextFieldMaxLines(object: ContestLayoutObject): number {
  return getContestTextFieldStyle(object).maxLines;
}

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
  private performerSprite: Phaser.GameObjects.Sprite | undefined;
  private readonly introSprites: Phaser.GameObjects.Sprite[] = [];
  private readonly displayedRoundScores = new Map<string, number>();
  private audienceAnimationTimer: Phaser.Time.TimerEvent | undefined;
  private audienceFrameToggle = false;
  private currentPhaseName = "";
  private currentContestState: ContestState | undefined;
  private messageText = "";
  private commandSelectionIndex = 0;
  private readonly chatFeedState = createContestLiveFeedState();
  private readonly adFeedState = createContestLiveFeedState();

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
    this.currentPhaseName = phaseName;
    this.currentContestState = contestState;
    this.updateContestLiveFeed(phaseName, contestState);

    for (const sprite of this.sprites) {
      sprite.setVisible(this.shouldShowSprite(sprite.layoutObject, phaseName, contestState));
    }

    for (const textField of this.textFields) {
      const text = this.getTextFieldText(textField.layoutObject, phaseName, contestState);
      textField.setText(text);
      textField.setVisible(text.length > 0 && textField.layoutObject.phaseAppearance.includes(phaseName));
    }

    this.startAudienceAnimation();
  }

  private updateContestLiveFeed(phaseName: string, contestState: ContestState): void {
    const sessionKey = getContestFeedSessionKey(contestState);
    this.updateContestLiveFeedState(this.chatFeedState, sessionKey, "chat", phaseName, contestState);
    this.updateContestLiveFeedState(this.adFeedState, sessionKey, "ad", phaseName, contestState);
  }

  private updateContestLiveFeedState(
    state: ContestLiveFeedState,
    sessionKey: string,
    kind: "chat" | "ad",
    phaseName: string,
    contestState: ContestState,
  ): void {
    const latestStep = getContestFeedStep(phaseName, contestState);

    if (state.sessionKey !== sessionKey || (phaseName === "ContestStartPhase" && latestStep < state.latestStep)) {
      state.sessionKey = sessionKey;
      state.latestStep = -1;
      state.messages = [];
    }

    if (latestStep <= state.latestStep) {
      return;
    }

    const templates = kind === "chat" ? CONTEST_CHAT_MESSAGES : CONTEST_AD_REEL_MESSAGES;
    const messageCount = getContestFeedMessageCount(kind, latestStep);
    const newMessages: string[] = [];

    for (let messageIndex = 0; messageIndex < messageCount; messageIndex++) {
      const template = getContestFeedTemplate(templates, kind, latestStep, messageIndex);
      const tokens = getContestFeedTokens(phaseName, contestState, kind, latestStep, messageIndex);
      newMessages.push(formatContestFeedTemplate(template, tokens));
    }

    state.messages.unshift(...newMessages.reverse());
    state.messages.length = Math.min(state.messages.length, getContestLiveFeedMaxMessages(kind));
    state.latestStep = latestStep;
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

  getMessagePages(message: string): string[] {
    const textField = this.textFields.find(field => field.layoutObject.role === "general_text");
    if (!textField) {
      return [message];
    }

    const maxLines = getContestTextFieldMaxLines(textField.layoutObject);
    const wrappedLines = textField.runWordWrap(message).split(/\n/g);
    const pages: string[] = [];

    for (let lineIndex = 0; lineIndex < wrappedLines.length; lineIndex += maxLines) {
      pages.push(wrappedLines.slice(lineIndex, lineIndex + maxLines).join("\n"));
    }

    return pages.length > 0 ? pages : [""];
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

  async playContestantAppeal(contestant: ContestParticipant, moveId: MoveId): Promise<void> {
    this.destroyPerformerSprite();

    const activePoint = getContestLayoutPoint("contest_performer_active_point", FALLBACK_CONTEST_PERFORMER_ACTIVE_POINT);
    const hiddenPoint = getContestLayoutPoint("contest_performer_hidden_point", FALLBACK_CONTEST_PERFORMER_HIDDEN_POINT);
    const targetPoint = getContestLayoutPoint("contest_move_target_point", FALLBACK_CONTEST_MOVE_TARGET_POINT);
    const textureKey = await loadContestantPokemonSpriteAssets(contestant, true);
    if (!textureKey) {
      return waitContestDuration(CONTEST_PERFORMER_POST_MOVE_DELAY);
    }

    const performerSprite = this.createPerformerSprite(contestant, textureKey, hiddenPoint, true);
    this.performerSprite = performerSprite;
    this.container.addAt(performerSprite, this.getStageActorInsertIndex());
    this.initializeContestPokemonSprite(performerSprite, contestant);
    this.restoreContestLayoutLayering();

    await tweenContestSpriteTo(performerSprite, activePoint, CONTEST_PERFORMER_ENTER_DURATION);
    await waitContestDuration(CONTEST_PERFORMER_PRE_MOVE_DELAY);
    await playContestMoveAnimation(moveId, performerSprite, targetPoint);
    await waitContestDuration(CONTEST_PERFORMER_POST_MOVE_DELAY);
  }

  async playContestantAppealExit(): Promise<void> {
    if (!this.performerSprite) {
      return;
    }

    const performerSprite = this.performerSprite;
    const hiddenPoint = getContestLayoutPoint("contest_performer_hidden_point", FALLBACK_CONTEST_PERFORMER_HIDDEN_POINT);
    await tweenContestSpriteTo(performerSprite, hiddenPoint, CONTEST_PERFORMER_EXIT_DURATION);

    if (this.performerSprite === performerSprite) {
      this.performerSprite = undefined;
    }
    performerSprite.destroy();
  }

  async animateAppealScoreChanges(
    contestState: ContestState,
    previousScores: ReadonlyMap<string, number>,
  ): Promise<void> {
    const changedContestants = contestState.getOrderedContestants()
      .map(contestant => ({
        id: contestant.id,
        from: previousScores.get(contestant.id) ?? 0,
        to: contestant.roundScore,
      }))
      .filter(change => change.from !== change.to);

    if (changedContestants.length === 0) {
      return;
    }

    for (const change of changedContestants) {
      this.displayedRoundScores.set(change.id, change.from);
    }
    this.showPhase("ContestAppealResultPhase", contestState);

    for (const change of changedContestants) {
      let displayedScore = change.from;
      let scoreStepIndex = 0;
      while (displayedScore !== change.to) {
        displayedScore += displayedScore < change.to ? 1 : -1;
        this.displayedRoundScores.set(change.id, displayedScore);
        this.showPhase("ContestAppealResultPhase", contestState);
        playContestAppealHeartChange(scoreStepIndex);
        scoreStepIndex++;
        await waitContestDuration(CONTEST_SCORE_HEART_TICK_DURATION);
      }
    }

    for (const change of changedContestants) {
      this.displayedRoundScores.delete(change.id);
    }
    this.showPhase("ContestAppealResultPhase", contestState);
  }

  async playIntroJudging(contestState: ContestState): Promise<void> {
    this.destroyIntroSprites();
    this.showPhase("ContestIntroScorePhase", contestState);

    for (const contestant of contestState.contestants) {
      const pokemonName = getContestantPokemonName(contestant) || "Pokemon";
      const trainerStandingPoint = getContestLayoutPoint(
        "contest_intro_trainer_standing_point",
        FALLBACK_CONTEST_INTRO_TRAINER_STANDING_POINT,
      );
      const trainerHiddenPoint = getContestLayoutPoint(
        "contest_intro_trainer_hidden_point",
        FALLBACK_CONTEST_INTRO_TRAINER_HIDDEN_POINT,
      );
      const pokemonStandingPoint = getContestLayoutPoint(
        "contest_intro_pokemon_standing_point",
        FALLBACK_CONTEST_INTRO_POKEMON_STANDING_POINT,
      );
      const pokemonHiddenPoint = getContestLayoutPoint(
        "contest_intro_pokemon_hidden_point",
        FALLBACK_CONTEST_INTRO_POKEMON_HIDDEN_POINT,
      );

      const [trainerSprite, pokemonSprite] = await Promise.all([
        this.createIntroTrainerSprite(contestant, trainerHiddenPoint),
        this.createIntroPokemonSprite(contestant, pokemonHiddenPoint),
      ]);
      let actorInsertIndex = this.getStageActorInsertIndex();
      if (trainerSprite) {
        this.container.addAt(trainerSprite, actorInsertIndex);
        actorInsertIndex++;
        trainerSprite.setPipeline(globalScene.spritePipeline, { tone: [0.0, 0.0, 0.0, 0.0], hasShadow: false });
      }
      if (pokemonSprite) {
        this.container.addAt(pokemonSprite, actorInsertIndex);
        this.initializeContestPokemonSprite(pokemonSprite, contestant);
      }
      this.restoreContestLayoutLayering();
      const sprites = [trainerSprite, pokemonSprite].filter(sprite => !!sprite);
      this.introSprites.push(...sprites);

      this.showMessage("ContestIntroScorePhase", contestState, `${contestant.name} and ${pokemonName} take the stage!`);
      await Promise.all([
        trainerSprite ? tweenContestSpriteTo(trainerSprite, trainerStandingPoint, CONTEST_INTRO_ENTER_DURATION) : undefined,
        pokemonSprite ? tweenContestSpriteTo(pokemonSprite, pokemonStandingPoint, CONTEST_INTRO_ENTER_DURATION) : undefined,
      ]);
      await waitContestDuration(CONTEST_INTRO_NAME_HOLD_DURATION);

      this.showMessage(
        "ContestIntroScorePhase",
        contestState,
        `${pokemonName}'s primary judging score: ${contestState.getPrimaryJudgingScore(contestant.id)} (${contestState.getIntroJudgingHearts(contestant.id)} hearts, +${contestState.getIntroJudgingFinalScore(contestant.id)})`,
      );
      await waitContestDuration(CONTEST_INTRO_SCORE_HOLD_DURATION);

      await Promise.all([
        trainerSprite ? tweenContestSpriteTo(trainerSprite, trainerHiddenPoint, CONTEST_INTRO_EXIT_DURATION) : undefined,
        pokemonSprite ? tweenContestSpriteTo(pokemonSprite, pokemonHiddenPoint, CONTEST_INTRO_EXIT_DURATION) : undefined,
      ]);
      this.destroyIntroSprites();
    }

    this.clearMessage();
    this.showPhase("ContestIntroScorePhase", contestState);
  }

  destroy(): void {
    this.audienceAnimationTimer?.remove(false);
    this.destroyPerformerSprite();
    this.destroyIntroSprites();
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
      ...getContestTextFieldStyle(object),
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
      return shouldShowAudienceFrame(key, contestState, this.audienceFrameToggle);
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
      return shouldShowBenchedAppealHeart(key, label, contestState, this.displayedRoundScores);
    }

    if (label === "contest benched stand out heart") {
      return false;
    }

    if (key.includes("status_condition")) {
      return shouldShowContestStatusCondition(object, phaseName, contestState);
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

    if (role === "contest_chat_stream") {
      return getContestChatStreamText(this.chatFeedState.messages);
    }

    if (role === "contest_ad_reel") {
      return getContestAdReelText(this.adFeedState.messages);
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

  private startAudienceAnimation(): void {
    if (this.audienceAnimationTimer) {
      return;
    }

    this.audienceAnimationTimer = globalScene.time.addEvent({
      delay: getFrameMs(CONTEST_AUDIENCE_FRAME_DURATION),
      loop: true,
      callback: () => {
        this.audienceFrameToggle = !this.audienceFrameToggle;
        this.updateAudienceFrameVisibility();
      },
    });
  }

  private updateAudienceFrameVisibility(): void {
    if (!this.currentContestState || !this.container.visible) {
      return;
    }

    for (const sprite of this.sprites) {
      if (sprite.layoutObject.key.toLowerCase().includes("audience_idle_frame")) {
        sprite.setVisible(this.shouldShowSprite(sprite.layoutObject, this.currentPhaseName, this.currentContestState));
      }
    }
  }

  private createPerformerSprite(
    contestant: ContestParticipant,
    textureKey: string,
    point: ContestPoint,
    flipX: boolean,
    scaleMultiplier = 1,
  ): Phaser.GameObjects.Sprite {
    const performerSprite = globalScene.addFieldSprite(point.x, point.y, textureKey);

    performerSprite
      .setName(`contest-performer-${contestant.id}`)
      .setOrigin(0.5, 1)
      .setFlipX(flipX)
      .setScale((contestant.pokemon?.getSpriteScale() ?? 1) * scaleMultiplier);
    performerSprite.play(textureKey);

    return performerSprite;
  }

  private initializeContestPokemonSprite(sprite: Phaser.GameObjects.Sprite, contestant: ContestParticipant): void {
    globalScene.initPokemonSprite(sprite, contestant.pokemon);
  }

  private async createIntroPokemonSprite(
    contestant: ContestParticipant,
    point: ContestPoint,
  ): Promise<Phaser.GameObjects.Sprite | undefined> {
    const textureKey = await loadContestantPokemonSpriteAssets(contestant, false);
    if (!textureKey) {
      return undefined;
    }

    const sprite = this.createPerformerSprite(contestant, textureKey, point, false, CONTEST_INTRO_SPRITE_SCALE);
    sprite.setName(`contest-intro-pokemon-${contestant.id}`);

    return sprite;
  }

  private async createIntroTrainerSprite(
    contestant: ContestParticipant,
    point: ContestPoint,
  ): Promise<Phaser.GameObjects.Sprite | undefined> {
    const textureKey = await loadContestantTrainerSpriteAssets(contestant);
    if (!textureKey) {
      return undefined;
    }

    const sprite = globalScene.addFieldSprite(point.x, point.y, textureKey);
    sprite
      .setName(`contest-intro-trainer-${contestant.id}`)
      .setOrigin(0.5, 1)
      .setScale(CONTEST_INTRO_SPRITE_SCALE);
    sprite.play(textureKey);

    return sprite;
  }

  private getStageActorInsertIndex(): number {
    let backdropIndex = -1;

    this.container.getAll().forEach((child, index) => {
      const layoutObject = (child as Partial<ContestLayoutSprite>).layoutObject;
      if (layoutObject && isContestStageBackdropObject(layoutObject)) {
        backdropIndex = index;
      }
    });

    return backdropIndex >= 0 ? backdropIndex + 1 : this.container.length;
  }

  private restoreContestLayoutLayering(): void {
    this.container.getAll()
      .filter(child => {
        const layoutObject = (child as Partial<ContestLayoutSprite>).layoutObject;
        return layoutObject && !isContestStageBackdropObject(layoutObject);
      })
      .sort((a, b) => {
        const aLayoutObject = (a as Partial<ContestLayoutSprite>).layoutObject!;
        const bLayoutObject = (b as Partial<ContestLayoutSprite>).layoutObject!;
        return aLayoutObject.z - bLayoutObject.z;
      })
      .forEach(child => this.container.bringToTop(child));
  }

  private destroyPerformerSprite(): void {
    if (this.performerSprite) {
      globalScene.tweens.killTweensOf(this.performerSprite);
    }
    this.performerSprite?.destroy();
    this.performerSprite = undefined;
  }

  private destroyIntroSprites(): void {
    for (const sprite of this.introSprites) {
      globalScene.tweens.killTweensOf(sprite);
      sprite.destroy();
    }
    this.introSprites.length = 0;
  }
}

async function loadContestantPokemonSpriteAssets(contestant: ContestParticipant, back: boolean): Promise<string | undefined> {
  if (contestant.pokemon) {
    const textureKey = contestant.pokemon.getBattleSpriteKey(back, false);
    if (!isPokemonSpriteReady(textureKey)) {
      await loadContestPokemonAtlas(textureKey, contestant.pokemon.getBattleSpriteAtlasPath(back, false));
    }

    return isPokemonSpriteReady(textureKey) ? textureKey : undefined;
  }

  if (!contestant.pokemonSpecies) {
    return undefined;
  }

  const species = getPokemonSpecies(contestant.pokemonSpecies);
  const textureKey = species.getSpriteKey(false, undefined, false, undefined, back);
  if (!isPokemonSpriteReady(textureKey)) {
    await loadContestPokemonAtlas(textureKey, species.getSpriteAtlasPath(false, undefined, false, undefined, back));
  }

  return isPokemonSpriteReady(textureKey) ? textureKey : undefined;
}

function isPokemonSpriteReady(textureKey: string): boolean {
  return globalScene.textures.exists(textureKey) && globalScene.anims.exists(textureKey);
}

function ensurePokemonSpriteAnimation(textureKey: string): void {
  if (!globalScene.textures.exists(textureKey) || globalScene.anims.exists(textureKey)) {
    return;
  }

  const originalWarn = console.warn;
  console.warn = () => {};
  const frameNames = globalScene.anims.generateFrameNames(textureKey, {
    zeroPad: 4,
    suffix: ".png",
    start: 1,
    end: 400,
  });
  console.warn = originalWarn;
  globalScene.anims.create({
    key: textureKey,
    frames: frameNames,
    frameRate: 10,
    repeat: -1,
  });
}

function loadContestPokemonAtlas(textureKey: string, atlasPath: string): Promise<void> {
  if (globalScene.textures.exists(textureKey)) {
    ensurePokemonSpriteAnimation(textureKey);
    return Promise.resolve();
  }

  globalScene.loadPokemonAtlas(textureKey, atlasPath);

  return new Promise(resolve => {
    globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      ensurePokemonSpriteAnimation(textureKey);
      resolve();
    });

    if (!globalScene.load.isLoading()) {
      globalScene.load.start();
    }
  });
}

async function loadContestantTrainerSpriteAssets(contestant: ContestParticipant): Promise<string | undefined> {
  const explicitSpriteKey = contestant.spriteKey;
  const coordinatorSpriteKey = getContestantCoordinatorSpriteKey(contestant);
  const trainerType = getContestantTrainerType(contestant);
  const config = trainerType !== undefined ? trainerConfigs[trainerType] : undefined;
  const textureKey = explicitSpriteKey ?? coordinatorSpriteKey ?? config?.getSpriteKey(false, false);

  if (!textureKey) {
    return undefined;
  }

  if (isTrainerSpriteReady(textureKey)) {
    return textureKey;
  }

  if (config && textureKey === config.getSpriteKey(false, false)) {
    await config.loadAssets(TrainerVariant.DEFAULT);
  } else {
    await loadContestTrainerAtlas(textureKey);
  }

  return isTrainerSpriteReady(textureKey) ? textureKey : undefined;
}

function getContestantTrainerType(contestant: ContestParticipant): TrainerType | undefined {
  if (contestant.trainerType !== undefined) {
    return contestant.trainerType;
  }

  if (contestant.coordinatorType !== undefined) {
    return contestCoordinatorConfigs[contestant.coordinatorType]?.trainerType ?? TrainerType.ACE_TRAINER;
  }

  return TrainerType.ACE_TRAINER;
}

function getContestantCoordinatorSpriteKey(contestant: ContestParticipant): string | undefined {
  if (contestant.coordinatorType === undefined) {
    return undefined;
  }

  const config = contestCoordinatorConfigs[contestant.coordinatorType];
  return config.trainerType === undefined || config.spriteKey ? config.getSpriteKey() : undefined;
}

function isTrainerSpriteReady(textureKey: string): boolean {
  return globalScene.textures.exists(textureKey) && globalScene.anims.exists(textureKey);
}

function loadContestTrainerAtlas(textureKey: string): Promise<void> {
  if (globalScene.textures.exists(textureKey)) {
    ensureTrainerSpriteAnimation(textureKey);
    return Promise.resolve();
  }

  globalScene.loadAtlas(textureKey, "trainer");

  return new Promise(resolve => {
    globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      ensureTrainerSpriteAnimation(textureKey);
      resolve();
    });

    if (!globalScene.load.isLoading()) {
      globalScene.load.start();
    }
  });
}

function ensureTrainerSpriteAnimation(textureKey: string): void {
  if (!globalScene.textures.exists(textureKey) || globalScene.anims.exists(textureKey)) {
    return;
  }

  const originalWarn = console.warn;
  console.warn = () => {};
  const frameNames = globalScene.anims.generateFrameNames(textureKey, {
    zeroPad: 4,
    suffix: ".png",
    start: 1,
    end: 128,
  });
  console.warn = originalWarn;
  globalScene.anims.create({
    key: textureKey,
    frames: frameNames,
    frameRate: 24,
    repeat: -1,
  });
}

async function playContestMoveAnimation(
  moveId: MoveId,
  performerSprite: Phaser.GameObjects.Sprite,
  targetPoint: ContestPoint,
): Promise<void> {
  if (moveId === MoveId.NONE) {
    return;
  }

  await initMoveAnim(moveId);
  await loadMoveAnimAssets([moveId], true);

  const anim = getContestMoveAnim(moveId);
  if (!anim || anim.frames.length === 0) {
    return;
  }

  return playContestAnimConfig(anim, performerSprite, targetPoint);
}

function getContestMoveAnim(moveId: MoveId): AnimConfig | undefined {
  const anim = moveAnims.get(moveId);
  if (anim instanceof AnimConfig) {
    return anim;
  }

  return Array.isArray(anim) ? anim[0] : undefined;
}

function playContestAnimConfig(
  anim: AnimConfig,
  performerSprite: Phaser.GameObjects.Sprite,
  targetPoint: ContestPoint,
): Promise<void> {
  const spriteCache: Phaser.GameObjects.Sprite[] = [];
  const baseX = performerSprite.x;
  const baseY = performerSprite.y;
  const baseScaleX = performerSprite.scaleX;
  const baseScaleY = performerSprite.scaleY;
  const baseAlpha = performerSprite.alpha;
  const baseAngle = performerSprite.angle;
  const contestAnimShim: { bgSprite?: Phaser.GameObjects.TileSprite | Phaser.GameObjects.Rectangle } = {};

  return new Promise(resolve => {
    let frameIndex = 0;

    const cleanUpAndComplete = () => {
      for (const sprite of spriteCache) {
        sprite.destroy();
      }
      contestAnimShim.bgSprite?.destroy();
      performerSprite
        .setPosition(baseX, baseY)
        .setScale(baseScaleX, baseScaleY)
        .setAlpha(baseAlpha)
        .setAngle(baseAngle)
        .setVisible(true);
      performerSprite.pipelineData["tone"] = [0.0, 0.0, 0.0, 0.0];
      resolve();
    };

    if (!globalScene.moveAnimations) {
      cleanUpAndComplete();
      return;
    }

    globalScene.tweens.addCounter({
      duration: getFrameMs(3),
      repeat: anim.frames.length,
      onRepeat: () => {
        if (frameIndex >= anim.frames.length) {
          return;
        }

        const frames = anim.frames[frameIndex] as ContestAnimFrame[];
        let graphicFrameCount = 0;
        let performerFrameApplied = false;

        for (const frame of frames) {
          const frameData = getContestAnimFrameData(frame, performerSprite, targetPoint);

          if (frame.target === AnimFrameTarget.GRAPHIC && anim.graphic) {
            if (graphicFrameCount === spriteCache.length) {
              const moveSprite = globalScene.addFieldSprite(0, 0, anim.graphic, 1);
              globalScene.field.add(moveSprite);
              spriteCache.push(moveSprite);
            }

            const moveSprite = spriteCache[graphicFrameCount];
            graphicFrameCount++;
            moveSprite
              .setFrame(frame.graphicFrame ?? 0)
              .setPosition(frameData.x, frameData.y)
              .setAngle(frameData.angle)
              .setScale(frameData.scaleX, frameData.scaleY)
              .setAlpha((frame.opacity ?? 255) / 255)
              .setVisible(frame.visible ?? true)
              .setBlendMode(getContestAnimBlendMode(frame.blendType));
            globalScene.field.bringToTop(moveSprite);
          } else if (frame.target === AnimFrameTarget.USER && !performerFrameApplied) {
            performerFrameApplied = true;
            const performerHalfHeight = performerSprite.displayHeight / 2;
            performerSprite
              .setPosition(frameData.x, frameData.y + performerHalfHeight)
              .setAngle(frameData.angle)
              .setScale(baseScaleX * Math.abs(frameData.scaleX), baseScaleY * frameData.scaleY)
              .setAlpha((frame.opacity ?? 255) / 255)
              .setVisible(frame.visible ?? true);
            performerSprite.pipelineData["tone"] = frame.tone ?? [0.0, 0.0, 0.0, 0.0];
          }
        }

        if (!performerFrameApplied) {
          performerSprite
            .setPosition(baseX, baseY)
            .setScale(baseScaleX, baseScaleY)
            .setAlpha(baseAlpha)
            .setAngle(baseAngle)
            .setVisible(true);
          performerSprite.pipelineData["tone"] = [0.0, 0.0, 0.0, 0.0];
        }

        for (const sprite of spriteCache.slice(graphicFrameCount)) {
          if (!sprite.getData("locked")) {
            spriteCache.splice(spriteCache.indexOf(sprite), 1);
            sprite.destroy();
          }
        }

        const timedEvents = anim.frameTimedEvents.get(frameIndex) as ContestAnimTimedEvent[] | undefined;
        for (const event of timedEvents ?? []) {
          if (event.getEventType() === "AnimTimedSoundEvent" && event.resourceName) {
            event.execute(contestAnimShim);
          }
        }

        frameIndex++;
      },
      onComplete: () => cleanUpAndComplete(),
    });
  });
}

function getContestAnimFrameData(
  frame: ContestAnimFrame,
  performerSprite: Phaser.GameObjects.Sprite,
  targetPoint: ContestPoint,
): ContestGraphicFrameData {
  let x = frame.x + MOVE_ANIM_USER_FOCUS_X;
  let y = frame.y + MOVE_ANIM_USER_FOCUS_Y;
  let scaleX = ((frame.zoomX ?? 100) / 100) * (frame.mirror ? -1 : 1);
  const scaleY = (frame.zoomY ?? 100) / 100;
  const performerHalfHeight = performerSprite.displayHeight / 2;
  const focus = frame.focus ?? AnimFocus.TARGET;

  if (frame.target === AnimFrameTarget.USER && focus !== AnimFocus.SCREEN) {
    const point = transformContestAnimPoint(
      MOVE_ANIM_USER_FOCUS_X,
      MOVE_ANIM_USER_FOCUS_Y,
      MOVE_ANIM_TARGET_FOCUS_X,
      MOVE_ANIM_TARGET_FOCUS_Y,
      performerSprite.x,
      performerSprite.y - performerHalfHeight,
      targetPoint.x,
      targetPoint.y - CONTEST_MOVE_TARGET_HALF_HEIGHT,
      x,
      y,
    );

    return {
      x: point[0],
      y: point[1],
      scaleX,
      scaleY,
      angle: -(frame.angle ?? 0),
    };
  }

  switch (focus) {
    case AnimFocus.TARGET:
      x += targetPoint.x - MOVE_ANIM_TARGET_FOCUS_X;
      y += targetPoint.y - CONTEST_MOVE_TARGET_HALF_HEIGHT - MOVE_ANIM_TARGET_FOCUS_Y;
      if (frame.target === AnimFrameTarget.GRAPHIC && isContestAnimationMirrored(performerSprite, targetPoint)) {
        x = targetPoint.x - (x - targetPoint.x);
        scaleX *= -1;
      }
      break;
    case AnimFocus.USER:
      x += performerSprite.x - MOVE_ANIM_USER_FOCUS_X;
      y += performerSprite.y - performerHalfHeight - MOVE_ANIM_USER_FOCUS_Y;
      if (frame.target === AnimFrameTarget.GRAPHIC && isContestAnimationMirrored(performerSprite, targetPoint)) {
        x = performerSprite.x - (x - performerSprite.x);
        scaleX *= -1;
      }
      break;
    case AnimFocus.USER_TARGET:
      {
        const point = transformContestAnimPoint(
          MOVE_ANIM_USER_FOCUS_X,
          MOVE_ANIM_USER_FOCUS_Y,
          MOVE_ANIM_TARGET_FOCUS_X,
          MOVE_ANIM_TARGET_FOCUS_Y,
          performerSprite.x,
          performerSprite.y - performerHalfHeight,
          targetPoint.x,
          targetPoint.y - CONTEST_MOVE_TARGET_HALF_HEIGHT,
          x,
          y,
        );
        x = point[0];
        y = point[1];
        if (
          frame.target === AnimFrameTarget.GRAPHIC
          && isContestAnimationMirrored(performerSprite, targetPoint)
        ) {
          scaleX *= -1;
        }
      }
      break;
    case AnimFocus.SCREEN:
      {
        const performerFocusY = performerSprite.y - performerHalfHeight;
        x = performerSprite.x - (x - MOVE_ANIM_USER_FOCUS_X);
        y = performerFocusY + (y - MOVE_ANIM_USER_FOCUS_Y);
        if (frame.target === AnimFrameTarget.GRAPHIC) {
          scaleX *= -1;
        }
      }
      break;
  }

  return {
    x,
    y,
    scaleX,
    scaleY,
    angle: -(frame.angle ?? 0),
  };
}

function getContestAnimBlendMode(blendType: AnimBlendType | undefined): Phaser.BlendModes {
  switch (blendType) {
    case AnimBlendType.ADD:
      return Phaser.BlendModes.ADD;
    case AnimBlendType.SUBTRACT:
      return Phaser.BlendModes.DIFFERENCE;
    default:
      return Phaser.BlendModes.NORMAL;
  }
}

function transformContestAnimPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
  px: number,
  py: number,
): [x: number, y: number] {
  const intersect = getContestAnimAxisIntersect(x1, y1, x2, y2, px, py);
  return repositionContestAnimPoint(x3, y3, x4, y4, intersect[0], intersect[1]);
}

function getContestAnimAxisIntersect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  px: number,
  py: number,
): [x: number, y: number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return [
    dx === 0 ? 0 : (px - x1) / dx,
    dy === 0 ? 0 : (py - y1) / dy,
  ];
}

function repositionContestAnimPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tx: number,
  ty: number,
): [x: number, y: number] {
  return [
    x1 + tx * (x2 - x1),
    y1 + ty * (y2 - y1),
  ];
}

function isContestAnimationMirrored(performerSprite: Phaser.GameObjects.Sprite, targetPoint: ContestPoint): boolean {
  return isContestAnimReversed(MOVE_ANIM_USER_FOCUS_X, MOVE_ANIM_TARGET_FOCUS_X, performerSprite.x, targetPoint.x);
}

function isContestAnimReversed(src1: number, src2: number, dst1: number, dst2: number): boolean {
  if (src1 === src2) {
    return false;
  }

  return src1 < src2 ? dst1 > dst2 : dst1 < dst2;
}

function tweenContestSpriteTo(
  sprite: Phaser.GameObjects.Sprite,
  point: ContestPoint,
  duration: number,
): Promise<void> {
  return new Promise(resolve => {
    globalScene.tweens.killTweensOf(sprite);
    globalScene.tweens.add({
      targets: sprite,
      x: point.x,
      y: point.y,
      duration,
      ease: "Quad.easeInOut",
      onComplete: () => resolve(),
    });
  });
}

function waitContestDuration(duration: number): Promise<void> {
  return new Promise(resolve => {
    globalScene.time.delayedCall(duration, () => resolve());
  });
}

function getContestLayoutPoint(role: string, fallback: ContestPoint): ContestPoint {
  const object = contestLayout.objects.find(candidate =>
    candidate.kind === "marker" && (candidate.role === role || candidate.key === role),
  );

  return object ? { x: object.x, y: object.y } : fallback;
}

function isContestStageBackdropObject(object: ContestLayoutObject): boolean {
  const key = object.key.toLowerCase();
  return key === "contest_background" || key.includes("audience_idle_frame") || key === "contest_judge";
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

function shouldShowAudienceFrame(key: string, contestState: ContestState, frameToggle: boolean): boolean {
  const isMaxApplause = contestState.applause >= contestState.maxApplause;
  if (isMaxApplause) {
    return key.endsWith(frameToggle ? "frame_4" : "frame_3");
  }

  return key.endsWith(frameToggle ? "frame_2" : "frame_1");
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

function shouldShowBenchedAppealHeart(
  key: string,
  label: string,
  contestState: ContestState,
  displayedRoundScores: ReadonlyMap<string, number>,
): boolean {
  const heartPosition = getBenchedAppealHeartPosition(key);
  if (!heartPosition) {
    return false;
  }

  const contestant = contestState.getOrderedContestants()[heartPosition.slotIndex];
  if (!contestant) {
    return false;
  }

  const score = displayedRoundScores.get(contestant.id) ?? contestant.roundScore;
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

function shouldShowContestStatusCondition(
  object: ContestLayoutObject,
  phaseName: string,
  contestState: ContestState,
): boolean {
  const slotIndex = getScheduleRowSlotIndex(object);
  if (slotIndex == null) {
    return false;
  }

  const iconKey = getContestStatusIconKeyFromObject(object);
  if (!iconKey) {
    return false;
  }

  const contestant = contestState.getOrderedContestants()[slotIndex];
  if (!contestant) {
    return false;
  }

  if (iconKey === "at_risk") {
    return !getContestStatusIconKey(contestant) && isContestantAtRiskOfNervousness(contestant, phaseName, contestState);
  }

  return getContestStatusIconKey(contestant) === iconKey;
}

function getContestStatusIconKey(contestant: ContestParticipant): string | undefined {
  if (contestant.cannotAppeal || contestant.skipNextRound) {
    return "lost_turn";
  }

  if (contestant.nervous) {
    return "nervous";
  }

  if (contestant.jamProtection === ContestJamProtection.FULL_ROUND) {
    return "oblivious";
  }

  if (contestant.jamProtection === ContestJamProtection.NEXT_JAM) {
    return "settled_down";
  }

  return;
}

function getContestStatusIconKeyFromObject(object: ContestLayoutObject): string | undefined {
  const label = object.label.toLowerCase();
  const key = object.key.toLowerCase();

  if (label.includes("at risk") || key.includes("at_risk")) {
    return "at_risk";
  }

  if (label.includes("lost turn") || key.includes("lost_turn")) {
    return "lost_turn";
  }

  if (label.includes("nervous") || key.includes("nervous")) {
    return "nervous";
  }

  if (label.includes("settled down") || key.includes("settled_down")) {
    return "settled_down";
  }

  if (label.includes("oblivious") || key.includes("oblivious") || key.includes("idk")) {
    return "oblivious";
  }

  return;
}

function isContestantAtRiskOfNervousness(
  contestant: ContestParticipant,
  phaseName: string,
  contestState: ContestState,
): boolean {
  if (phaseName !== "ContestAppealResultPhase") {
    return false;
  }

  const sourceContestantId = contestState.currentRoundAppeals.at(-1);
  if (!sourceContestantId) {
    return false;
  }

  const sourceContestant = contestState.getContestant(sourceContestantId);
  if (sourceContestant.cannotAppeal || sourceContestant.nervous) {
    return false;
  }

  const moveData = getContestSpectacularMove(sourceContestant.lastMoveId ?? MoveId.NONE);
  if (!moveData) {
    return false;
  }

  const effect = getContestSpectacularEffect(moveData.effectId);
  if (effect.behavior !== ContestSpectacularEffectBehavior.MAKE_FOLLOWING_NERVOUS) {
    return false;
  }

  return contestState.getRemainingContestants(sourceContestantId).some(target => target.id === contestant.id);
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
  if (!contestState.currentCommandContestantId) {
    return false;
  }

  const contestant = contestState.getContestant(contestState.currentCommandContestantId);
  const playerIndex = contestant.pokemon ? globalScene.getPlayerIndexForPokemon(contestant.pokemon) : undefined;

  return !!contestant.pokemon && (playerIndex === undefined || !globalScene.isComputerPartnerPlayer(playerIndex));
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
  const contestant = contestState.currentCommandContestantId
    ? contestState.getContestant(contestState.currentCommandContestantId)
    : contestState.contestants.find(candidate => candidate.pokemon) ?? contestState.contestants[0];

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

function createContestLiveFeedState(): ContestLiveFeedState {
  return {
    sessionKey: "",
    latestStep: -1,
    messages: [],
  };
}

function getContestLiveFeedMaxMessages(kind: "chat" | "ad"): number {
  return kind === "chat" ? CONTEST_CHAT_STREAM_MAX_MESSAGES : CONTEST_AD_REEL_MAX_MESSAGES;
}

function getContestChatStreamText(messages: readonly string[]): string {
  return messages.slice(0, CONTEST_CHAT_STREAM_MAX_MESSAGES).join("\n");
}

function getContestAdReelText(messages: readonly string[]): string {
  return messages.slice(0, CONTEST_AD_REEL_MAX_MESSAGES).join(" | ");
}

function getContestFeedStep(phaseName: string, contestState: ContestState): number {
  const round = Math.max(0, contestState.round);
  const appealCount = contestState.currentRoundAppeals.length;
  const contestantCount = Math.max(1, contestState.contestants.length);

  switch (phaseName) {
    case "ContestStartPhase":
      return 0;
    case "ContestIntroScorePhase":
      return 1;
    case "ContestRoundStartPhase":
      return round * 100;
    case "ContestCommandPhase":
      return round * 100 + 1 + appealCount * 3;
    case "ContestAppealPhase":
      return round * 100 + 2 + appealCount * 3;
    case "ContestAppealResultPhase":
      return round * 100 + 3 + Math.max(0, appealCount - 1) * 3;
    case "ContestRoundScoringPhase":
      return round * 100 + 1 + contestantCount * 3;
    case "ContestRoundEndPhase":
      return round * 100 + 2 + contestantCount * 3;
    case "ContestEndPhase":
      return (contestState.totalRounds + 1) * 100;
    default:
      return round * 100 + appealCount;
  }
}

function getContestFeedSessionKey(contestState: ContestState): string {
  const contestantKeys = contestState.contestants
    .map(contestant => `${contestant.id}:${contestant.name}:${getContestantPokemonName(contestant)}`)
    .join("|");

  return [
    globalScene.seed ?? "",
    globalScene.currentBattle?.waveIndex ?? 0,
    contestState.contestType,
    contestState.rank ?? "",
    contestantKeys,
  ].join(":");
}

function getContestFeedMessageCount(kind: "chat" | "ad", step: number): number {
  if (kind !== "chat") {
    return 1;
  }

  return getContestFeedSeededIndex(`${kind}:extra:${step}`, CONTEST_FEED_EXTRA_MESSAGE_CHANCE) === 0 ? 2 : 1;
}

function getContestFeedTemplate(
  templates: readonly string[],
  kind: "chat" | "ad",
  step: number,
  messageIndex: number,
): string {
  return templates[getContestFeedSeededIndex(`${kind}:template:${step}:${messageIndex}`, templates.length)] ?? "";
}

function getContestFeedSeededIndex(key: string, range: number): number {
  if (range <= 1) {
    return 0;
  }

  const seed = `${globalScene.seed ?? ""}:${globalScene.currentBattle?.waveIndex ?? 0}`;
  return getContestFeedHash(`${seed}:${key}`) % range;
}

function getContestFeedHash(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function getContestFeedTokens(
  phaseName: string,
  contestState: ContestState,
  kind: "chat" | "ad",
  step: number,
  messageIndex: number,
): ContestFeedTokens {
  const contestant = getContestFeedContestant(phaseName, contestState);
  const leader = getContestLeader(contestState);
  const lastPlace = getContestLastPlace(contestState);

  return {
    CHAT_NAME: kind === "chat" ? getContestChatName(step, messageIndex) : "",
    CHAT_NAME_2: kind === "chat" ? getContestChatName(step, messageIndex, 2) : "",
    CHAT_NAME_3: kind === "chat" ? getContestChatName(step, messageIndex, 3) : "",
    CHAT_NAME_4: kind === "chat" ? getContestChatName(step, messageIndex, 4) : "",
    CHAT_NAME_5: kind === "chat" ? getContestChatName(step, messageIndex, 5) : "",
    applause: `${contestState.applause}/${contestState.maxApplause}`,
    contestType: contestTypeData[contestState.contestType].name,
    leader: getContestantPokemonName(leader) || "the field",
    leaderScore: `${leader?.totalScore ?? 0}`,
    leaderTrainer: leader?.name ?? "Someone",
    last: getContestantPokemonName(lastPlace) || "the field",
    lastPokemon: getContestantPokemonName(lastPlace) || "the field",
    lastScore: `${lastPlace?.totalScore ?? 0}`,
    lastTrainer: lastPlace?.name ?? "Someone",
    pokemon: getContestantPokemonName(contestant) || "the next act",
    round: `${Math.max(1, contestState.round)}`,
    score: `${leader?.totalScore ?? 0}`,
    trainer: contestant?.name ?? "Someone",
  };
}

function getContestChatName(step: number, messageIndex: number, nameOffset = 1): string {
  const chatNames: readonly string[] = CONTEST_CHAT_NAMES;
  if (chatNames.length === 0) {
    return "Contest Fan";
  }

  return chatNames[getContestFeedSeededIndex(`chat:name:${step}:${messageIndex}:${nameOffset}`, chatNames.length)]
    ?? "Contest Fan";
}

function getContestFeedContestant(phaseName: string, contestState: ContestState): ContestParticipant | undefined {
  if (phaseName === "ContestAppealPhase") {
    return contestState.getOrderedContestants()[contestState.currentRoundAppeals.length];
  }

  if (phaseName === "ContestAppealResultPhase") {
    const lastAppealId = contestState.currentRoundAppeals.at(-1);
    return lastAppealId ? contestState.getContestant(lastAppealId) : undefined;
  }

  if (contestState.currentCommandContestantId) {
    return contestState.getContestant(contestState.currentCommandContestantId);
  }

  return getContestLeader(contestState);
}

function getContestLeader(contestState: ContestState): ContestParticipant | undefined {
  return contestState.getOrderedContestants()
    .slice()
    .sort((a, b) => b.totalScore - a.totalScore)[0];
}

function getContestLastPlace(contestState: ContestState): ContestParticipant | undefined {
  return contestState.getOrderedContestants()
    .slice()
    .sort((a, b) => a.totalScore - b.totalScore)[0];
}

function formatContestFeedTemplate(template: string, tokens: ContestFeedTokens): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, token: string) => tokens[token] ?? "");
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
