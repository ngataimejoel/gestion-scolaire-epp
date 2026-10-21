/* =====================================================================================
   Validation des données : chaque règle renvoie '' (valide) ou un message compréhensible.
   Les formulaires affichent le message sous le champ concerné ; la logique métier
   revalide toujours avant d'enregistrer (un bouton masqué n'est pas une protection).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = AK.cfg, u = AK.u;
  const V = {};

  /* ---------- Noms ---------- */
  const CIVIL = /^(M\.?|MR\.?|MME\.?|MLLE\.?|DR\.?)$/i;
  const motOk = (w) => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’-]+$/.test(w) && !/^(.)\1*$/i.test(w.replace(/['’-]/g, ''));
  /** Nom de personne : mots de 2 lettres au moins ; min = nombre de mots exigés (2 pour « nom et prénoms »). */
  V.nom = function (v, lib, min = 2, max = 80) {
    const s = String(v || '').trim();
    if (s.length > max) return `${lib} : ${max} caractères au maximum.`;
    const m = s.split(/\s+/).filter((w) => w && !CIVIL.test(w));
    if (m.length < min) return min > 1 ? `${lib} : nom et prénoms en entier (ex. KOFFI KOUADIO).` : `${lib} : à renseigner.`;
    return m.every(motOk) ? '' : `${lib} : lettres uniquement, 2 au moins par mot (ex. KOFFI KOUADIO).`;
  };
  V.civ = {
    de(n) {
      const m = String(n || '').trim().match(/^(MLLE|MME|MR|M)\.?\s+/i);
      return m ? { mlle: 'Mlle', mme: 'Mme' }[m[1].toLowerCase()] || 'M.' : '';
    },
    sans: (n) => String(n || '').trim().replace(/^(MLLE|MME|MR|M)\.?\s+/i, ''),
    avec: (c, n) => (C.CIVS.includes(c) ? c + ' ' : '') + u.majNomComplet(V.civ.sans(n))
  };

  /* ---------- Téléphones (Côte d'Ivoire) ---------- */
  V.telCI = (v) => {
    const n = String(v || '').replace(/[\s.\-()/]/g, '').replace(/^(?:\+|00)?225(?=\d{10}$)/, '');
    return /^0[157]\d{8}$/.test(n) ? '+225 ' + n.replace(/(\d\d)(?=\d)/g, '$1 ') : null;
  };
  V.tel = (v, lib) => (!String(v || '').trim() || V.telCI(v) ? '' : `${lib} : ${C.TEL_ERR}`);
  V.telPropre = (v) => V.telCI(v) || String(v || '').trim();

  /* ---------- Dates ---------- */
  V.date = (v, lib, { requise = false, min, max } = {}) => {
    if (!v) return requise ? `${lib} : date à renseigner.` : '';
    if (!u.estISO(v)) return `${lib} : date invalide.`;
    if (min && v < min) return `${lib} : la date doit être postérieure au ${u.fmtDate(min)}.`;
    if (max && v > max) return `${lib} : la date ne peut pas dépasser le ${u.fmtDate(max)}.`;
    return '';
  };
  V.periode = (du, au) => (du && au && au < du ? 'La date de fin est avant la date de début.' : '');
  /** Naissance plausible pour un élève du primaire (2 à 20 ans à la rentrée). */
  V.naissanceEleve = (v, anneeRentree) => {
    const e = V.date(v, 'Date de naissance', { requise: true, max: u.aujourdhui() });
    if (e) return e;
    const age = anneeRentree - Number(v.slice(0, 4));
    return age < 2 || age > 20 ? 'Date de naissance improbable pour un élève du primaire (âge entre 2 et 20 ans).' : '';
  };

  /* ---------- Scolarité ---------- */
  V.classe = (v, niveaux) => ((niveaux || C.TOUS_NIVEAUX).includes(v) ? '' : 'Classe inconnue : choisissez un niveau ouvert dans l’école.');
  V.anneeScolaire = (v) => {
    const m = String(v || '').match(/^(\d{4})\s*[–-]\s*(\d{4})$/);
    return m && Number(m[2]) === Number(m[1]) + 1 ? '' : 'Année scolaire au format 2026–2027.';
  };
  V.normAnnee = (v) => {
    const m = String(v || '').match(/^(\d{4})\s*[–-]\s*(\d{4})$/);
    return m ? `${m[1]}–${m[2]}` : String(v || '');
  };
  /** Matricule national (DESPS) : 6 à 12 caractères, lettres et chiffres (ex. 12345678A). */
  V.matNat = (v) => {
    const s = String(v || '').replace(/\s/g, '').toUpperCase();
    if (!s) return '';
    return /^[0-9A-Z]{6,12}$/.test(s) ? '' : 'Matricule national : 6 à 12 lettres ou chiffres, sans espace (ex. 12345678A).';
  };
  V.matriculeAgent = (v) => (!String(v || '').trim() || /^[0-9A-Za-z][0-9A-Za-z \-/.]{2,19}$/.test(String(v).trim()) ? '' : 'Matricule : 3 à 20 caractères (lettres, chiffres, espaces, - / .).');
  V.ecoleNom = (v, prive) => {
    const n = String(v || '').trim().replace(/\s+/g, ' ').toUpperCase();
    return (prive ? n.length >= 3 : /^EPP\s+\S/.test(n)) && n.length <= 80 ? n : null;
  };
  V.ECOLE_ERR = (prive) => (prive ? 'Saisissez le nom de l’école (3 caractères au moins).' : 'Une école publique a un nom commençant par EPP (ex. EPP OUANINOU 2).');
  /** DRENAET : « Touba » ou « DRENAET DE TOUBA » → libellé et direction régionale de l'en-tête */
  V.drenaetDe = (v) => {
    const l = String(v || '').trim().replace(/\s+/g, ' ').toUpperCase().replace(/^DRENA(?:ET)?\s*(?:(?:DE|DU|DES)(?:\s+|$)|D['’]\s*)?/, '').trim();
    if (!l) return null;
    const de = /^[AEIOUYÀÂÉÈÊÎÔ]/.test(l) ? "D'" : 'DE ';
    return { drenaet: 'DRENAET ' + de + l, direction: C.ENTETE.direction + ' ' + de + l };
  };
  V.texte = (v, lib, { requis = false, max = 200 } = {}) => {
    const s = String(v || '').trim();
    if (!s) return requis ? `${lib} : à renseigner.` : '';
    return s.length > max ? `${lib} : ${max} caractères au maximum.` : '';
  };
  V.montant = (v, lib, { min = 0, max = 100000000 } = {}) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? '' : `${lib} : montant entre ${min} et ${max.toLocaleString('fr-FR')} F.`;
  };
  /** Note saisie : nombre décimal (virgule ou point) entre 0 et max ; renvoie {v} ou {err}. */
  V.note = (raw, max) => {
    const s = String(raw ?? '').trim().replace(',', '.');
    if (s === '') return { v: null };
    if (!/^\d+(\.\d+)?$/.test(s)) return { err: `Note invalide : entrez un nombre entre 0 et ${max}.` };
    // deux décimales au plus, contrôlées sur le texte (8,7 * 100 n'est pas exactement 870 en binaire)
    if (/\.\d{3,}$/.test(s)) return { err: 'Note invalide : deux décimales au plus.' };
    const v = Number(s);
    if (v > max) return { err: `Note invalide : ${String(v).replace('.', ',')} dépasse le barème (${max}).` };
    return { v };
  };

  /* ---------- Références documentaires ----------
     Format : AK-<TYPE>-<ANNÉE>-<NUMÉRO sur 6 chiffres>-<CLÉ>, ex. AK-CSC-2026-000042-7.
     La clé (Luhn mod 36) détecte une erreur de frappe sur un caractère et la plupart des inversions. */
  const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  V.cleLuhn36 = (s) => {
    const t = String(s).toUpperCase().replace(/[^0-9A-Z]/g, '');
    let facteur = 2, somme = 0;
    for (let i = t.length - 1; i >= 0; i--) {
      let a = facteur * B36.indexOf(t[i]);
      facteur = facteur === 2 ? 1 : 2;
      a = Math.floor(a / 36) + (a % 36);
      somme += a;
    }
    return B36[(36 - (somme % 36)) % 36];
  };
  V.reference = (type, annee, numero) => {
    const base = `AK-${type}-${annee}-${u.pad(numero, 6)}`;
    return `${base}-${V.cleLuhn36(base)}`;
  };
  V.refValide = (ref) => {
    const m = String(ref || '').trim().toUpperCase().match(/^(AK-[A-Z]{3}-\d{4}-\d{6})-([0-9A-Z])$/);
    return !!m && V.cleLuhn36(m[1]) === m[2];
  };
  V.normRef = (ref) => String(ref || '').trim().toUpperCase().replace(/\s+/g, '');

  /* ---------- Mot de passe ---------- */
  V.motDePasse = (p, lib = 'Mot de passe') => {
    const s = String(p || '');
    if (s.length < C.SECU.MDP_MIN) return `${lib} : ${C.SECU.MDP_MIN} caractères au moins.`;
    if (s.length > 128) return `${lib} : 128 caractères au maximum.`;
    if (/^(.)\1+$/.test(s) || /^(?:0123456789|123456789|12345678|azertyui|password|motdepasse|admin123)/i.test(s))
      return `${lib} : trop facile à deviner.`;
    if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return `${lib} : mélangez des lettres et au moins un chiffre.`;
    return '';
  };
  V.forceMotDePasse = (p) => {
    const s = String(p || '');
    let n = 0;
    if (s.length >= 8) n++;
    if (s.length >= 12) n++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) n++;
    if (/\d/.test(s)) n++;
    if (/[^A-Za-z0-9]/.test(s)) n++;
    return Math.min(4, n);
  };

  AK.valid = V;
})(window.AK);
