/** Formats d'affichage à la française (virgule décimale). */
export const f2 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2).replace(".", ","));
export const nombre = (n: number | null | undefined) => (n == null ? "—" : String(Math.round(n * 100) / 100).replace(".", ","));
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(1).replace(".", ",")} %`);
export const rangTexte = (rang: number | null, sexe: "M" | "F") => (rang == null ? "—" : rang === 1 ? (sexe === "F" ? "1re" : "1er") : `${rang}e`);
export const STATUTS = { PRESENT: "Présent", ABANDON: "Abandon", TRANSFERE: "Transféré" } as const;
