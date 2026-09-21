import { z } from "zod";

const PaceCapsSchema = z.object({
  activeHours: z.number().positive(),
  areasPerDay: z.number().int().positive(),
  walkingKm: z.number().positive(),
  restBlockMin: z.number().int().min(0),
});

const TierLimitsSchema = z.object({
  /** null = unlimited lifetime generations. */
  lifetimeGenerations: z.number().int().min(0).nullable(),
  newPlansPerMonth: z.number().int().min(0).nullable(),
  regenerationsPerMonth: z.number().int().min(0).nullable(),
  refineIterations: z.number().int().min(1).max(5),
  maxNights: z.number().int().positive(),
  vacationTypes: z.number().int().positive().nullable(),
  interestTags: z.number().int().positive().nullable(),
  mustVisits: z.number().int().positive().nullable(),
  briefChars: z.number().int().positive(),
  notes: z.number().int().min(0),
  noteChars: z.number().int().positive(),
});

export const AppConfigSchema = z.object({
  version: z.number().int().positive(),
  pace: z.object({ chill: PaceCapsSchema, balanced: PaceCapsSchema, packed: PaceCapsSchema }),
  tiers: z.object({ free: TierLimitsSchema, plus: TierLimitsSchema }),
  engine: z.object({
    shortlistSize: z.number().int().positive(),
    fastPackTargetPlaces: z.number().int().positive(),
    dayTripRadiusMin: z.number().int().positive(),
    scoutingUsesBestChain: z.boolean(),
  }),
  admin: z.object({ freshAuthMaxAgeSec: z.number().int().positive() }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Spec §3.5, §1.4, §7 defaults. Admin-tunable at runtime (config/current) in later phases. */
export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  pace: {
    chill: { activeHours: 5, areasPerDay: 2, walkingKm: 5, restBlockMin: 90 },
    balanced: { activeHours: 7, areasPerDay: 4, walkingKm: 8, restBlockMin: 60 },
    packed: { activeHours: 9.5, areasPerDay: 6, walkingKm: 12, restBlockMin: 0 },
  },
  tiers: {
    free: {
      lifetimeGenerations: 1,
      newPlansPerMonth: 0,
      regenerationsPerMonth: 0,
      refineIterations: 2,
      maxNights: 7,
      vacationTypes: 2,
      interestTags: 3,
      mustVisits: 3,
      briefChars: 300,
      notes: 2,
      noteChars: 240,
    },
    plus: {
      lifetimeGenerations: null,
      newPlansPerMonth: 3,
      regenerationsPerMonth: 10,
      refineIterations: 3,
      maxNights: 21,
      vacationTypes: null,
      interestTags: null,
      mustVisits: null,
      briefChars: 1500,
      notes: 10,
      noteChars: 240,
    },
  },
  engine: {
    shortlistSize: 180,
    fastPackTargetPlaces: 250,
    dayTripRadiusMin: 90,
    scoutingUsesBestChain: false,
  },
  admin: { freshAuthMaxAgeSec: 15 * 60 },
};
