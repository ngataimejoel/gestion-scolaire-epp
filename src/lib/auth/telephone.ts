/**
 * Numéros ivoiriens à 10 chiffres (plan de numérotation 2021) :
 * mobiles 01, 05, 07 ; fixes 21, 25, 27. L'indicatif +225 / 00225 est accepté puis retiré.
 */
const PREFIXES = ["01", "05", "07", "21", "25", "27"];

export function normaliserTelephone(saisie: string): string | null {
  let n = saisie.replace(/[\s.\-()]/g, "");
  if (n.startsWith("+225")) n = n.slice(4);
  else if (n.startsWith("00225")) n = n.slice(5);
  if (!/^\d{10}$/.test(n)) return null;
  return PREFIXES.includes(n.slice(0, 2)) ? n : null;
}

/** 0707123456 → 07 07 12 34 56 */
export function formaterTelephone(n: string): string {
  return n.replace(/(\d{2})(?=\d)/g, "$1 ");
}

/** 07 07 12 34 56 → 07 •• •• •• 56 (affichage sans révéler le numéro complet) */
export function masquerTelephone(n: string): string {
  return `${n.slice(0, 2)}\u00a0••\u00a0••\u00a0••\u00a0${n.slice(-2)}`; // espaces insécables : jamais coupé en fin de ligne
}
