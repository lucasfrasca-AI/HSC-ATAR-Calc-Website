// Typed access to the course and scaling data in content/. No logic here.
import coursesJson from "../../content/courses.json" with { type: "json" };
import scalingJson from "../../content/scaling.json" with { type: "json" };

export type Anchor = [number | null, number | null];
export type TierKey = "low" | "below" | "average" | "above" | "strong";
export type LevelKey = "low" | "average" | "above" | "high";

export interface Course {
  id: string;
  name: string;
  nesaCode: string | null;
  area: string;
  units: 1 | 2;
  english: boolean;
  extension: boolean;
  excl: string | null;
  tier: TierKey;
  /** "reference": tier from the original spec; "default": generic average, no course-specific estimate */
  tierSource: "reference" | "default";
  anchors: Anchor[] | null;
}

export const CATALOG = coursesJson.courses as Course[];
export const TIERS = scalingJson.tiers as Record<TierKey, { label: string; anchors: Anchor[] }>;
export const COHORT_LEVELS = scalingJson.cohortLevels as Record<LevelKey, { label: string; mean: number }>;
export const ATAR_ANCHORS = scalingJson.atarAnchors;
export const RULES = scalingJson.rules;

const CUSTOM = CATALOG.find((c) => c.id === "custom")!;
export const courseById = (id: string): Course => CATALOG.find((c) => c.id === id) ?? CUSTOM;
export const isTier = (k: unknown): k is TierKey => typeof k === "string" && Object.hasOwn(TIERS, k);
export const isLevel = (k: unknown): k is LevelKey => typeof k === "string" && Object.hasOwn(COHORT_LEVELS, k);
