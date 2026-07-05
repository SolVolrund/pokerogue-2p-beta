import contestLayoutJson from "../../../assets/images/contests/contest-layout.json";

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

export const contestLayout = contestLayoutJson as ContestLayoutData;

export function getContestLayoutSpriteObjects(): ContestLayoutObject[] {
  return contestLayout.objects.filter(object => object.kind === "sprite" && object.assetPath);
}

export function getContestLayoutObjectsForPhase(phaseName: string): ContestLayoutObject[] {
  return contestLayout.objects.filter(object => object.phaseAppearance.includes(phaseName));
}
