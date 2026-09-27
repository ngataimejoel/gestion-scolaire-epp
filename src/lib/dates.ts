/** Date au format attendu par <input type="date"> (AAAA-MM-JJ). */
export const jourIso = (d?: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** Date affichée à la française (dates sans heure, stockées en UTC). */
export const dateFr = (d?: Date | null) => (d ? d.toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—");
