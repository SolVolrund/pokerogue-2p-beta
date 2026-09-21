import { pokerogueApi } from "#api/api";
import { loggedInUser } from "#app/account";
import type { PlayerIndex } from "#app/battle-scene";
import { GameMode, getGameMode } from "#app/game-mode";
import { audioManager } from "#app/global-audio-manager";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { activeOverrides } from "#app/overrides";
import { Phase } from "#app/phase";
import type { TwoPlayerTitleStart } from "#app/two-player-input-transport";
import { bypassLogin } from "#constants/app-constants";
import { getDailyRunStarters, startDailyEventChallenges } from "#data/daily-seed/daily-run";
import { modifierTypes } from "#data/data-lists";
import { Gender } from "#data/gender";
import { BattleType } from "#enums/battle-type";
import { GameDataType } from "#enums/game-data-type";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import { getBiomeAssetKey } from "#field/arena";
import type { Modifier } from "#modifiers/modifier";
import { getDailyRunStarterModifiers, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { ChallengeData } from "#system/challenge-data";
import { vouchers } from "#system/voucher";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import type { ChallengeSelectConfig } from "#ui/challenges-select-ui-handler";
import { SaveSlotUiMode } from "#ui/save-slot-select-ui-handler";
import { isLocalServerConnected, randomString } from "#utils/common";
import {
  COMPUTER_PARTNER_KEYS,
  type ComputerPartnerKey,
  type ComputerPartnerRole,
  type ComputerPartnerRolePreferences,
  getComputerPartnerProfile,
  getComputerPartnerChallengeProfile,
  isComputerPartnerKey as isKnownComputerPartnerKey,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

const NO_SAVE_SLOT = -1;
const TWO_PLAYER_LOBBY_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TWO_PLAYER_WS_PORT = "8787";
const COMPUTER_PARTNER_MENU_ROWS = 6;
const COMPUTER_PARTNER_MENU_MIN_SLOT_COUNT = 30;
type MultiplayerLobbyPlayerCount = 1 | 2 | 3;
type MultiplayerGuestSeat = 1 | 2 | "ep";

function getTwoPlayerRunSeedOverride(): string | undefined {
  if (typeof window === "undefined") {
    return;
  }

  return new URLSearchParams(window.location.search).get("twoPlayerRunSeed") ?? undefined;
}

export class TitlePhase extends Phase {
  public readonly phaseName = "TitlePhase";
  private loaded = false;
  private remoteTitleStartApplied = false;
  private selectedChallenges: ChallengeData[] = [];
  private profileStartupAnnounceInterval: ReturnType<typeof globalThis.setInterval> | undefined;
  // TODO: Make `end` take a `GameModes` as a parameter rather than storing it on the class itself
  public gameMode: GameModes;

  async start(): Promise<void> {
    super.start();

    globalScene.setTwoPlayerTitleStartHandler(titleStart => this.applyRemoteTwoPlayerTitleStart(titleStart));

    globalScene.ui.clearText();
    globalScene.ui.fadeIn(250);

    const now = new Date();
    if (now.getMonth() === 11 || (now.getMonth() === 0 && now.getDate() <= 15)) {
      audioManager.playBgm("winter_title", true);
    } else {
      audioManager.playBgm("title", true);
    }

    const lastSlot = await this.checkLastSaveSlot();
    if (this.remoteTitleStartApplied) {
      return;
    }

    const pendingTitleStart = globalScene.consumePendingTwoPlayerTitleStart();
    if (pendingTitleStart && this.applyRemoteTwoPlayerTitleStart(pendingTitleStart)) {
      return;
    }

    await this.showOptions(lastSlot);
  }

  /**
   * If a user is logged in, check the last save slot they loaded and adjust various variables
   * to account for it.
   * @returns A Promise that resolves with the last loaded session's slot ID.
   * Returns `NO_SAVE_SLOT` if not logged in or no session was found.
   */
  private async checkLastSaveSlot(): Promise<number> {
    if (loggedInUser == null) {
      return NO_SAVE_SLOT;
    }
    try {
      const sessionData = await globalScene.gameData.getSession(loggedInUser.lastSessionSlot);
      if (!sessionData) {
        return NO_SAVE_SLOT;
      }

      globalScene.sessionSlotId = loggedInUser.lastSessionSlot;
      // Set the BG texture to the last save's current biome
      const biomeKey = getBiomeAssetKey(sessionData.arena.biome);
      const bgTexture = `${biomeKey}_bg`;
      await globalScene.loadBiomeAssets(sessionData.arena.biome);
      globalScene.arenaBg.setTexture(bgTexture);
      return loggedInUser.lastSessionSlot;
    } catch (err) {
      console.error(err);
      return NO_SAVE_SLOT;
    }
  }

  private async showOptions(lastSessionSlot: number): Promise<void> {
    const options: OptionSelectItem[] = [];
    const continueOption: OptionSelectItem = {
      label: i18next.t("continue", { ns: "menu" }),
      handler: () => {
        if (lastSessionSlot > NO_SAVE_SLOT) {
          this.loadSaveSlot(lastSessionSlot);
          return true;
        }

        return false;
      },
    };
    if (lastSessionSlot <= NO_SAVE_SLOT) {
      continueOption.style = TextStyle.SETTINGS_LOCKED;
    }
    options.push(continueOption);
    options.push(
      {
        label: i18next.t("menu:newGame"),
        handler: () => {
          this.showNewGameModeSelect();
          return true;
        },
      },
      {
        label: i18next.t("menu:loadGame"),
        handler: () => {
          globalScene.ui.setOverlayMode(UiMode.SAVE_SLOT, SaveSlotUiMode.LOAD, (slotId: number) => {
            if (slotId === NO_SAVE_SLOT) {
              console.warn("Attempted to load save slot of -1 through load game menu!");
              return this.showOptions(slotId);
            }
            this.loadSaveSlot(slotId);
          });
          return true;
        },
      },
      {
        label: "Save Data",
        handler: () => {
          this.showSaveDataSelect();
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Multiplayer",
        handler: () => {
          this.showMultiplayerSelect();
          return true;
        },
        keepOpen: true,
      },
      {
        label: i18next.t("menu:runHistory"),
        handler: () => {
          globalScene.ui.setOverlayMode(UiMode.RUN_HISTORY);
          return true;
        },
        keepOpen: true,
      },
      {
        label: i18next.t("menu:settings"),
        handler: () => {
          globalScene.ui.setOverlayMode(UiMode.SETTINGS);
          return true;
        },
        keepOpen: true,
      },
    );
    const config: OptionSelectConfig = {
      options,
      noCancel: true,
      yOffset: 47,
    };
    await globalScene.ui.setMode(UiMode.TITLE, config);
    this.waitForTitleHostInput();
  }

  private setModeAndEnd(gameMode: GameModes): void {
    if (!this.validateChallengePlayers(gameMode)) {
      return;
    }
    globalScene.setTwoPlayerTitleStartHandler(undefined);
    this.gameMode = gameMode;
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.clearText();
    this.end();
  }

  private showOptionSelect(
    options: OptionSelectItem[],
    configOverrides: Omit<OptionSelectConfig, "options"> = {},
  ): void {
    const config: OptionSelectConfig = { ...configOverrides, options };
    const showOptions = () => {
      if (globalScene.ui.getMode() === UiMode.OPTION_SELECT) {
        globalScene.ui.handlers[UiMode.OPTION_SELECT].show([config]);
        this.waitForTitleHostInput();
        return;
      }
      void globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, config).then(() => this.waitForTitleHostInput());
    };

    showOptions();
  }

  private waitForTitleHostInput(): void {
    if (!globalScene.twoPlayerMode) {
      return;
    }

    globalScene.waitForPlayerInput(0);
  }

  private showOptionSelectWithText(
    text: string,
    options: OptionSelectItem[],
    configOverrides: Omit<OptionSelectConfig, "options"> = {},
  ): void {
    globalScene.ui.showText(text, null, () => this.showOptionSelect(options, configOverrides));
  }

  private showMultiplayerSelect(): void {
    const options: OptionSelectItem[] = [
      {
        label: "Host 2P",
        handler: () => {
          this.showMultiplayerLobbyTeamSizeSelect(2);
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Host 3P",
        handler: () => {
          this.showMultiplayerLobbyTeamSizeSelect(3);
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Host 2P+1C",
        handler: () => {
          this.showMultiplayerLobbyTeamSizeSelect(3, [2]);
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Host 1P.Vs.EP",
        handler: () => {
          this.hostEnemyPlayerLobby(1);
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Host 2P.Vs.EP",
        handler: () => {
          this.hostEnemyPlayerLobby(2);
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Host 3P.Vs.EP",
        handler: () => {
          this.hostEnemyPlayerLobby(3);
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Join as 2P",
        handler: () => {
          this.joinMultiplayerLobby(1);
          return true;
        },
      },
      {
        label: "Join as 3P",
        handler: () => {
          this.joinMultiplayerLobby(2);
          return true;
        },
      },
      {
        label: "Join as EP",
        handler: () => {
          this.joinMultiplayerLobby("ep");
          return true;
        },
      },
      {
        label: i18next.t("menu:cancel"),
        handler: () => {
          globalScene.phaseManager.toTitleScreen();
          super.end();
          return true;
        },
      },
    ];

    this.showOptionSelectWithText("Multiplayer", options, { yOffset: 36 });
  }

  private showSaveDataSelect(): void {
    const options: OptionSelectItem[] = [
      {
        label: "Export Profile",
        handler: () => {
          void globalScene.gameData.tryExportData(GameDataType.SYSTEM);
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Import Profile",
        handler: () => {
          this.prepareTitleImportView();
          globalScene.gameData.importData(GameDataType.SYSTEM);
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Export Run",
        handler: () => {
          void this.showRunExportSlotSelect();
          return true;
        },
        keepOpen: true,
      },
      {
        label: "Import Run",
        handler: () => {
          this.showRunImportSlotSelect();
          return true;
        },
        keepOpen: true,
      },
      {
        label: i18next.t("menu:cancel"),
        handler: () => {
          globalScene.phaseManager.toTitleScreen();
          super.end();
          return true;
        },
      },
    ];

    this.showOptionSelectWithText("Save Data", options);
  }

  private getLimitedTeamSizeLabel(playerCount: 2 | 3): string {
    return playerCount === 3
      ? i18next.t("menu:twoPlayerTwoTwoTwoMode")
      : i18next.t("menu:twoPlayerThreeThreeMode");
  }

  private showMultiplayerLobbyTeamSizeSelect(
    playerCount: 2 | 3,
    computerPartnerPlayerIndexes: PlayerIndex[] = [],
  ): void {
    const startLobby = (partySize: 3 | 6) => {
      this.hostMultiplayerLobby(playerCount, partySize, computerPartnerPlayerIndexes);
    };

    const options: OptionSelectItem[] = [
      {
        label: i18next.t("menu:twoPlayerFullMode"),
        handler: () => {
          startLobby(6);
          return true;
        },
      },
      {
        label: this.getLimitedTeamSizeLabel(playerCount),
        handler: () => {
          startLobby(3);
          return true;
        },
      },
      {
        label: i18next.t("menu:cancel"),
        handler: () => {
          this.showMultiplayerSelect();
          return true;
        },
        keepOpen: true,
      },
    ];

    this.showOptionSelectWithText(i18next.t("menu:selectTeamSize"), options);
  }

  private async showRunExportSlotSelect(): Promise<void> {
    const dataSlots: number[] = [];
    await Promise.all(
      new Array(5).fill(null).map((_, slotId) =>
        globalScene.gameData.getSession(slotId).then(data => {
          if (data) {
            dataSlots.push(slotId);
          }
        }),
      ),
    );

    this.showRunSlotSelect(
      "Export Run",
      slotId => dataSlots.includes(slotId),
      slotId => {
        void globalScene.gameData.tryExportData(GameDataType.SESSION, slotId);
      },
    );
  }

  private showRunImportSlotSelect(): void {
    this.showRunSlotSelect(
      "Import Run",
      () => true,
      slotId => {
        this.prepareTitleImportView();
        globalScene.gameData.importData(GameDataType.SESSION, slotId);
      },
    );
  }

  private prepareTitleImportView(): void {
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.getMessageHandler().bringMessageToTop();
    globalScene.ui.clearText();
  }

  private showRunSlotSelect(
    title: string,
    slotEnabled: (slotId: number) => boolean,
    handler: (slotId: number) => void,
  ): void {
    const options = new Array(5)
      .fill(null)
      .map((_, slotId) => slotId)
      .map<OptionSelectItem>(slotId => {
        const enabled = slotEnabled(slotId);
        return {
          label: `Slot ${slotId + 1}`,
          handler: () => {
            if (!enabled) {
              return true;
            }
            handler(slotId);
            return true;
          },
          keepOpen: true,
          ...(enabled ? {} : { disabled: true, style: TextStyle.SETTINGS_LOCKED }),
        };
      });

    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        this.showSaveDataSelect();
        return true;
      },
      keepOpen: true,
    });

    this.showOptionSelectWithText(title, options);
  }

  private hostMultiplayerLobby(
    playerCount: MultiplayerLobbyPlayerCount,
    partySize: 3 | 6 = 6,
    computerPartnerPlayerIndexes: PlayerIndex[] = [],
    enemyPlayerMode = false,
  ): void {
    if (this.isLocalJoinHost(window.location.hostname)) {
      globalScene.ui.setMode(UiMode.LOBBY_IP_FORM, {
        buttonActions: [
          (lanAddress: string) => {
            this.showCreatedMultiplayerLobby(
              playerCount,
              partySize,
              this.normalizeLobbyLanAddress(lanAddress),
              computerPartnerPlayerIndexes,
              enemyPlayerMode,
            );
          },
          () => {
            void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.showMultiplayerSelect());
          },
        ],
      });
      return;
    }

    this.showCreatedMultiplayerLobby(playerCount, partySize, undefined, computerPartnerPlayerIndexes, enemyPlayerMode);
  }

  private hostEnemyPlayerLobby(playerCount: 1 | 2 | 3): void {
    this.hostMultiplayerLobby(playerCount, 6, [], true);
  }

  private showCreatedMultiplayerLobby(
    playerCount: MultiplayerLobbyPlayerCount,
    partySize: 3 | 6 = 6,
    lanAddress?: string,
    computerPartnerPlayerIndexes: PlayerIndex[] = [],
    enemyPlayerMode = false,
  ): void {
    const lobbyCode = this.generateLobbyCode();
    const hostLaunchUrl = this.getMultiplayerLobbyUrl(
      lobbyCode,
      "host",
      undefined,
      playerCount,
      partySize,
      undefined,
      computerPartnerPlayerIndexes,
      enemyPlayerMode,
    );
    const player2Url = this.getMultiplayerLobbyUrl(
      lobbyCode,
      "guest",
      lanAddress,
      playerCount,
      partySize,
      1,
      computerPartnerPlayerIndexes,
      enemyPlayerMode,
    );
    const player3Url =
      playerCount === 3 && !computerPartnerPlayerIndexes.includes(2)
        ? this.getMultiplayerLobbyUrl(
            lobbyCode,
            "guest",
            lanAddress,
            playerCount,
            partySize,
            2,
            computerPartnerPlayerIndexes,
            enemyPlayerMode,
          )
        : undefined;
    const enemyPlayerUrl = enemyPlayerMode
      ? this.getMultiplayerLobbyUrl(lobbyCode, "guest", lanAddress, playerCount, partySize, "ep", computerPartnerPlayerIndexes, true)
      : undefined;
    const hostAddress = this.getDisplayHostAddress(lanAddress);

    globalScene.ui.setMode(UiMode.LOBBY_INFO_FORM, {
      fields: [
        { label: "Lobby ID", value: lobbyCode },
        { label: "Web Address", value: hostAddress },
        {
          label: "Team Size",
          value:
            partySize === 6
              ? i18next.t("menu:twoPlayerFullMode")
              : playerCount === 1
                ? "Limited"
                : this.getLimitedTeamSizeLabel(playerCount),
        },
        ...(playerCount > 1 ? [{ label: "Player 2 Link", value: player2Url }] : []),
        ...(player3Url ? [{ label: "Player 3 Link", value: player3Url }] : []),
        ...(enemyPlayerUrl ? [{ label: "EP Link", value: enemyPlayerUrl }] : []),
        ...(computerPartnerPlayerIndexes.includes(2) ? [{ label: "Player 3", value: "CPU Partner" }] : []),
      ],
      buttonActions: [
        () => {
          if (playerCount > 1) {
            console.info(`[PokeRogue 2P] Player 2 lobby link: ${player2Url}`);
          }
          if (player3Url) {
            console.info(`[PokeRogue 2P] Player 3 lobby link: ${player3Url}`);
          }
          if (enemyPlayerUrl) {
            console.info(`[PokeRogue 2P] Enemy Player lobby link: ${enemyPlayerUrl}`);
          }
          void globalScene.ui.setMode(UiMode.MESSAGE).then(() => window.location.assign(hostLaunchUrl));
        },
        () => {
          void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.showMultiplayerSelect());
        },
      ],
    });
  }

  private joinMultiplayerLobby(guestSeat: MultiplayerGuestSeat): void {
    globalScene.ui.setMode(UiMode.LOBBY_JOIN_FORM, {
      buttonActions: [
        (input: string, hostAddress: string) => {
          const lobbyUrl = this.getJoinLobbyUrl(input, guestSeat, hostAddress);
          if (!lobbyUrl) {
            void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.showMultiplayerSelect());
            return;
          }
          void globalScene.ui.setMode(UiMode.MESSAGE).then(() => window.location.assign(lobbyUrl));
        },
        () => {
          void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.showMultiplayerSelect());
        },
      ],
    });
  }

  private generateLobbyCode(): string {
    const values = new Uint32Array(6);
    crypto.getRandomValues(values);
    return [...values].map(value => TWO_PLAYER_LOBBY_CODE_CHARS[value % TWO_PLAYER_LOBBY_CODE_CHARS.length]).join("");
  }

  private parseLobbyCode(input: string): string {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      return "";
    }

    const urlLobbyCode = this.parseLobbyCodeFromUrl(trimmedInput);
    if (urlLobbyCode !== undefined) {
      return urlLobbyCode;
    }

    if (this.looksLikeUrl(trimmedInput)) {
      return "";
    }

    return this.normalizeLobbyCode(trimmedInput);
  }

  private parseLobbyCodeFromUrl(input: string): string | undefined {
    try {
      const urlInput = this.needsUrlScheme(input) ? `${window.location.protocol}//${input}` : input;
      const url = new URL(urlInput, window.location.href);
      if (!this.looksLikeUrl(input)) {
        return;
      }

      const sessionId = url.searchParams.get("twoPlayerSession");
      return sessionId ? this.normalizeLobbyCode(sessionId) : "";
    } catch {
      return;
    }
  }

  private getJoinLobbyUrl(input: string, guestSeat: MultiplayerGuestSeat, hostAddress?: string): string {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      return "";
    }

    const lobbyUrl = this.parseLobbyUrl(trimmedInput);
    if (lobbyUrl) {
      const sessionId = lobbyUrl.searchParams.get("twoPlayerSession");
      if (!sessionId) {
        return "";
      }

      return this.configureMultiplayerLobbyUrl(
        lobbyUrl,
        this.normalizeLobbyCode(sessionId),
        "guest",
        undefined,
        undefined,
        guestSeat,
        [],
        guestSeat === "ep" || lobbyUrl.searchParams.get("twoPlayerEnemyPlayerMode") === "1",
      ).toString();
    }

    const lobbyCode = this.parseLobbyCode(trimmedInput);
    if (!lobbyCode) {
      return "";
    }

    const normalizedHostAddress = this.normalizeLobbyLanAddress(hostAddress ?? "");
    if (!normalizedHostAddress && this.isLocalJoinHost(window.location.hostname)) {
      return "";
    }

    return this.getMultiplayerLobbyUrl(
      lobbyCode,
      "guest",
      normalizedHostAddress,
      undefined,
      undefined,
      guestSeat,
      [],
      guestSeat === "ep",
    );
  }

  private parseLobbyUrl(input: string): URL | undefined {
    if (!this.looksLikeUrl(input)) {
      return;
    }

    try {
      const urlInput = this.needsUrlScheme(input) ? `${window.location.protocol}//${input}` : input;
      return new URL(urlInput, window.location.href);
    } catch {
      return;
    }
  }

  private normalizeLobbyCode(input: string): string {
    return input
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  private looksLikeUrl(input: string): boolean {
    return (
      /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
      || input.includes("localhost")
      || input.includes("127.0.0.1")
      || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/.test(input)
    );
  }

  private needsUrlScheme(input: string): boolean {
    return /^(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?([/?#]|$)/i.test(input);
  }

  private getMultiplayerLobbyUrl(
    lobbyCode: string,
    role: "host" | "guest",
    lanAddress?: string,
    playerCount?: MultiplayerLobbyPlayerCount,
    partySize?: 3 | 6,
    guestSeat?: MultiplayerGuestSeat,
    computerPartnerPlayerIndexes: PlayerIndex[] = [],
    enemyPlayerMode = false,
  ): string {
    const url = new URL(window.location.href);
    this.applyLobbyHostAddress(url, lanAddress);
    return this.configureMultiplayerLobbyUrl(
      url,
      lobbyCode,
      role,
      playerCount,
      partySize,
      guestSeat,
      computerPartnerPlayerIndexes,
      enemyPlayerMode,
    ).toString();
  }

  private configureMultiplayerLobbyUrl(
    url: URL,
    lobbyCode: string,
    role: "host" | "guest",
    requestedPlayerCount?: MultiplayerLobbyPlayerCount,
    requestedPartySize?: 3 | 6,
    requestedGuestSeat?: MultiplayerGuestSeat,
    requestedComputerPartnerPlayerIndexes: PlayerIndex[] = [],
    requestedEnemyPlayerMode = false,
  ): URL {
    const requestedLocalPlayer = url.searchParams.get("twoPlayerLocalPlayer")?.toLowerCase();
    const guestSeat =
      requestedGuestSeat
      ?? (requestedLocalPlayer === "ep"
      || requestedLocalPlayer === "enemy"
      || requestedLocalPlayer === "enemyplayer"
      || requestedLocalPlayer === "enemy-player"
      || requestedLocalPlayer === "enemy_player"
        ? "ep"
        : undefined)
      ?? (requestedLocalPlayer === "3"
      || requestedLocalPlayer === "p3"
      || requestedLocalPlayer === "player3"
      || requestedLocalPlayer === "guest2"
      || requestedLocalPlayer === "guest-2"
      || requestedLocalPlayer === "guest_2"
        ? 2
        : 1);
    const playerCount =
      requestedPlayerCount
      ?? (url.searchParams.get("twoPlayerPlayerCount") === "1"
        ? 1
        : url.searchParams.get("twoPlayerPlayerCount") === "3" || guestSeat === 2
          ? 3
          : guestSeat === "ep"
            ? 1
            : 2);
    const partySize = requestedPartySize ?? (url.searchParams.get("twoPlayerPartySize") === "3" ? 3 : 6);
    const enemyPlayerMode = requestedEnemyPlayerMode || url.searchParams.get("twoPlayerEnemyPlayerMode") === "1";

    url.searchParams.set("twoPlayer", "1");
    url.searchParams.set("twoPlayerInputTransport", "websocket");
    url.searchParams.set("twoPlayerNetworkRole", role);
    url.searchParams.set(
      "twoPlayerLocalPlayer",
      role === "host" ? "1" : guestSeat === "ep" ? "ep" : `${guestSeat + 1}`,
    );
    url.searchParams.set("twoPlayerPlayerCount", `${playerCount}`);
    url.searchParams.set("twoPlayerPartySize", `${partySize}`);
    if (enemyPlayerMode) {
      url.searchParams.set("twoPlayerEnemyPlayerMode", "1");
    } else {
      url.searchParams.delete("twoPlayerEnemyPlayerMode");
    }
    if (requestedComputerPartnerPlayerIndexes.length > 0) {
      url.searchParams.set("twoPlayerComputerPartner", "1");
      url.searchParams.set(
        "twoPlayerComputerPartnerPlayers",
        requestedComputerPartnerPlayerIndexes.map(playerIndex => `${playerIndex + 1}`).join(","),
      );
    } else {
      url.searchParams.delete("twoPlayerComputerPartner");
      url.searchParams.delete("twoPlayerComputerPartnerPlayers");
    }
    url.searchParams.set("twoPlayerSession", lobbyCode);
    url.searchParams.set("twoPlayerWsUrl", this.getMultiplayerWsUrl(url));
    return url;
  }

  private getDisplayHostAddress(lanAddress?: string): string {
    const url = new URL(window.location.href);
    this.applyLobbyHostAddress(url, lanAddress);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  private normalizeLobbyLanAddress(lanAddress: string): string | undefined {
    const trimmedAddress = lanAddress.trim();
    return trimmedAddress || undefined;
  }

  private isLocalJoinHost(hostname: string): boolean {
    return !hostname || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  }

  private applyLobbyHostAddress(url: URL, lanAddress?: string): void {
    if (!lanAddress) {
      return;
    }

    try {
      const parsedAddress = new URL(this.needsUrlScheme(lanAddress) ? `${url.protocol}//${lanAddress}` : lanAddress);
      url.hostname = parsedAddress.hostname;
      if (parsedAddress.port) {
        url.port = parsedAddress.port;
      }
    } catch {
      url.hostname = lanAddress;
    }
  }

  private getMultiplayerWsUrl(url: URL): string {
    const existingWsUrl = url.searchParams.get("twoPlayerWsUrl");
    if (existingWsUrl) {
      return existingWsUrl;
    }

    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.hostname}:${TWO_PLAYER_WS_PORT}`;
  }

  private showNewGameModeSelect(): void {
    this.selectedChallenges = [];
    globalScene.gameMode = getGameMode(GameModes.CLASSIC);
    const options: OptionSelectItem[] = [
      {
        label: GameMode.getModeName(GameModes.CLASSIC),
        handler: () => {
          this.showPlayerCountSelect(GameModes.CLASSIC);
          return true;
        },
        keepOpen: true,
      },
      {
        label: i18next.t("menu:dailyRun"),
        handler: () => {
          this.showPlayerCountSelect(GameModes.DAILY);
          return true;
        },
        keepOpen: true,
      },
    ];

    const gameData = globalScene.getLocalPlayerGameData();
    if (gameData.isUnlocked(Unlockables.ENDLESS_MODE)) {
      options.push({
        label: GameMode.getModeName(GameModes.CHALLENGE),
        handler: () => {
          this.showChallengeSettings();
          return true;
        },
        keepOpen: true,
      });
      const endlessModes = [GameModes.ENDLESS];
      if (gameData.isUnlocked(Unlockables.SPLICED_ENDLESS_MODE)) {
        endlessModes.push(GameModes.SPLICED_ENDLESS);
      }
      for (const mode of endlessModes) {
        options.push({
          label: GameMode.getModeName(mode),
          handler: () => {
            this.showPlayerCountSelect(mode);
            return true;
          },
          keepOpen: true,
        });
      }
    }
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        globalScene.phaseManager.toTitleScreen();
        super.end();
        return true;
      },
    });

    this.showOptionSelectWithText(i18next.t("menu:selectGameMode"), options);
  }

  private showChallengeSettings(): void {
    globalScene.gameMode = getGameMode(GameModes.CHALLENGE);
    this.applySelectedChallenges();
    const config: ChallengeSelectConfig = {
      onConfirm: () => {
        this.selectedChallenges = globalScene.gameMode.challenges.map(challenge => new ChallengeData(challenge));
        void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.showPlayerCountSelect(GameModes.CHALLENGE));
      },
      onCancel: () => {
        void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.showNewGameModeSelect());
      },
    };
    void globalScene.ui.setMode(UiMode.CHALLENGE_SELECT, config);
  }

  private applySelectedChallenges(): void {
    if (globalScene.gameMode.modeId === GameModes.CHALLENGE) {
      for (const challenge of this.selectedChallenges) {
        globalScene.gameMode.setChallengeValue(challenge.id, challenge.value, challenge.severity);
      }
    }
  }

  private validateChallengePlayers(gameMode: GameModes): boolean {
    if (gameMode !== GameModes.CHALLENGE) {
      return true;
    }
    globalScene.gameMode = getGameMode(gameMode);
    this.applySelectedChallenges();
    const players = globalScene.getActivePlayerIndexes();
    let message: string | undefined;
    if (!globalScene.gameMode.challenges.some(c => c.value && players.some(player => c.appliesToPlayer(player)))) {
      message = "Select at least one challenge for a participating player.";
    } else {
      for (const playerIndex of globalScene.getComputerPartnerPlayerIndexes()) {
        const key = globalScene.getComputerPartnerKey(playerIndex);
        const profile = getComputerPartnerProfile(key);
        if (profile.usesPlayerSelectedStarters) {
          continue;
        }
        const eligible = getComputerPartnerChallengeProfile(
          profile,
          playerIndex,
          globalScene.getPlayerGameData(0).getComputerPartnerProgress(key),
        );
        if (eligible !== profile && !eligible.startingStarters?.length) {
          message = `${profile.name} has no eligible starters for P${playerIndex + 1}'s Mono Type. Choose another type or partner.`;
          break;
        }
      }
    }
    if (message) {
      const text = message;
      void globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
        globalScene.ui.showText(text, null, () => this.showChallengeSettings(), null, true);
      });
      return false;
    }
    return true;
  }

  private showPlayerCountSelect(gameMode: GameModes): void {
    const showDailyMultiplayerUnavailable = () => {
      globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.ui.showText(i18next.t("menu:twoPlayerDailyUnavailable"), null, () =>
        this.showPlayerCountSelect(gameMode),
      );
    };
    const unavailableVsOption = (): OptionSelectItem => ({
      label: "-",
      handler: () => false,
      disabled: true,
      style: TextStyle.SETTINGS_LOCKED,
      keepOpen: true,
    });
    const options: OptionSelectItem[] = [
      // This option grid is column-major: first the Classic column, then Vs Mode, then EP Mode.
      {
        label: i18next.t("menu:onePlayer"),
        handler: () => {
          globalScene.configureTwoPlayerMode(false);
          if (gameMode === GameModes.DAILY) {
            this.initDailyRun();
          } else {
            this.setModeAndEnd(gameMode);
          }
          return true;
        },
      },
      {
        label: i18next.t("menu:twoPlayer"),
        handler: () => {
          this.showTwoPlayerModeSelect(gameMode, 2);
          return true;
        },
        keepOpen: true,
      },
      {
        label: "3P",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.showTwoPlayerModeSelect(gameMode, 3);
          }
          return true;
        },
        keepOpen: true,
      },
      {
        label: "2P+1C",
        handler: () => {
          return true;
        },
        disabled: true,
        style: TextStyle.SETTINGS_LOCKED,
        keepOpen: true,
      },
      {
        label: i18next.t("menu:onePlayerOneComputer"),
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.showComputerPartnerSelect(gameMode, 2);
          }
          return true;
        },
        keepOpen: true,
      },
      {
        label: "1P+2C",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.showComputerPartnerSelect(gameMode, 3);
          }
          return true;
        },
        keepOpen: true,
      },
      unavailableVsOption(),
      {
        label: "P.Vs.P",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.startMultiplayerRun(gameMode, 2, 6, [], true);
          }
          return true;
        },
      },
      {
        label: "P.Vs.P.Vs.P",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.startMultiplayerRun(gameMode, 3, 6, [], true);
          }
          return true;
        },
      },
      unavailableVsOption(),
      {
        label: "P.Vs.C",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.showComputerPartnerSelect(gameMode, 2, undefined, undefined, [1], true);
          }
          return true;
        },
      },
      {
        label: "P.Vs.C.Vs.C",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.showComputerPartnerSelect(gameMode, 3, undefined, undefined, [1, 2], true);
          }
          return true;
        },
      },
      {
        label: "1P.Vs.EP",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.startEnemyPlayerRun(gameMode, 1);
          }
          return true;
        },
      },
      {
        label: "2P.Vs.EP",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.startEnemyPlayerRun(gameMode, 2);
          }
          return true;
        },
      },
      {
        label: "3P.Vs.EP",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.startEnemyPlayerRun(gameMode, 3);
          }
          return true;
        },
      },
      {
        label: "1C.Vs.EP",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.showEnemyPlayerCpuProfileSelect(gameMode, 1);
          }
          return true;
        },
        keepOpen: true,
      },
      {
        label: "2C.Vs.EP",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.showEnemyPlayerCpuProfileSelect(gameMode, 2);
          }
          return true;
        },
        keepOpen: true,
      },
      {
        label: "3C.Vs.EP",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            showDailyMultiplayerUnavailable();
          } else {
            this.showEnemyPlayerCpuProfileSelect(gameMode, 3);
          }
          return true;
        },
        keepOpen: true,
      },
      {
        label: i18next.t("menu:cancel"),
        handler: () => {
          if (gameMode === GameModes.CHALLENGE) {
            this.showChallengeSettings();
          } else {
            this.showNewGameModeSelect();
          }
          return true;
        },
        keepOpen: true,
      },
    ];

    this.showOptionSelectWithText(i18next.t("menu:selectPlayerCount"), options, {
      gridLayout: {
        rows: 6,
        columns: 3,
        slotCount: 18,
        minColumnWidth: 62,
        columnGap: 18,
        centerLastOption: true,
      },
    });
  }

  private showEnemyPlayerCpuProfileSelect(
    gameMode: GameModes,
    playerCount: 1 | 2 | 3,
    selectedPartnerKeys: Partial<Record<PlayerIndex, ComputerPartnerKey>> = {},
  ): void {
    const cpuPlayerIndexes = ([0, 1, 2] as PlayerIndex[]).slice(0, playerCount);
    const currentPlayerIndex = cpuPlayerIndexes.find(playerIndex => !selectedPartnerKeys[playerIndex]);
    if (currentPlayerIndex === undefined) {
      cpuPlayerIndexes.forEach(playerIndex => {
        this.setComputerPartner(playerIndex, selectedPartnerKeys[playerIndex] ?? "alex");
      });
      this.startMultiplayerRun(gameMode, playerCount, 6, cpuPlayerIndexes, false, true);
      return;
    }

    const options: OptionSelectItem[] = COMPUTER_PARTNER_KEYS.map(key => {
      const profile = getComputerPartnerProfile(key);
      const enabled = globalScene.gameData.isComputerPartnerUnlocked(key) && !profile.usesPlayerSelectedStarters;
      return {
        label: profile.name,
        handler: () => {
          if (!enabled) {
            return false;
          }

          this.showEnemyPlayerCpuProfileSelect(gameMode, playerCount, {
            ...selectedPartnerKeys,
            [currentPlayerIndex]: key,
          });
          return true;
        },
        ...(enabled ? {} : { disabled: true, style: TextStyle.SETTINGS_LOCKED }),
      };
    });

    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        this.showPlayerCountSelect(gameMode);
        return true;
      },
      keepOpen: true,
    });

    this.showOptionSelectWithText(`Choose CPU Player ${currentPlayerIndex + 1}`, options, {
      gridLayout: {
        rows: COMPUTER_PARTNER_MENU_ROWS,
        columns: Math.ceil(
          Math.max(options.length - 1, COMPUTER_PARTNER_MENU_MIN_SLOT_COUNT) / COMPUTER_PARTNER_MENU_ROWS,
        ),
        slotCount: Math.max(options.length - 1, COMPUTER_PARTNER_MENU_MIN_SLOT_COUNT),
        centerLastOption: true,
      },
    });
  }

  private showComputerPartnerSelect(
    gameMode: GameModes,
    playerCount: 2 | 3,
    firstPartnerKey?: ComputerPartnerKey,
    firstPartnerRolePreferences?: ComputerPartnerRolePreferences,
    computerPartnerPlayerIndexes?: PlayerIndex[],
    vsMode = false,
  ): void {
    const selectedComputerPartnerPlayerIndexes = this.getComputerPartnerSelectionIndexes(
      playerCount,
      computerPartnerPlayerIndexes,
    );
    const firstPartnerPlayerIndex = selectedComputerPartnerPlayerIndexes[0];
    const currentPartnerPlayerIndex =
      firstPartnerKey && selectedComputerPartnerPlayerIndexes.length > 1
        ? selectedComputerPartnerPlayerIndexes[1]
        : firstPartnerPlayerIndex;
    const partnerSlotCount = Math.max(
      COMPUTER_PARTNER_MENU_MIN_SLOT_COUNT,
      Math.ceil(COMPUTER_PARTNER_KEYS.length / COMPUTER_PARTNER_MENU_ROWS) * COMPUTER_PARTNER_MENU_ROWS,
    );
    const playerLabel = `Player ${currentPartnerPlayerIndex + 1}`;
    const options: OptionSelectItem[] = COMPUTER_PARTNER_KEYS.map(key => {
      const profile = getComputerPartnerProfile(key);
      const enabled = key !== firstPartnerKey && globalScene.gameData.isComputerPartnerUnlocked(key);
      return {
        label: profile.name,
        handler: () => {
          if (!enabled) {
            return false;
          }

          if (key === "alex") {
            this.showAlexPreferenceSelect(
              gameMode,
              playerCount,
              key,
              firstPartnerKey,
              firstPartnerRolePreferences,
              selectedComputerPartnerPlayerIndexes,
              vsMode,
            );
            return true;
          }

          if (selectedComputerPartnerPlayerIndexes.length > 1 && !firstPartnerKey) {
            this.showComputerPartnerSelect(
              gameMode,
              playerCount,
              key,
              undefined,
              selectedComputerPartnerPlayerIndexes,
              vsMode,
            );
            return true;
          }

          this.setComputerPartner(firstPartnerPlayerIndex, firstPartnerKey ?? key, firstPartnerRolePreferences);
          if (selectedComputerPartnerPlayerIndexes.length > 1) {
            this.setComputerPartner(currentPartnerPlayerIndex, key);
          }
          if (vsMode) {
            this.startMultiplayerRun(gameMode, playerCount, 6, selectedComputerPartnerPlayerIndexes, true);
            return true;
          }
          this.showTwoPlayerModeSelect(gameMode, playerCount, selectedComputerPartnerPlayerIndexes);
          return true;
        },
        ...(enabled ? {} : { disabled: true, style: TextStyle.SETTINGS_LOCKED }),
      };
    });

    while (options.length < partnerSlotCount) {
      options.push({
        label: "-",
        handler: () => false,
        disabled: true,
        style: TextStyle.SETTINGS_LOCKED,
      });
    }

    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        if (selectedComputerPartnerPlayerIndexes.length > 1 && firstPartnerKey) {
          this.showComputerPartnerSelect(
            gameMode,
            playerCount,
            undefined,
            undefined,
            selectedComputerPartnerPlayerIndexes,
            vsMode,
          );
        } else {
          this.showPlayerCountSelect(gameMode);
        }
        return true;
      },
      keepOpen: true,
    });

    this.showOptionSelectWithText(
      `${vsMode ? "Choose CPU Opponent" : i18next.t("menu:selectComputerPartner")} (${playerLabel})`,
      options,
      {
        gridLayout: {
          rows: COMPUTER_PARTNER_MENU_ROWS,
          columns: Math.ceil(partnerSlotCount / COMPUTER_PARTNER_MENU_ROWS),
          slotCount: partnerSlotCount,
          centerLastOption: true,
        },
      },
    );
  }

  private getComputerPartnerSelectionIndexes(
    playerCount: 2 | 3,
    computerPartnerPlayerIndexes?: PlayerIndex[],
  ): Array<1 | 2> {
    const defaultPlayerIndexes: Array<1 | 2> = playerCount === 3 ? [1, 2] : [1];
    const selectedPlayerIndexes = computerPartnerPlayerIndexes ?? defaultPlayerIndexes;
    const validPlayerIndexes = [...new Set(selectedPlayerIndexes)].filter(
      (playerIndex): playerIndex is 1 | 2 => (playerIndex === 1 || playerIndex === 2) && playerIndex < playerCount,
    );

    return validPlayerIndexes.length > 0 ? validPlayerIndexes : defaultPlayerIndexes;
  }

  private showAlexPreferenceSelect(
    gameMode: GameModes,
    playerCount: 2 | 3,
    key: ComputerPartnerKey,
    firstPartnerKey?: ComputerPartnerKey,
    firstPartnerRolePreferences?: ComputerPartnerRolePreferences,
    computerPartnerPlayerIndexes?: PlayerIndex[],
    vsMode = false,
    partySlot = 2,
    rolePreferences: ComputerPartnerRolePreferences = [],
  ): void {
    const selectedComputerPartnerPlayerIndexes = this.getComputerPartnerSelectionIndexes(
      playerCount,
      computerPartnerPlayerIndexes,
    );
    const firstPartnerPlayerIndex = selectedComputerPartnerPlayerIndexes[0];
    const currentPartnerPlayerIndex =
      firstPartnerKey && selectedComputerPartnerPlayerIndexes.length > 1
        ? selectedComputerPartnerPlayerIndexes[1]
        : firstPartnerPlayerIndex;
    const continueWithPreference = (rolePreference: ComputerPartnerRole) => {
      const nextRolePreferences = [...rolePreferences, rolePreference];
      if (partySlot < 6) {
        this.showAlexPreferenceSelect(
          gameMode,
          playerCount,
          key,
          firstPartnerKey,
          firstPartnerRolePreferences,
          selectedComputerPartnerPlayerIndexes,
          vsMode,
          partySlot + 1,
          nextRolePreferences,
        );
        return;
      }

      if (selectedComputerPartnerPlayerIndexes.length > 1 && !firstPartnerKey) {
        this.showComputerPartnerSelect(
          gameMode,
          playerCount,
          key,
          nextRolePreferences,
          selectedComputerPartnerPlayerIndexes,
          vsMode,
        );
        return;
      }

      this.setComputerPartner(
        firstPartnerPlayerIndex,
        firstPartnerKey ?? key,
        firstPartnerRolePreferences ?? nextRolePreferences,
      );
      if (selectedComputerPartnerPlayerIndexes.length > 1) {
        this.setComputerPartner(currentPartnerPlayerIndex, key, nextRolePreferences);
      }
      if (vsMode) {
        this.startMultiplayerRun(gameMode, playerCount, 6, selectedComputerPartnerPlayerIndexes, true);
        return;
      }
      this.showTwoPlayerModeSelect(gameMode, playerCount, selectedComputerPartnerPlayerIndexes);
    };

    const options: OptionSelectItem[] = [
      {
        label: "Bulk (HP+Def+SpDef)",
        handler: () => {
          continueWithPreference("bulk");
          return true;
        },
      },
      {
        label: "Attack",
        handler: () => {
          continueWithPreference("physical");
          return true;
        },
      },
      {
        label: "Spec Attack",
        handler: () => {
          continueWithPreference("special");
          return true;
        },
      },
      {
        label: "Speed",
        handler: () => {
          continueWithPreference("speed");
          return true;
        },
      },
      {
        label: i18next.t("menu:cancel"),
        handler: () => {
          this.showComputerPartnerSelect(
            gameMode,
            playerCount,
            firstPartnerKey,
            firstPartnerRolePreferences,
            selectedComputerPartnerPlayerIndexes,
            vsMode,
          );
          return true;
        },
        keepOpen: true,
      },
    ];

    this.showOptionSelectWithText(`Choose Alex's Slot ${partySlot} Preference`, options);
  }

  private setComputerPartner(
    playerIndex: PlayerIndex,
    key: ComputerPartnerKey,
    rolePreferences?: ComputerPartnerRolePreferences,
  ): void {
    globalScene.setComputerPartnerKey(playerIndex, key);
    globalScene.setComputerPartnerRolePreferences(playerIndex, key === "alex" ? rolePreferences : undefined);
  }

  private showTwoPlayerModeSelect(
    gameMode: GameModes,
    playerCount: 2 | 3,
    computerPartnerPlayerIndexes: PlayerIndex[] = [],
  ): void {
    const startTwoPlayer = (partySize: 3 | 6) => {
      if (gameMode === GameModes.DAILY) {
        globalScene.ui.setMode(UiMode.MESSAGE);
        globalScene.ui.showText(i18next.t("menu:twoPlayerDailyUnavailable"), null, () =>
          this.showPlayerCountSelect(gameMode),
        );
      } else {
        this.startMultiplayerRun(gameMode, playerCount, partySize, computerPartnerPlayerIndexes);
      }
    };

    const options: OptionSelectItem[] = [
      {
        label: i18next.t("menu:twoPlayerFullMode"),
        handler: () => {
          startTwoPlayer(6);
          return true;
        },
      },
      {
        label: this.getLimitedTeamSizeLabel(playerCount),
        handler: () => {
          startTwoPlayer(3);
          return true;
        },
      },
      {
        label: i18next.t("menu:cancel"),
        handler: () => {
          this.showPlayerCountSelect(gameMode);
          return true;
        },
        keepOpen: true,
      },
    ];

    this.showOptionSelectWithText(i18next.t("menu:selectTeamSize"), options);
  }

  private startMultiplayerRun(
    gameMode: GameModes,
    playerCount: 1 | 2 | 3,
    partySize: 3 | 6,
    computerPartnerPlayerIndexes: PlayerIndex[] = [],
    vsMode = false,
    enemyPlayerMode = false,
  ): void {
    globalScene.configureTwoPlayerMode(
      true,
      partySize,
      computerPartnerPlayerIndexes.length > 0,
      playerCount,
      computerPartnerPlayerIndexes,
      vsMode,
      enemyPlayerMode,
    );
    if (!this.validateChallengePlayers(gameMode)) {
      return;
    }
    globalScene.resetTwoPlayerProfileExchangeForRun();
    const runSeed = activeOverrides.SEED_OVERRIDE || getTwoPlayerRunSeedOverride() || randomString(24);
    globalScene.setSeed(runSeed);
    globalScene.resetSeed();
    const titleStart: TwoPlayerTitleStart = {
      action: "new-run",
      gameMode,
      ...(gameMode === GameModes.CHALLENGE ? { challenges: this.selectedChallenges } : {}),
      partySize,
      playerCount,
      vsMode,
      enemyPlayerMode,
      ...(globalScene.twoPlayerComputerPartner
        ? {
            computerPartnerPlayerIndexes: globalScene.getComputerPartnerPlayerIndexes(),
            computerPartnerKeys: Object.fromEntries(
              globalScene
                .getComputerPartnerPlayerIndexes()
                .map(playerIndex => [playerIndex, globalScene.getComputerPartnerKey(playerIndex)]),
            ),
            computerPartnerRolePreferences: Object.fromEntries(
              globalScene
                .getComputerPartnerPlayerIndexes()
                .map(playerIndex => [playerIndex, globalScene.getComputerPartnerRolePreferences(playerIndex)])
                .filter((entry): entry is [PlayerIndex, ComputerPartnerRolePreferences] => entry[1] !== undefined),
            ),
          }
        : {}),
      seed: runSeed,
    };
    console.info("[PokeRogue 2P] Broadcasting multiplayer run start", titleStart);
    globalScene.uiInputs?.broadcastTwoPlayerTitleStart(titleStart);
    globalScene.uiInputs?.broadcastTwoPlayerRunBootstrap(runSeed);
    this.announceTwoPlayerProfileForStartup();
    this.waitForTwoPlayerProfilesBeforeRun(() => {
      globalScene.uiInputs?.broadcastTwoPlayerTitleStart(titleStart);
      globalScene.uiInputs?.broadcastTwoPlayerRunBootstrap(runSeed);
      this.announceTwoPlayerProfileForStartup();
      this.setModeAndEnd(gameMode);
    });
  }

  private startEnemyPlayerRun(gameMode: GameModes, playerCount: 1 | 2 | 3): void {
    this.startMultiplayerRun(gameMode, playerCount, 6, [], false, true);
  }

  // TODO: Make callers actually wait for the save slot to load
  private async loadSaveSlot(slotId: number, fromRemoteStart = false, seedOverride?: string): Promise<void> {
    // TODO: Do we need to `await` this?
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.resetModeChain();
    globalScene.sessionSlotId = slotId;
    try {
      const success = await globalScene.gameData.loadSession(slotId);
      if (success) {
        this.loaded = true;
        if (seedOverride) {
          globalScene.applyTwoPlayerRunBootstrap({ seed: seedOverride });
        }
        globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("session-loaded");
        const titleStart: TwoPlayerTitleStart = {
          action: "load-session",
          slotId,
          playerCount: globalScene.multiplayerPlayerCount,
          vsMode: globalScene.twoPlayerVsMode,
          enemyPlayerMode: globalScene.twoPlayerEnemyPlayerMode,
          seed: globalScene.seed,
        };
        if (globalScene.twoPlayerMode && !fromRemoteStart) {
          globalScene.uiInputs?.broadcastTwoPlayerTitleStart(titleStart);
        }
        this.waitForTwoPlayerProfilesBeforeRun(() => {
          if (globalScene.twoPlayerMode && !fromRemoteStart) {
            globalScene.uiInputs?.broadcastTwoPlayerTitleStart(titleStart);
          }
          globalScene.ui.showText(i18next.t("menu:sessionSuccess"), null, () => this.end());
        });
      } else {
        this.end();
      }
    } catch (err) {
      console.error(err);
      globalScene.ui.showText(i18next.t("menu:failedToLoadSession"), null);
    }
  }

  private applyRemoteTwoPlayerTitleStart(titleStart: TwoPlayerTitleStart): boolean {
    if (!globalScene.twoPlayerMode) {
      return false;
    }

    if (this.remoteTitleStartApplied) {
      globalScene.clearPendingTwoPlayerTitleStart(titleStart);
      console.info("[PokeRogue 2P] Ignoring duplicate multiplayer run start", titleStart);
      return true;
    }

    this.remoteTitleStartApplied = true;
    globalScene.clearPendingTwoPlayerTitleStart(titleStart);
    console.info("[PokeRogue 2P] Received multiplayer run start", titleStart);
    if (titleStart.seed) {
      globalScene.applyTwoPlayerRunBootstrap({ seed: titleStart.seed });
    }

    if (titleStart.action === "new-run") {
      const gameMode = titleStart.gameMode as GameModes | undefined;
      if (gameMode === undefined || gameMode === GameModes.DAILY) {
        return false;
      }

      this.selectedChallenges =
        gameMode === GameModes.CHALLENGE
          ? (titleStart.challenges ?? []).map(challenge => new ChallengeData(challenge))
          : [];

      const playerCount = titleStart.playerCount ?? 2;
      const computerPartnerPlayerIndexes = this.getTitleStartComputerPartnerPlayerIndexes(titleStart, playerCount);
      globalScene.configureTwoPlayerMode(
        true,
        titleStart.partySize ?? 6,
        computerPartnerPlayerIndexes.length > 0,
        playerCount,
        computerPartnerPlayerIndexes,
        !!titleStart.vsMode,
        !!titleStart.enemyPlayerMode,
      );
      globalScene.resetTwoPlayerProfileExchangeForRun();
      this.applyTitleStartComputerPartners(titleStart);
      this.announceTwoPlayerProfileForStartup();
      this.waitForTwoPlayerProfilesBeforeRun(() => this.setModeAndEnd(gameMode));
      return true;
    }

    if (titleStart.action === "load-session" && titleStart.slotId !== undefined) {
      void this.loadSaveSlot(titleStart.slotId, true, titleStart.seed);
      return true;
    }

    return false;
  }

  private getTitleStartComputerPartnerPlayerIndexes(
    titleStart: TwoPlayerTitleStart,
    playerCount: 1 | 2 | 3,
  ): PlayerIndex[] {
    if (playerCount === 1 && !titleStart.enemyPlayerMode) {
      return [];
    }

    if (
      !titleStart.computerPartnerPlayerIndexes?.length
      && Object.keys(titleStart.computerPartnerKeys ?? {}).length === 0
    ) {
      return [];
    }

    const keyedPlayerIndexes = Object.keys(titleStart.computerPartnerKeys ?? {})
      .map(playerIndex => Number(playerIndex))
      .filter((playerIndex): playerIndex is PlayerIndex =>
        playerIndex === 1 || playerIndex === 2 || (!!titleStart.enemyPlayerMode && playerIndex === 0)
      );

    const requestedPlayerIndexes = titleStart.computerPartnerPlayerIndexes?.length
      ? titleStart.computerPartnerPlayerIndexes
      : keyedPlayerIndexes;
    const validPlayerIndexes = [...new Set(requestedPlayerIndexes)]
      .filter(playerIndex =>
        (playerIndex > 0 || !!titleStart.enemyPlayerMode)
        && playerIndex < playerCount
      )
      .sort((a, b) => a - b);

    if (validPlayerIndexes.length > 0) {
      return validPlayerIndexes;
    }

    return titleStart.enemyPlayerMode
      ? ([0, 1, 2] as PlayerIndex[]).slice(0, playerCount)
      : this.getComputerPartnerSelectionIndexes(playerCount as 2 | 3);
  }

  private applyTitleStartComputerPartners(titleStart: TwoPlayerTitleStart): void {
    if (!globalScene.twoPlayerComputerPartner) {
      return;
    }

    for (const playerIndex of globalScene.getComputerPartnerPlayerIndexes()) {
      const key = titleStart.computerPartnerKeys?.[playerIndex];
      globalScene.setComputerPartnerKey(playerIndex, this.isComputerPartnerKey(key) ? key : "alex");
      const rolePreferences = this.getTitleStartComputerPartnerRolePreferences(titleStart, playerIndex);
      globalScene.setComputerPartnerRolePreferences(playerIndex, rolePreferences);
    }
  }

  private getTitleStartComputerPartnerRolePreferences(
    titleStart: TwoPlayerTitleStart,
    playerIndex: PlayerIndex,
  ): ComputerPartnerRolePreferences | undefined {
    const rolePreferences = titleStart.computerPartnerRolePreferences?.[playerIndex];
    if (!Array.isArray(rolePreferences)) {
      return;
    }

    const validRolePreferences = rolePreferences.filter((rolePreference): rolePreference is ComputerPartnerRole =>
      this.isComputerPartnerRolePreference(rolePreference),
    );

    return validRolePreferences.length > 0 ? validRolePreferences : undefined;
  }

  private isComputerPartnerRolePreference(rolePreference: unknown): rolePreference is ComputerPartnerRole {
    return (
      rolePreference === "ace"
      || rolePreference === "balanced"
      || rolePreference === "physical"
      || rolePreference === "special"
      || rolePreference === "bulk"
      || rolePreference === "hpBulk"
      || rolePreference === "defense"
      || rolePreference === "specialDefense"
      || rolePreference === "speed"
    );
  }

  private isComputerPartnerKey(key: unknown): key is ComputerPartnerKey {
    return isKnownComputerPartnerKey(key);
  }

  private announceTwoPlayerProfileForStartup(attempts = 8, intervalMs = 500): void {
    if (!globalScene.twoPlayerMode) {
      return;
    }

    if (this.profileStartupAnnounceInterval !== undefined) {
      globalThis.clearInterval(this.profileStartupAnnounceInterval);
      this.profileStartupAnnounceInterval = undefined;
    }

    let sentCount = 0;
    const announce = () => {
      if (!globalScene.twoPlayerMode || sentCount >= attempts) {
        if (this.profileStartupAnnounceInterval !== undefined) {
          globalThis.clearInterval(this.profileStartupAnnounceInterval);
          this.profileStartupAnnounceInterval = undefined;
        }
        return;
      }

      sentCount++;
      globalScene.uiInputs?.broadcastTwoPlayerProfileSnapshot();
      globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("profile-startup");
    };

    announce();
    this.profileStartupAnnounceInterval = globalThis.setInterval(announce, intervalMs);
  }

  private waitForTwoPlayerProfilesBeforeRun(onReady: () => void): void {
    if (!globalScene.twoPlayerMode || globalScene.isTwoPlayerProfileExchangeComplete()) {
      onReady();
      return;
    }

    globalScene.waitForPlayerInput(0);
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      const waitingMessage =
        globalScene.multiplayerPlayerCount > 2
          ? "Waiting for all player profiles..."
          : "Waiting for both player profiles...";
      globalScene.ui.showText(waitingMessage, null, null, null, false);
      globalScene.uiInputs?.broadcastTwoPlayerProfileSnapshot();
      const profileRetryInterval = globalThis.setInterval(() => {
        if (globalScene.isTwoPlayerProfileExchangeComplete()) {
          globalThis.clearInterval(profileRetryInterval);
          return;
        }
        globalScene.uiInputs?.broadcastTwoPlayerProfileSnapshot();
      }, 1000);
      globalScene.waitForTwoPlayerProfileExchange().then(ready => {
        globalThis.clearInterval(profileRetryInterval);
        if (ready) {
          globalScene.ui.clearText();
          onReady();
          return;
        }

        const retryMessage =
          globalScene.multiplayerPlayerCount > 2
            ? "Still waiting for the other player profiles."
            : "Still waiting for the other player profile.";
        globalScene.ui.showText(retryMessage, null, () => this.waitForTwoPlayerProfilesBeforeRun(onReady));
      });
    });
  }

  initDailyRun(): void {
    globalScene.ui.clearText();
    globalScene.ui.setMode(UiMode.SAVE_SLOT, SaveSlotUiMode.SAVE, (slotId: number) => {
      if (slotId === -1) {
        globalScene.phaseManager.toTitleScreen();
        super.end();
        return;
      }
      globalScene.phaseManager.clearPhaseQueue();
      globalScene.sessionSlotId = slotId;

      const generateDaily = (seed: string) => {
        globalScene.gameMode = getGameMode(GameModes.DAILY);

        seed = globalScene.gameMode.trySetCustomDailyConfig(seed);

        // Daily runs don't support all challenges yet (starter select restrictions aren't considered)
        startDailyEventChallenges();

        globalScene.setSeed(seed);
        globalScene.resetSeed();

        globalScene.money = globalScene.gameMode.getStartingMoney();

        const starters = getDailyRunStarters();
        const startingLevel = globalScene.gameMode.getStartingLevel();

        // TODO: Dedupe this
        const party = globalScene.getPlayerParty();
        const loadPokemonAssets: Promise<void>[] = [];
        for (const [index, starter] of starters.entries()) {
          const species = getPokemonSpecies(starter.speciesId);
          const starterFormIndex = starter.formIndex;
          const starterGender =
            species.malePercent === null ? Gender.GENDERLESS : starter.female ? Gender.FEMALE : Gender.MALE;
          const starterPokemon = globalScene.addPlayerPokemon(
            species,
            startingLevel,
            starter.abilityIndex,
            starterFormIndex,
            starterGender,
            starter.shiny,
            starter.variant,
            starter.ivs,
            starter.nature,
          );
          starterPokemon.setVisible(false);
          if (starter.moveset) {
            // avoid validating daily run starter movesets which are pre-populated already
            starterPokemon.tryPopulateMoveset(starter.moveset, true);
          }

          const customStarterConfig = globalScene.gameMode.dailyConfig?.starters?.[index];
          if (customStarterConfig?.ability != null) {
            starterPokemon.customPokemonData.ability = customStarterConfig.ability;
          }
          if (customStarterConfig?.passive != null) {
            starterPokemon.customPokemonData.passive = customStarterConfig.passive;
          }

          party.push(starterPokemon);
          loadPokemonAssets.push(starterPokemon.loadAssets());
        }

        regenerateModifierPoolThresholds(party, ModifierPoolType.DAILY_STARTER);

        const modifiers: Modifier[] = new Array(3)
          .fill(null)
          .map(() => modifierTypes.EXP_SHARE().withIdFromFunc(modifierTypes.EXP_SHARE).newModifier())
          .concat(
            new Array(3)
              .fill(null)
              .map(() => modifierTypes.GOLDEN_EXP_CHARM().withIdFromFunc(modifierTypes.GOLDEN_EXP_CHARM).newModifier()),
          )
          .concat([modifierTypes.MAP().withIdFromFunc(modifierTypes.MAP).newModifier()])
          .concat([modifierTypes.ABILITY_CHARM().withIdFromFunc(modifierTypes.ABILITY_CHARM).newModifier()])
          .concat([modifierTypes.SHINY_CHARM().withIdFromFunc(modifierTypes.SHINY_CHARM).newModifier()])
          .concat(getDailyRunStarterModifiers(party))
          .filter(m => m !== null);

        for (const m of modifiers) {
          globalScene.addModifier(m, true, false, false, true);
        }
        for (const m of timedEventManager.getEventDailyStartingItems()) {
          globalScene.addModifier(
            modifierTypes[m]().withIdFromFunc(modifierTypes[m]).newModifier(),
            true,
            false,
            false,
            true,
          );
        }
        globalScene.updateModifiers(true, true);

        Promise.all(loadPokemonAssets).then(async () => {
          globalScene.time.delayedCall(500, () => audioManager.playBgm());
          globalScene.gameData.gameStats.dailyRunSessionsPlayed++;
          const startingBiome = globalScene.gameMode.getStartingBiome();

          await globalScene.loadBiomeAssets(startingBiome);
          globalScene.newArena(startingBiome);
          globalScene.newBattle();
          globalScene.arena.init();
          globalScene.sessionPlayTime = 0;
          globalScene.lastSavePlayTime = 0;
          this.end();
        });
      };

      // If Online, calls seed fetch from db to generate daily run. If Offline, generates a daily run based on current date.
      if (!bypassLogin || isLocalServerConnected) {
        pokerogueApi.daily
          .getSeed()
          .then(seed => {
            if (seed) {
              generateDaily(seed);
            } else {
              throw new Error("Daily run seed is null!");
            }
          })
          .catch(err => {
            console.error("Failed to load daily run:\n", err);
          });
      } else {
        // Grab first 10 chars of ISO date format (YYYY-MM-DD) and convert to base64
        let seed: string = btoa(new Date().toISOString().slice(0, 10));
        if (activeOverrides.DAILY_RUN_SEED_OVERRIDE != null) {
          seed =
            typeof activeOverrides.DAILY_RUN_SEED_OVERRIDE === "string"
              ? activeOverrides.DAILY_RUN_SEED_OVERRIDE
              : JSON.stringify(activeOverrides.DAILY_RUN_SEED_OVERRIDE);
        }
        generateDaily(seed);
      }
    });
  }

  // TODO: Refactor this
  end(): void {
    globalScene.setTwoPlayerTitleStartHandler(undefined);
    if (this.profileStartupAnnounceInterval !== undefined) {
      globalThis.clearInterval(this.profileStartupAnnounceInterval);
      this.profileStartupAnnounceInterval = undefined;
    }

    if (!this.loaded && !globalScene.gameMode.isDaily) {
      globalScene.gameMode = getGameMode(this.gameMode);
      this.applySelectedChallenges();
      const players = globalScene.getActivePlayerIndexes();
      for (const challenge of globalScene.gameMode.challenges) {
        if (!players.some(playerIndex => challenge.appliesToPlayer(playerIndex))) {
          challenge.value = 0;
        }
      }
      globalScene.phaseManager.pushNew("SelectStarterPhase");
      globalScene.newArena(globalScene.gameMode.getStartingBiome());
    } else {
      audioManager.playBgm();
    }

    globalScene.phaseManager.pushNew("EncounterPhase", this.loaded);

    if (this.loaded) {
      if (globalScene.twoPlayerMode) {
        const playerIndexes = globalScene.getPlayerFieldOwners();
        const availablePartyMembersByField = playerIndexes.map(playerIndex =>
          globalScene.getPokemonAllowedInBattle(playerIndex),
        );

        globalScene.phaseManager.pushNew("ShowTrainerPhase");
        playerIndexes.forEach((playerIndex, fieldIndex) => {
          const availablePartyMembers = availablePartyMembersByField[fieldIndex];
          if (availablePartyMembers[0]) {
            globalScene.phaseManager.pushNew("SummonPhase", fieldIndex, true, true);
          } else if (globalScene.hasEonFluteProtection(playerIndex)) {
            globalScene.phaseManager.pushNew("EonFluteSummonPhase", playerIndex);
          }
        });

        if (
          globalScene.currentBattle.battleType !== BattleType.TRAINER
          && (globalScene.currentBattle.waveIndex > 1 || !globalScene.gameMode.isDaily)
        ) {
          playerIndexes.forEach((playerIndex, fieldIndex) => {
            if (availablePartyMembersByField[fieldIndex].length > 1) {
              globalScene.phaseManager.pushNew("CheckSwitchPhase", fieldIndex, true);
            }
          });
        }
      } else {
        const availablePartyMembers = globalScene.getPokemonAllowedInBattle().length;

        if (availablePartyMembers > 0) {
          for (let fieldIndex = 0; fieldIndex < Math.min(availablePartyMembers, globalScene.currentBattle.getBattlerCount()); fieldIndex++) {
            globalScene.phaseManager.pushNew("SummonPhase", fieldIndex, true, true);
          }
        } else if (globalScene.hasEonFluteProtection(0)) {
          globalScene.phaseManager.pushNew("EonFluteSummonPhase", 0);
        }

        if (
          globalScene.currentBattle.battleType !== BattleType.TRAINER
          && (globalScene.currentBattle.waveIndex > 1 || !globalScene.gameMode.isDaily)
        ) {
          const minPartySize = globalScene.currentBattle.getBattlerCount();
          if (availablePartyMembers > minPartySize) {
            for (let fieldIndex = 0; fieldIndex < minPartySize; fieldIndex++) {
              globalScene.phaseManager.pushNew("CheckSwitchPhase", fieldIndex, globalScene.currentBattle.double);
            }
          }
        }
      }
    }

    // TODO: Move this to a migrate script instead of running it on save slot load
    for (const achv of Object.keys(globalScene.gameData.achvUnlocks)) {
      if (Object.hasOwn(vouchers, achv) && achv !== "CLASSIC_VICTORY") {
        globalScene.validateVoucherForPlayer(vouchers[achv], globalScene.activePlayerIndex);
      }
    }

    super.end();
  }
}
