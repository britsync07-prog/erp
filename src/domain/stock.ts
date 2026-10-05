// Stock derivations (§10). Physical stock is derived from the ledger;
// reservations are separate rows. No mutable stock counter exists anywhere.
import { PHYSICAL_MOVEMENTS, type MovementType } from "./constants";

export interface StockInput {
  movements: { type: string; quantity: number }[]; // quantity in base unit, signed
  reserved: number; // base unit
  incoming: number; // confirmed PO qty not yet received, base unit
}

export interface StockLevels {
  physical: number;
  reserved: number;
  available: number;
  incoming: number;
  projected: number;
}

export function computeStockLevels(input: StockInput): StockLevels {
  const physical = input.movements
    .filter((m) => (PHYSICAL_MOVEMENTS as string[]).includes(m.type))
    .reduce((sum, m) => sum + m.quantity, 0);
  const reserved = Math.max(0, input.reserved);
  return {
    physical: round(physical),
    reserved: round(reserved),
    available: round(physical - reserved),
    incoming: round(Math.max(0, input.incoming)),
    projected: round(physical + Math.max(0, input.incoming) - reserved),
  };
}

/** Guard used before reserving: never allocate more than available. */
export function canReserve(available: number, requested: number): boolean {
  return requested > 0 && requested <= available + 1e-9;
}

/**
 * Levels from pre-aggregated sums (physical sum already excludes reservations,
 * which live in their own table). Used by overview queries that GROUP BY in SQL.
 */
export function levelsFromAggregates(physical: number, reserved: number, incoming: number): StockLevels {
  const r = Math.max(0, reserved);
  const inc = Math.max(0, incoming);
  return {
    physical: round(physical),
    reserved: round(r),
    available: round(physical - r),
    incoming: round(inc),
    projected: round(physical + inc - r),
  };
}

export function assertMovementType(type: string): asserts type is MovementType {
  if (!(PHYSICAL_MOVEMENTS as string[]).includes(type) && type !== "SALE_RESERVATION" && type !== "SALE_RESERVATION_RELEASE") {
    throw new Error(`Unknown movement type: ${type}.`);
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
