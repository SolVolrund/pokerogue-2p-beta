import { cachedFetch } from "#utils/fetch-utils";

export type ContestLayoutKind = "sprite" | "text-field" | "marker";

export interface ContestLayoutObject {
  kind: ContestLayoutKind;
  key: string;
  label: string;
  role: string;
  assetName: string | null;
  assetPath: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  phaseAppearance: string[];
  purpose?: string;
  when?: string;
}

export interface ContestLayoutData {
  schema: string;
  stage: {
    width: number;
    height: number;
    coordinateScale: "logical";
  };
  objects: ContestLayoutObject[];
}

const CONTEST_LAYOUT_URL = "images/contests/contest-layout.json";

let contestLayout: ContestLayoutData | undefined;
let contestLayoutLoading: Promise<ContestLayoutData> | undefined;

export function loadContestLayout(): Promise<ContestLayoutData> {
  if (contestLayout) {
    return Promise.resolve(contestLayout);
  }

  contestLayoutLoading ??= cachedFetch(CONTEST_LAYOUT_URL)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load contest layout: ${response.status} ${response.statusText}`);
      }

      return response.json() as Promise<ContestLayoutData>;
    })
    .then(layout => {
      contestLayout = layout;
      return layout;
    })
    .catch(error => {
      contestLayoutLoading = undefined;
      throw error;
    });

  return contestLayoutLoading;
}

export function getContestLayout(): ContestLayoutData {
  if (!contestLayout) {
    throw new Error("Contest layout has not been loaded. Call loadContestLayout() before creating the contest UI.");
  }

  return contestLayout;
}

export function getContestLayoutSpriteObjects(): ContestLayoutObject[] {
  return getContestLayout().objects.filter(object => object.kind === "sprite" && object.assetPath);
}

export function getContestLayoutObjectsForPhase(phaseName: string): ContestLayoutObject[] {
  return getContestLayout().objects.filter(object => object.phaseAppearance.includes(phaseName));
}
