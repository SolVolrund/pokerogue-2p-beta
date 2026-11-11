// Designs replace the regular ball, not its inventory slot or other ball types.
export const BALL_DESIGNS = [
  "beast",
  "cherish",
  "dive",
  "dream",
  "dusk",
  "fast",
  "friend",
  "heal",
  "heavy",
  "level",
  "love",
  "lure",
  "luxury",
  "moon",
  "nest",
  "net",
  "park",
  "premier",
  "quick",
  "repeat",
  "safari",
  "sport",
  "strange",
  "timer",
] as const;
export type BallDesign = (typeof BALL_DESIGNS)[number];

// Acquisition is independent of save compatibility when a design moves to another event.
export const KURT_OFFER_POOL: readonly BallDesign[] = [...BALL_DESIGNS];

export function readBallDesign(value: unknown): BallDesign | undefined {
  return BALL_DESIGNS.find(design => design === value);
}

export function designBattleFrame(design: BallDesign): string {
  return design === "luxury" ? "lb" : design === "safari" ? "sb" : `${design}_ball`;
}

export function designBagFrame(design: BallDesign): string {
  return `kurt_${design}_ball`;
}
