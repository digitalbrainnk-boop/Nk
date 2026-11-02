import type { SportCode } from "@/lib/sports/catalog";
import type { RiskLevel } from "./generator";
import type { CouponPeriod } from "./period";

/** Une ligne de coupon prête à afficher. */
export type TicketLeg = {
  key: string;
  sport: SportCode;
  competition: string;
  startsAt: string;
  home: string;
  away: string;
  /** Libellé lisible : « Victoire Lakers », « Plus de 2,5 buts »… */
  label: string;
  /** Notation courte du pari pour le retrouver chez le bookmaker. */
  notation: string;
  odd: number;
  probability: number | null;
  confidence: number | null;
};

export type BookingCode = { bookmaker: string; code: string; countryCode?: string | null };

export type GenerateCouponState =
  | { status: "idle" }
  | { status: "login_required" | "quota" | "empty" | "error"; message: string }
  | {
      status: "ok";
      couponId: string;
      legs: TicketLeg[];
      totalOdds: number;
      probability: number;
      oneIn: number;
      params: { targetOdds: number; risk: RiskLevel; period: CouponPeriod; sports: SportCode[] };
    };

export const initialGenerateState: GenerateCouponState = { status: "idle" };
