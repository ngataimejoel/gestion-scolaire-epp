// Accès aux données : appelle le processus principal Electron (voir electron/db.js).

export type Sexe = "M" | "F";
export type GFT = { G: number; F: number; T: number };

export type Ecole = {
  nom: string; code: string; iepp: string; dren: string; directeur: string;
  contact: string; annee_scolaire: string; moyenne_admission: number;
};
export type Personnel = {
  id?: number; matricule: string; nom: string; prenoms: string; sexe: Sexe;
  date_naissance: string; fonction: string; telephone: string;
};
export type Classe = {
  id?: number; nom: string; niveau: string; enseignant_id: number | null;
  enseignant?: string | null; garcons?: number; filles?: number;
};
export type Eleve = {
  id?: number; matricule: string; nom: string; prenoms: string; sexe: Sexe;
  date_naissance: string; lieu_naissance: string; classe_id: number | null;
  redoublant: number; nom_parent: string; contact_parent: string;
  classe?: string | null; niveau?: string | null;
};
export type Matiere = { id?: number; niveau: string; nom: string; bareme: number; groupe: "FR" | "MATH" | "AUTRE"; ordre: number };
export type Composition = { id?: number; libelle: string; date: string };
export type Grille = {
  classe: Classe; eleves: Eleve[]; matieres: Matiere[];
  notes: Record<string, number>; absents: number[];
};
export type LigneResultat = Eleve & {
  absent: boolean; non_note: boolean; total: number; moyenne: number; moyenne_fr: number; moyenne_math: number;
  notes: Record<number, number | null>; rang: number | null; appreciation: string; admis: boolean;
};
export type Resultats = { classe: Classe; matieres: Matiere[]; total_bareme: number; seuil: number; lignes: LigneResultat[] };
export type LigneRapport = { niveau: string; inscrits: GFT; presents: GFT; admis: GFT; taux: GFT };
export type Meilleurs = { niveau: string; eleves: (LigneResultat & { note: number; rang_niveau: number })[] }[];
export type TableauDeBord = {
  ecole: Ecole; classes: Classe[]; personnel: number; compositions: number;
  eleves: { G: number; F: number; redoublants: number; sans_classe: number };
};

type Pont = {
  db: (methode: string, ...args: unknown[]) => Promise<unknown>;
  sauvegarder: () => Promise<string | null>;
  restaurer: () => Promise<string | null>;
  infos: () => Promise<{ version: string; base: string; sauvegardes: string }>;
};

declare global {
  interface Window { ecole?: Pont }
}

function pont(): Pont {
  if (typeof window === "undefined" || !window.ecole)
    throw new Error("Cette interface doit être ouverte depuis l'application Gestion Scolaire EPP.");
  return window.ecole;
}

// Electron préfixe les erreurs ("Error invoking remote method 'db': Error: ...") : on garde le message utile.
function nettoyer(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  throw new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
}

function appel<T>(methode: string, ...args: unknown[]): Promise<T> {
  return (pont().db(methode, ...args) as Promise<T>).catch(nettoyer);
}

export const api = {
  niveaux: () => appel<string[]>("niveaux"),
  ecole: () => appel<Ecole>("ecole"),
  enregistrerEcole: (e: Ecole) => appel<Ecole>("enregistrerEcole", e),
  personnel: () => appel<Personnel[]>("personnel"),
  enregistrerPersonnel: (p: Personnel) => appel<number>("enregistrerPersonnel", p),
  supprimerPersonnel: (id: number) => appel<number>("supprimerPersonnel", id),
  classes: () => appel<Classe[]>("classes"),
  enregistrerClasse: (c: Classe) => appel<number>("enregistrerClasse", c),
  supprimerClasse: (id: number) => appel<number>("supprimerClasse", id),
  eleves: (classeId?: number | null) => appel<Eleve[]>("eleves", classeId ?? null),
  enregistrerEleve: (e: Eleve) => appel<number>("enregistrerEleve", e),
  supprimerEleve: (id: number) => appel<number>("supprimerEleve", id),
  importerEleves: (classeId: number | null, lignes: Partial<Eleve>[]) =>
    appel<{ ajoutes: number; ignores: number }>("importerEleves", classeId, lignes),
  matieres: (niveau?: string) => appel<Matiere[]>("matieres", niveau ?? null),
  enregistrerMatiere: (m: Matiere) => appel<number>("enregistrerMatiere", m),
  supprimerMatiere: (id: number) => appel<number>("supprimerMatiere", id),
  compositions: () => appel<Composition[]>("compositions"),
  enregistrerComposition: (c: Composition) => appel<number>("enregistrerComposition", c),
  supprimerComposition: (id: number) => appel<number>("supprimerComposition", id),
  grille: (compositionId: number, classeId: number) => appel<Grille>("grille", compositionId, classeId),
  enregistrerNotes: (
    compositionId: number,
    saisie: { notes: { eleve_id: number; matiere_id: number; note: number | null }[]; absences: Record<number, boolean> }
  ) => appel<boolean>("enregistrerNotes", compositionId, saisie),
  resultats: (compositionId: number, classeId: number) => appel<Resultats>("resultats", compositionId, classeId),
  rapport: (compositionId: number) => appel<{ niveaux: LigneRapport[]; total: LigneRapport }>("rapport", compositionId),
  meilleurs: (compositionId: number, critere: "moyenne" | "fr" | "math", nombre: number) =>
    appel<Meilleurs>("meilleurs", compositionId, critere, nombre),
  tableauDeBord: () => appel<TableauDeBord>("tableauDeBord"),
  sauvegarder: () => pont().sauvegarder().catch(nettoyer),
  restaurer: () => pont().restaurer().catch(nettoyer),
  infos: () => pont().infos(),
};

export function dateFr(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "";
}

export function age(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return String(a);
}

export const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
