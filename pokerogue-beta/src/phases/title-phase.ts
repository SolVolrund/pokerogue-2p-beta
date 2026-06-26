import { pokerogueApi } from "#api/api";
import { loggedInUser } from "#app/account";
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
import { getBiomeKey } from "#field/arena";
import type { Modifier } from "#modifiers/modifier";
import { getDailyRunStarterModifiers, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { vouchers } from "#system/voucher";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { SaveSlotUiMode } from "#ui/save-slot-select-ui-handler";
import { isLocalServerConnected, randomString } from "#utils/common";
import {
  COMPUTER_PARTNER_KEYS,
  getComputerPartnerProfile,
  type ComputerPartnerKey,
  type ComputerPartnerRole,
  type ComputerPartnerRolePreferences,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

const NO_SAVE_SLOT = -1;
const TWO_PLAYER_LOBBY_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TWO_PLAYER_WS_PORT = "8787";
type MultiplayerLobbyPlayerCount = 2 | 3;
type MultiplayerGuestSeat = 1 | 2;

function getTwoPlayerRunSeedOverride(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return new URLSearchParams(window.location.search).get("twoPlayerRunSeed") ?? undefined;
}

export class TitlePhase extends Phase {
  public readonly phaseName = "TitlePhase";
  private loaded = false;
  private remoteTitleStartApplied = false;
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
      const biomeKey = getBiomeKey(sessionData.arena.biome);
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
    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(0);
    }

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
  }

  private setModeAndEnd(gameMode: GameModes): void {
    globalScene.setTwoPlayerTitleStartHandler(undefined);
    this.gameMode = gameMode;
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.clearText();
    this.end();
  }

  private showOptionSelect(options: OptionSelectItem[]): void {
    const config: OptionSelectConfig = { options };
    const showOptions = () => {
      if (globalScene.ui.getMode() === UiMode.OPTION_SELECT) {
        globalScene.ui.handlers[UiMode.OPTION_SELECT].show([config]);
        return;
      }
      globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, config);
    };

    showOptions();
  }

  private showOptionSelectWithText(text: string, options: OptionSelectItem[]): void {
    globalScene.ui.showText(text, null, () => this.showOptionSelect(options));
  }

  private showMultiplayerSelect(): void {
    const options: OptionSelectItem[] = [
      {
        label: "Host 2P",
        handler: () => {
          this.hostMultiplayerLobby(2);
          return true;
        },
      },
      {
        label: "Host 3P",
        handler: () => {
          this.hostMultiplayerLobby(3);
          return true;
        },
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
        label: i18next.t("menu:cancel"),
        handler: () => {
          globalScene.phaseManager.toTitleScreen();
          super.end();
          return true;
        },
      },
    ];

    this.showOptionSelectWithText("Multiplayer", options);
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

    this.showRunSlotSelect("Export Run", slotId => dataSlots.includes(slotId), slotId => {
      void globalScene.gameData.tryExportData(GameDataType.SESSION, slotId);
    });
  }

  private showRunImportSlotSelect(): void {
    this.showRunSlotSelect("Import Run", () => true, slotId => {
      this.prepareTitleImportView();
      globalScene.gameData.importData(GameDataType.SESSION, slotId);
    });
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
          ...(!enabled ? { disabled: true, style: TextStyle.SETTINGS_LOCKED } : {}),
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

  private hostMultiplayerLobby(playerCount: MultiplayerLobbyPlayerCount): void {
    const lobbyCode = this.generateLobbyCode();
    const lanAddress = this.getLobbyLanAddress();
    const lobbyUrl = this.getMultiplayerLobbyUrl(lobbyCode, "host", lanAddress, playerCount);
    const player2Url = this.getMultiplayerLobbyUrl(lobbyCode, "guest", lanAddress, playerCount, 1);
    const player3Url =
      playerCount === 3 ? this.getMultiplayerLobbyUrl(lobbyCode, "guest", lanAddress, playerCount, 2) : undefined;
    const hostAddress = this.getDisplayHostAddress(lanAddress);

    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.showText(
      `Lobby ${lobbyCode} created.$Players can join from ${hostAddress}$Code: ${lobbyCode}`,
      null,
      () => {
        console.info(`[PokeRogue 2P] Player 2 lobby link: ${player2Url}`);
        if (player3Url) {
          console.info(`[PokeRogue 2P] Player 3 lobby link: ${player3Url}`);
        }
        window.location.assign(lobbyUrl);
      },
      null,
      true,
    );
    globalScene.ui.getMessageHandler().bringMessageToTop();
  }

  private joinMultiplayerLobby(guestSeat: MultiplayerGuestSeat): void {
    const lobbyUrl = this.getJoinLobbyUrl(window.prompt("Enter lobby code or lobby link") ?? "", guestSeat);
    if (!lobbyUrl) {
      this.showMultiplayerSelect();
      return;
    }

    window.location.assign(lobbyUrl);
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
        return undefined;
      }

      const sessionId = url.searchParams.get("twoPlayerSession");
      return sessionId ? this.normalizeLobbyCode(sessionId) : "";
    } catch {
      return undefined;
    }
  }

  private getJoinLobbyUrl(input: string, guestSeat: MultiplayerGuestSeat): string {
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
        guestSeat,
      ).toString();
    }

    const lobbyCode = this.parseLobbyCode(trimmedInput);
    return lobbyCode ? this.getMultiplayerLobbyUrl(lobbyCode, "guest", undefined, undefined, guestSeat) : "";
  }

  private parseLobbyUrl(input: string): URL | undefined {
    if (!this.looksLikeUrl(input)) {
      return undefined;
    }

    try {
      const urlInput = this.needsUrlScheme(input) ? `${window.location.protocol}//${input}` : input;
      return new URL(urlInput, window.location.href);
    } catch {
      return undefined;
    }
  }

  private normalizeLobbyCode(input: string): string {
    return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  private looksLikeUrl(input: string): boolean {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
      || input.includes("localhost")
      || input.includes("127.0.0.1")
      || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/.test(input);
  }

  private needsUrlScheme(input: string): boolean {
    return /^(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?([/?#]|$)/i.test(input);
  }

  private getMultiplayerLobbyUrl(
    lobbyCode: string,
    role: "host" | "guest",
    lanAddress?: string,
    playerCount?: MultiplayerLobbyPlayerCount,
    guestSeat?: MultiplayerGuestSeat,
  ): string {
    const url = new URL(window.location.href);
    this.applyLobbyHostAddress(url, lanAddress);
    return this.configureMultiplayerLobbyUrl(url, lobbyCode, role, playerCount, guestSeat).toString();
  }

  private configureMultiplayerLobbyUrl(
    url: URL,
    lobbyCode: string,
    role: "host" | "guest",
    requestedPlayerCount?: MultiplayerLobbyPlayerCount,
    requestedGuestSeat?: MultiplayerGuestSeat,
  ): URL {
    const requestedLocalPlayer = url.searchParams.get("twoPlayerLocalPlayer")?.toLowerCase();
    const guestSeat = requestedGuestSeat
      ?? (
        requestedLocalPlayer === "3"
        || requestedLocalPlayer === "p3"
        || requestedLocalPlayer === "player3"
        || requestedLocalPlayer === "guest2"
        || requestedLocalPlayer === "guest-2"
        || requestedLocalPlayer === "guest_2"
          ? 2
          : 1
      );
    const playerCount =
      requestedPlayerCount ?? (url.searchParams.get("twoPlayerPlayerCount") === "3" || guestSeat === 2 ? 3 : 2);

    url.searchParams.set("twoPlayer", "1");
    url.searchParams.set("twoPlayerInputTransport", "websocket");
    url.searchParams.set("twoPlayerNetworkRole", role);
    url.searchParams.set("twoPlayerLocalPlayer", role === "host" ? "1" : `${guestSeat + 1}`);
    url.searchParams.set("twoPlayerPlayerCount", `${playerCount}`);
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

  private getLobbyLanAddress(): string | undefined {
    if (!this.isLoopbackHost(window.location.hostname)) {
      return undefined;
    }

    return window.prompt(
      "Enter this computer's LAN address for Player 2, or leave blank to use this browser address.",
      "",
    )?.trim() || undefined;
  }

  private isLoopbackHost(hostname: string): boolean {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
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
      {
        label: i18next.t("menu:cancel"),
        handler: () => {
          globalScene.phaseManager.toTitleScreen();
          super.end();
          return true;
        },
      },
    ];

    this.showOptionSelectWithText(i18next.t("menu:selectGameMode"), options);
  }

  private showPlayerCountSelect(gameMode: GameModes): void {
    const options: OptionSelectItem[] = [
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
          this.showTwoPlayerModeSelect(gameMode);
          return true;
        },
        keepOpen: true,
      },
      {
        label: "3P",
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            globalScene.ui.setMode(UiMode.MESSAGE);
            globalScene.ui.showText(i18next.t("menu:twoPlayerDailyUnavailable"), null, () =>
              this.showPlayerCountSelect(gameMode),
            );
          } else {
            this.startMultiplayerRun(gameMode, 3, 6);
          }
          return true;
        },
      },
      {
        label: i18next.t("menu:onePlayerOneComputer"),
        handler: () => {
          if (gameMode === GameModes.DAILY) {
            globalScene.ui.setMode(UiMode.MESSAGE);
            globalScene.ui.showText(i18next.t("menu:twoPlayerDailyUnavailable"), null, () =>
              this.showPlayerCountSelect(gameMode),
            );
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
            globalScene.ui.setMode(UiMode.MESSAGE);
            globalScene.ui.showText(i18next.t("menu:twoPlayerDailyUnavailable"), null, () =>
              this.showPlayerCountSelect(gameMode),
            );
          } else {
            this.showComputerPartnerSelect(gameMode, 3);
          }
          return true;
        },
        keepOpen: true,
      },
      {
        label: i18next.t("menu:cancel"),
        handler: () => {
          this.showNewGameModeSelect();
          return true;
        },
        keepOpen: true,
      },
    ];

    this.showOptionSelectWithText(i18next.t("menu:selectPlayerCount"), options);
  }

  private showComputerPartnerSelect(
    gameMode: GameModes,
    playerCount: 2 | 3,
    firstPartnerKey?: ComputerPartnerKey,
    firstPartnerRolePreferences?: ComputerPartnerRolePreferences,
  ): void {
    const selectablePartnerKeys = firstPartnerKey
      ? COMPUTER_PARTNER_KEYS.filter(key => key !== firstPartnerKey)
      : COMPUTER_PARTNER_KEYS;
    const playerLabel = playerCount === 3 && firstPartnerKey ? "Player 3" : "Player 2";
    const options: OptionSelectItem[] = selectablePartnerKeys.map(key => {
      const profile = getComputerPartnerProfile(key);
      return {
        label: profile.name,
        handler: () => {
          if (key === "alex") {
            this.showAlexPreferenceSelect(gameMode, playerCount, key, firstPartnerKey, firstPartnerRolePreferences);
            return true;
          }

          if (playerCount === 3 && !firstPartnerKey) {
            this.showComputerPartnerSelect(gameMode, playerCount, key);
            return true;
          }

          this.setComputerPartner(1, firstPartnerKey ?? key, firstPartnerRolePreferences);
          if (playerCount === 3) {
            this.setComputerPartner(2, key);
          }
          globalScene.configureTwoPlayerMode(true, 6, true, playerCount);
          this.setModeAndEnd(gameMode);
          return true;
        },
      };
    });

    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        if (playerCount === 3 && firstPartnerKey) {
          this.showComputerPartnerSelect(gameMode, playerCount);
        } else {
          this.showPlayerCountSelect(gameMode);
        }
        return true;
      },
      keepOpen: true,
    });

    this.showOptionSelectWithText(`${i18next.t("menu:selectComputerPartner")} (${playerLabel})`, options);
  }

  private showAlexPreferenceSelect(
    gameMode: GameModes,
    playerCount: 2 | 3,
    key: ComputerPartnerKey,
    firstPartnerKey?: ComputerPartnerKey,
    firstPartnerRolePreferences?: ComputerPartnerRolePreferences,
    partySlot = 2,
    rolePreferences: ComputerPartnerRolePreferences = [],
  ): void {
    const continueWithPreference = (rolePreference: ComputerPartnerRole) => {
      const nextRolePreferences = [...rolePreferences, rolePreference];
      if (partySlot < 6) {
        this.showAlexPreferenceSelect(
          gameMode,
          playerCount,
          key,
          firstPartnerKey,
          firstPartnerRolePreferences,
          partySlot + 1,
          nextRolePreferences,
        );
        return;
      }

      if (playerCount === 3 && !firstPartnerKey) {
        this.showComputerPartnerSelect(gameMode, playerCount, key, nextRolePreferences);
        return;
      }

      this.setComputerPartner(1, firstPartnerKey ?? key, firstPartnerRolePreferences ?? nextRolePreferences);
      if (playerCount === 3) {
        this.setComputerPartner(2, key, nextRolePreferences);
      }
      globalScene.configureTwoPlayerMode(true, 6, true, playerCount);
      this.setModeAndEnd(gameMode);
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
          this.showComputerPartnerSelect(gameMode, playerCount, firstPartnerKey, firstPartnerRolePreferences);
          return true;
        },
        keepOpen: true,
      },
    ];

    this.showOptionSelectWithText(`Choose Alex's Slot ${partySlot} Preference`, options);
  }

  private setComputerPartner(
    playerIndex: 1 | 2,
    key: ComputerPartnerKey,
    rolePreferences?: ComputerPartnerRolePreferences,
  ): void {
    globalScene.setComputerPartnerKey(playerIndex, key);
    globalScene.setComputerPartnerRolePreferences(playerIndex, key === "alex" ? rolePreferences : undefined);
  }

  private showTwoPlayerModeSelect(gameMode: GameModes): void {
    const startTwoPlayer = (partySize: 3 | 6) => {
      if (gameMode === GameModes.DAILY) {
        globalScene.ui.setMode(UiMode.MESSAGE);
        globalScene.ui.showText(i18next.t("menu:twoPlayerDailyUnavailable"), null, () =>
          this.showPlayerCountSelect(gameMode),
        );
      } else {
        this.startMultiplayerRun(gameMode, 2, partySize);
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
        label: i18next.t("menu:twoPlayerHalfMode"),
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

    this.showOptionSelectWithText(i18next.t("menu:selectTwoPlayerMode"), options);
  }

  private startMultiplayerRun(gameMode: GameModes, playerCount: 2 | 3, partySize: 3 | 6): void {
    globalScene.configureTwoPlayerMode(true, partySize, false, playerCount);
    const runSeed = activeOverrides.SEED_OVERRIDE || getTwoPlayerRunSeedOverride() || randomString(24);
    globalScene.setSeed(runSeed);
    globalScene.resetSeed();
    const titleStart: TwoPlayerTitleStart = {
      action: "new-run",
      gameMode,
      partySize,
      playerCount,
      seed: runSeed,
    };
    console.info("[PokeRogue 2P] Broadcasting multiplayer run start", titleStart);
    globalScene.uiInputs?.broadcastTwoPlayerTitleStart(titleStart);
    globalScene.uiInputs?.broadcastTwoPlayerRunBootstrap(runSeed);
    this.waitForTwoPlayerProfilesBeforeRun(() => {
      globalScene.uiInputs?.broadcastTwoPlayerTitleStart(titleStart);
      globalScene.uiInputs?.broadcastTwoPlayerRunBootstrap(runSeed);
      this.setModeAndEnd(gameMode);
    });
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
          playerCount: globalScene.multiplayerPlayerCount === 3 ? 3 : 2,
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

      globalScene.configureTwoPlayerMode(true, titleStart.partySize ?? 6, false, titleStart.playerCount ?? 2);
      this.waitForTwoPlayerProfilesBeforeRun(() => this.setModeAndEnd(gameMode));
      return true;
    }

    if (titleStart.action === "load-session" && titleStart.slotId !== undefined) {
      void this.loadSaveSlot(titleStart.slotId, true, titleStart.seed);
      return true;
    }

    return false;
  }

  private waitForTwoPlayerProfilesBeforeRun(onReady: () => void): void {
    if (!globalScene.twoPlayerMode || globalScene.isTwoPlayerProfileExchangeComplete()) {
      onReady();
      return;
    }

    globalScene.waitForPlayerInput(0);
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      const waitingMessage =
        globalScene.multiplayerPlayerCount > 2 ? "Waiting for all player profiles..." : "Waiting for both player profiles...";
      globalScene.ui.showText(waitingMessage, null, null, null, false);
      globalScene.waitForTwoPlayerProfileExchange().then(ready => {
        if (ready) {
          globalScene.ui.clearText();
          onReady();
          return;
        }

        const retryMessage =
          globalScene.multiplayerPlayerCount > 2
            ? "Still waiting for the other player profiles."
            : "Still waiting for the other player profile.";
        globalScene.ui.showText(retryMessage, null, () =>
          this.waitForTwoPlayerProfilesBeforeRun(onReady),
        );
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

    if (!this.loaded && !globalScene.gameMode.isDaily) {
      globalScene.gameMode = getGameMode(this.gameMode);
      if (this.gameMode === GameModes.CHALLENGE) {
        globalScene.phaseManager.pushNew("SelectChallengePhase");
      } else {
        globalScene.phaseManager.pushNew("SelectStarterPhase");
      }
      globalScene.newArena(globalScene.gameMode.getStartingBiome());
    } else {
      audioManager.playBgm();
    }

    globalScene.phaseManager.pushNew("EncounterPhase", this.loaded);

    if (this.loaded) {
      if (globalScene.twoPlayerMode) {
        const playerIndexes = globalScene.getPlayerFieldOwners();

        globalScene.phaseManager.pushNew("ShowTrainerPhase");
        playerIndexes.forEach((_playerIndex, fieldIndex) => {
          globalScene.phaseManager.pushNew("SummonPhase", fieldIndex, true, true);
        });

        if (
          globalScene.currentBattle.battleType !== BattleType.TRAINER
          && (globalScene.currentBattle.waveIndex > 1 || !globalScene.gameMode.isDaily)
        ) {
          playerIndexes.forEach((playerIndex, fieldIndex) => {
            if (globalScene.getPokemonAllowedInBattle(playerIndex).length > 1) {
              globalScene.phaseManager.pushNew("CheckSwitchPhase", fieldIndex, true);
            }
          });
        }
      } else {
        const availablePartyMembers = globalScene.getPokemonAllowedInBattle().length;

        globalScene.phaseManager.pushNew("SummonPhase", 0, true, true);
        if (globalScene.currentBattle.double && availablePartyMembers > 1) {
          globalScene.phaseManager.pushNew("SummonPhase", 1, true, true);
        }

        if (
          globalScene.currentBattle.battleType !== BattleType.TRAINER
          && (globalScene.currentBattle.waveIndex > 1 || !globalScene.gameMode.isDaily)
        ) {
          const minPartySize = globalScene.currentBattle.double ? 2 : 1;
          if (availablePartyMembers > minPartySize) {
            globalScene.phaseManager.pushNew("CheckSwitchPhase", 0, globalScene.currentBattle.double);
            if (globalScene.currentBattle.double) {
              globalScene.phaseManager.pushNew("CheckSwitchPhase", 1, globalScene.currentBattle.double);
            }
          }
        }
      }
    }

    // TODO: Move this to a migrate script instead of running it on save slot load
    for (const achv of Object.keys(globalScene.gameData.achvUnlocks)) {
      if (Object.hasOwn(vouchers, achv) && achv !== "CLASSIC_VICTORY") {
        globalScene.validateVoucher(vouchers[achv]);
      }
    }

    super.end();
  }
}
