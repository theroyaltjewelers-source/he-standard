import type { DomainKey } from "@/lib/scoring";

/** Fixed slot per domain — color follows the entity, never its rank. */
export const DOMAIN_COLOR: Record<DomainKey, string> = {
  reliability: "var(--d1)", discipline: "var(--d2)", fitness: "var(--d3)", planning: "var(--d4)",
  self_awareness: "var(--d5)", communication: "var(--d6)", learning: "var(--d7)",
};
