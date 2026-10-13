// Couche de données : une base SQLite locale (module node:sqlite intégré à Electron).
// Ce module ne dépend pas d'Electron afin de pouvoir être testé avec Node seul.
const { DatabaseSync } = require("node:sqlite");

const NIVEAUX = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"];

// Barèmes par défaut, modifiables dans Paramètres > Matières.
// CM1/CM2 reprennent la grille de composition SmartIEPP (total 170).
const MATIERES_DEFAUT = {
  CP: [
    ["Graphisme / Écriture", 20, "FR"],
    ["Lecture", 20, "FR"],
    ["Expression orale", 20, "FR"],
    ["Copie / Dictée", 20, "FR"],
    ["Mathématiques", 50, "MATH"],
    ["Éveil scientifique", 20, "AUTRE"],
    ["EDHC", 10, "AUTRE"],
  ],
  CE: [
    ["Exploitation de texte", 30, "FR"],
    ["Orthographe / Dictée", 20, "FR"],
    ["Expression écrite", 20, "FR"],
    ["Mathématiques", 50, "MATH"],
    ["Histoire-Géographie", 20, "AUTRE"],
    ["Sciences", 20, "AUTRE"],
    ["EDHC", 10, "AUTRE"],
  ],
  CM: [
    ["Compréhension de texte", 15, "FR"],
    ["Maniement de la langue", 20, "FR"],
    ["Expression écrite", 15, "FR"],
    ["Dictée", 20, "FR"],
    ["Opérations", 12, "MATH"],
    ["Mesures et grandeurs", 12, "MATH"],
    ["Géométrie", 10, "MATH"],
    ["Raisonnement logique", 16, "MATH"],
    ["Histoire-Géographie", 20, "AUTRE"],
    ["EDHC", 10, "AUTRE"],
    ["Sciences", 20, "AUTRE"],
  ],
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ecole (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nom TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  iepp TEXT NOT NULL DEFAULT '',
  dren TEXT NOT NULL DEFAULT '',
  directeur TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  annee_scolaire TEXT NOT NULL DEFAULT '',
  moyenne_admission REAL NOT NULL DEFAULT 5
);
CREATE TABLE IF NOT EXISTS personnel (
  id INTEGER PRIMARY KEY,
  matricule TEXT NOT NULL DEFAULT '',
  nom TEXT NOT NULL,
  prenoms TEXT NOT NULL DEFAULT '',
  sexe TEXT NOT NULL DEFAULT 'M' CHECK (sexe IN ('M','F')),
  date_naissance TEXT NOT NULL DEFAULT '',
  fonction TEXT NOT NULL DEFAULT 'Instituteur',
  telephone TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL,
  niveau TEXT NOT NULL,
  enseignant_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS eleves (
  id INTEGER PRIMARY KEY,
  matricule TEXT NOT NULL DEFAULT '',
  nom TEXT NOT NULL,
  prenoms TEXT NOT NULL DEFAULT '',
  sexe TEXT NOT NULL DEFAULT 'M' CHECK (sexe IN ('M','F')),
  date_naissance TEXT NOT NULL DEFAULT '',
  lieu_naissance TEXT NOT NULL DEFAULT '',
  classe_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  redoublant INTEGER NOT NULL DEFAULT 0,
  nom_parent TEXT NOT NULL DEFAULT '',
  contact_parent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS eleves_classe ON eleves(classe_id);
CREATE TABLE IF NOT EXISTS matieres (
  id INTEGER PRIMARY KEY,
  niveau TEXT NOT NULL,
  nom TEXT NOT NULL,
  bareme REAL NOT NULL CHECK (bareme > 0),
  groupe TEXT NOT NULL DEFAULT 'AUTRE' CHECK (groupe IN ('FR','MATH','AUTRE')),
  ordre INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS compositions (
  id INTEGER PRIMARY KEY,
  libelle TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS notes (
  composition_id INTEGER NOT NULL REFERENCES compositions(id) ON DELETE CASCADE,
  eleve_id INTEGER NOT NULL REFERENCES eleves(id) ON DELETE CASCADE,
  matiere_id INTEGER NOT NULL REFERENCES matieres(id) ON DELETE CASCADE,
  note REAL NOT NULL,
  PRIMARY KEY (composition_id, eleve_id, matiere_id)
);
CREATE TABLE IF NOT EXISTS absences (
  composition_id INTEGER NOT NULL REFERENCES compositions(id) ON DELETE CASCADE,
  eleve_id INTEGER NOT NULL REFERENCES eleves(id) ON DELETE CASCADE,
  PRIMARY KEY (composition_id, eleve_id)
);
`;

function txt(v) {
  return v == null ? "" : String(v).trim();
}

function sexe(v) {
  const s = txt(v).toUpperCase();
  return s.startsWith("F") ? "F" : "M";
}

function appreciation(moy) {
  if (moy >= 8.5) return "Excellent";
  if (moy >= 7) return "Très bien";
  if (moy >= 6) return "Bien";
  if (moy >= 5) return "Passable";
  if (moy >= 4) return "Insuffisant";
  return "Faible";
}

function arrondi(n) {
  return Math.round(n * 100) / 100;
}

// Rang avec ex-aequo (1, 2, 2, 4...) sur la clé donnée, décroissant.
function classer(items, cle, champRang) {
  const tries = [...items].sort((a, b) => b[cle] - a[cle]);
  tries.forEach((it, i) => {
    it[champRang] =
      i > 0 && tries[i - 1][cle] === it[cle] ? tries[i - 1][champRang] : i + 1;
  });
  return tries;
}

function ouvrir(chemin) {
  const db = new DatabaseSync(chemin);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  db.prepare("INSERT OR IGNORE INTO ecole (id) VALUES (1)").run();
  if (db.prepare("SELECT COUNT(*) n FROM matieres").get().n === 0) {
    const ins = db.prepare(
      "INSERT INTO matieres (niveau, nom, bareme, groupe, ordre) VALUES (?, ?, ?, ?, ?)"
    );
    for (const niveau of NIVEAUX) {
      MATIERES_DEFAUT[niveau.slice(0, 2)].forEach(([nom, bareme, groupe], i) =>
        ins.run(niveau, nom, bareme, groupe, i)
      );
    }
  }
  return db;
}

function transaction(db, fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// Construit l'API exposée à l'interface. Chaque méthode reçoit des données simples
// (sérialisables) et renvoie des objets simples.
function creerApi(db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
  const get = (sql, ...p) => {
    const r = db.prepare(sql).get(...p);
    return r ? { ...r } : null;
  };
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  const api = {
    niveaux: () => NIVEAUX,

    // --- École ---
    ecole: () => get("SELECT * FROM ecole WHERE id = 1"),
    enregistrerEcole: (e) => {
      run(
        `UPDATE ecole SET nom=?, code=?, iepp=?, dren=?, directeur=?, contact=?,
         annee_scolaire=?, moyenne_admission=? WHERE id = 1`,
        txt(e.nom), txt(e.code), txt(e.iepp), txt(e.dren), txt(e.directeur),
        txt(e.contact), txt(e.annee_scolaire), Number(e.moyenne_admission) || 5
      );
      return api.ecole();
    },

    // --- Personnel ---
    personnel: () => all("SELECT * FROM personnel ORDER BY nom, prenoms"),
    enregistrerPersonnel: (p) => {
      const v = [
        txt(p.matricule), txt(p.nom).toUpperCase(), txt(p.prenoms), sexe(p.sexe),
        txt(p.date_naissance), txt(p.fonction) || "Instituteur", txt(p.telephone),
      ];
      if (!v[1]) throw new Error("Le nom est obligatoire.");
      if (p.id) {
        run(
          `UPDATE personnel SET matricule=?, nom=?, prenoms=?, sexe=?, date_naissance=?,
           fonction=?, telephone=? WHERE id=?`, ...v, p.id
        );
        return p.id;
      }
      return Number(
        run(
          `INSERT INTO personnel (matricule, nom, prenoms, sexe, date_naissance, fonction, telephone)
           VALUES (?, ?, ?, ?, ?, ?, ?)`, ...v
        ).lastInsertRowid
      );
    },
    supprimerPersonnel: (id) => run("DELETE FROM personnel WHERE id=?", id).changes,

    // --- Classes ---
    classes: () =>
      all(
        `SELECT c.*, TRIM(p.nom || ' ' || p.prenoms) AS enseignant,
           (SELECT COUNT(*) FROM eleves e WHERE e.classe_id = c.id AND e.sexe='M') AS garcons,
           (SELECT COUNT(*) FROM eleves e WHERE e.classe_id = c.id AND e.sexe='F') AS filles
         FROM classes c LEFT JOIN personnel p ON p.id = c.enseignant_id
         ORDER BY CASE c.niveau ${NIVEAUX.map((n, i) => `WHEN '${n}' THEN ${i}`).join(" ")} END, c.nom`
      ),
    enregistrerClasse: (c) => {
      const nom = txt(c.nom);
      if (!nom) throw new Error("Le nom de la classe est obligatoire.");
      if (!NIVEAUX.includes(c.niveau)) throw new Error("Niveau inconnu.");
      const ens = c.enseignant_id ? Number(c.enseignant_id) : null;
      if (c.id) {
        run("UPDATE classes SET nom=?, niveau=?, enseignant_id=? WHERE id=?", nom, c.niveau, ens, c.id);
        return c.id;
      }
      return Number(
        run("INSERT INTO classes (nom, niveau, enseignant_id) VALUES (?, ?, ?)", nom, c.niveau, ens)
          .lastInsertRowid
      );
    },
    supprimerClasse: (id) => run("DELETE FROM classes WHERE id=?", id).changes,

    // --- Élèves ---
    eleves: (classeId) =>
      all(
        `SELECT e.*, c.nom AS classe, c.niveau FROM eleves e
         LEFT JOIN classes c ON c.id = e.classe_id
         ${classeId ? "WHERE e.classe_id = ?" : ""}
         ORDER BY e.nom, e.prenoms`,
        ...(classeId ? [classeId] : [])
      ),
    enregistrerEleve: (e) => {
      const v = [
        txt(e.matricule).toUpperCase(), txt(e.nom).toUpperCase(), txt(e.prenoms).toUpperCase(),
        sexe(e.sexe), txt(e.date_naissance), txt(e.lieu_naissance),
        e.classe_id ? Number(e.classe_id) : null, e.redoublant ? 1 : 0,
        txt(e.nom_parent), txt(e.contact_parent),
      ];
      if (!v[1]) throw new Error("Le nom est obligatoire.");
      if (v[0]) {
        const doublon = get("SELECT id FROM eleves WHERE matricule = ? AND id != ?", v[0], e.id || 0);
        if (doublon) throw new Error(`Le matricule ${v[0]} existe déjà.`);
      }
      if (e.id) {
        run(
          `UPDATE eleves SET matricule=?, nom=?, prenoms=?, sexe=?, date_naissance=?, lieu_naissance=?,
           classe_id=?, redoublant=?, nom_parent=?, contact_parent=? WHERE id=?`, ...v, e.id
        );
        return e.id;
      }
      return Number(
        run(
          `INSERT INTO eleves (matricule, nom, prenoms, sexe, date_naissance, lieu_naissance,
           classe_id, redoublant, nom_parent, contact_parent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...v
        ).lastInsertRowid
      );
    },
    supprimerEleve: (id) => run("DELETE FROM eleves WHERE id=?", id).changes,

    // Importe des lignes déjà lues depuis Excel par l'interface.
    // Les élèves dont le matricule existe déjà sont ignorés.
    importerEleves: (classeId, lignes) =>
      transaction(db, () => {
        let ajoutes = 0, ignores = 0;
        for (const l of lignes) {
          const nom = txt(l.nom);
          const matricule = txt(l.matricule).toUpperCase();
          if (!nom || (matricule && get("SELECT id FROM eleves WHERE matricule = ?", matricule))) {
            ignores++;
            continue;
          }
          api.enregistrerEleve({ ...l, matricule, classe_id: classeId });
          ajoutes++;
        }
        return { ajoutes, ignores };
      }),

    // --- Matières ---
    matieres: (niveau) =>
      all(
        `SELECT * FROM matieres ${niveau ? "WHERE niveau = ?" : ""} ORDER BY niveau, ordre, id`,
        ...(niveau ? [niveau] : [])
      ),
    enregistrerMatiere: (m) => {
      const nom = txt(m.nom);
      const bareme = Number(m.bareme);
      if (!nom || !(bareme > 0)) throw new Error("Nom et barème (> 0) obligatoires.");
      const groupe = ["FR", "MATH"].includes(m.groupe) ? m.groupe : "AUTRE";
      if (m.id) {
        run("UPDATE matieres SET nom=?, bareme=?, groupe=?, ordre=? WHERE id=?", nom, bareme, groupe, Number(m.ordre) || 0, m.id);
        return m.id;
      }
      if (!NIVEAUX.includes(m.niveau)) throw new Error("Niveau inconnu.");
      const ordre = get("SELECT COALESCE(MAX(ordre), -1) + 1 o FROM matieres WHERE niveau=?", m.niveau).o;
      return Number(
        run("INSERT INTO matieres (niveau, nom, bareme, groupe, ordre) VALUES (?, ?, ?, ?, ?)", m.niveau, nom, bareme, groupe, ordre)
          .lastInsertRowid
      );
    },
    supprimerMatiere: (id) => run("DELETE FROM matieres WHERE id=?", id).changes,

    // --- Compositions ---
    compositions: () => all("SELECT * FROM compositions ORDER BY date DESC, id DESC"),
    enregistrerComposition: (c) => {
      const libelle = txt(c.libelle);
      if (!libelle) throw new Error("Le libellé est obligatoire.");
      if (c.id) {
        run("UPDATE compositions SET libelle=?, date=? WHERE id=?", libelle, txt(c.date), c.id);
        return c.id;
      }
      return Number(run("INSERT INTO compositions (libelle, date) VALUES (?, ?)", libelle, txt(c.date)).lastInsertRowid);
    },
    supprimerComposition: (id) => run("DELETE FROM compositions WHERE id=?", id).changes,

    // Grille de saisie : élèves de la classe, matières du niveau, notes et absences existantes.
    grille: (compositionId, classeId) => {
      const classe = get("SELECT * FROM classes WHERE id=?", classeId);
      if (!classe) throw new Error("Classe introuvable.");
      const eleves = api.eleves(classeId);
      const matieres = api.matieres(classe.niveau);
      const notes = {};
      for (const n of all(
        `SELECT n.eleve_id, n.matiere_id, n.note FROM notes n JOIN eleves e ON e.id = n.eleve_id
         WHERE n.composition_id = ? AND e.classe_id = ?`, compositionId, classeId
      )) notes[`${n.eleve_id}:${n.matiere_id}`] = n.note;
      const absents = all(
        `SELECT a.eleve_id FROM absences a JOIN eleves e ON e.id = a.eleve_id
         WHERE a.composition_id = ? AND e.classe_id = ?`, compositionId, classeId
      ).map((a) => a.eleve_id);
      return { classe, eleves, matieres, notes, absents };
    },

    // saisie = { notes: [{eleve_id, matiere_id, note|null}], absences: {eleve_id: bool} }
    enregistrerNotes: (compositionId, saisie) =>
      transaction(db, () => {
        const bareme = new Map(all("SELECT id, bareme FROM matieres").map((m) => [m.id, m.bareme]));
        const del = db.prepare("DELETE FROM notes WHERE composition_id=? AND eleve_id=? AND matiere_id=?");
        const up = db.prepare(
          `INSERT INTO notes (composition_id, eleve_id, matiere_id, note) VALUES (?, ?, ?, ?)
           ON CONFLICT DO UPDATE SET note = excluded.note`
        );
        for (const n of saisie.notes || []) {
          if (n.note === null || n.note === "" || n.note === undefined) {
            del.run(compositionId, n.eleve_id, n.matiere_id);
            continue;
          }
          const v = Number(n.note);
          const max = bareme.get(n.matiere_id);
          if (Number.isNaN(v) || v < 0 || max === undefined || v > max)
            throw new Error(`Note invalide (${n.note}) : elle doit être entre 0 et ${max}.`);
          up.run(compositionId, n.eleve_id, n.matiere_id, v);
        }
        for (const [eleveId, absent] of Object.entries(saisie.absences || {})) {
          if (absent) run("INSERT OR IGNORE INTO absences VALUES (?, ?)", compositionId, Number(eleveId));
          else run("DELETE FROM absences WHERE composition_id=? AND eleve_id=?", compositionId, Number(eleveId));
        }
        return true;
      }),

    // Résultats d'une classe : total, moyenne sur 10, rang, appréciation.
    resultats: (compositionId, classeId) => {
      const { classe, eleves, matieres, notes, absents } = api.grille(compositionId, classeId);
      const seuil = api.ecole().moyenne_admission;
      const sur = (groupe) => matieres.filter((m) => !groupe || m.groupe === groupe);
      const moyenne = (e, groupe) => {
        const ms = sur(groupe);
        const max = ms.reduce((s, m) => s + m.bareme, 0);
        const tot = ms.reduce((s, m) => s + (notes[`${e.id}:${m.id}`] || 0), 0);
        return { total: arrondi(tot), moyenne: max ? arrondi((tot / max) * 10) : 0 };
      };
      const lignes = eleves.map((e) => {
        const g = moyenne(e, null);
        return {
          ...e,
          absent: absents.includes(e.id),
          // Élève sans aucune note saisie : pas encore composé, exclu du classement.
          non_note: matieres.every((m) => notes[`${e.id}:${m.id}`] === undefined),
          total: g.total,
          moyenne: g.moyenne,
          moyenne_fr: moyenne(e, "FR").moyenne,
          moyenne_math: moyenne(e, "MATH").moyenne,
          notes: Object.fromEntries(matieres.map((m) => [m.id, notes[`${e.id}:${m.id}`] ?? null])),
        };
      });
      const presents = classer(lignes.filter((l) => !l.absent && !l.non_note), "moyenne", "rang");
      for (const l of presents) {
        l.appreciation = appreciation(l.moyenne);
        l.admis = l.moyenne >= seuil;
      }
      const absentsL = lignes
        .filter((l) => l.absent || l.non_note)
        .map((l) => ({ ...l, rang: null, appreciation: l.absent ? "Absent" : "Non noté", admis: false }));
      return {
        classe,
        matieres,
        total_bareme: matieres.reduce((s, m) => s + m.bareme, 0),
        seuil,
        lignes: [...presents, ...absentsL],
      };
    },

    // Rapport statistique par niveau (inscrits, présents, admis, taux) pour toute l'école.
    rapport: (compositionId) => {
      const vide = () => ({ G: 0, F: 0, T: 0 });
      const parNiveau = Object.fromEntries(
        NIVEAUX.map((n) => [n, { niveau: n, inscrits: vide(), presents: vide(), admis: vide() }])
      );
      for (const c of api.classes()) {
        const r = api.resultats(compositionId, c.id);
        const s = parNiveau[c.niveau];
        for (const l of r.lignes) {
          const k = l.sexe === "F" ? "F" : "G";
          s.inscrits[k]++; s.inscrits.T++;
          if (l.rang) { s.presents[k]++; s.presents.T++; }
          if (l.admis) { s.admis[k]++; s.admis.T++; }
        }
      }
      const taux = (a, p) => (p ? arrondi((a / p) * 100) : 0);
      const niveaux = Object.values(parNiveau).filter((s) => s.inscrits.T > 0);
      for (const s of niveaux)
        s.taux = { G: taux(s.admis.G, s.presents.G), F: taux(s.admis.F, s.presents.F), T: taux(s.admis.T, s.presents.T) };
      const total = { niveau: "TOTAL", inscrits: vide(), presents: vide(), admis: vide() };
      for (const s of niveaux)
        for (const k of ["inscrits", "presents", "admis"])
          for (const x of ["G", "F", "T"]) total[k][x] += s[k][x];
      total.taux = { G: taux(total.admis.G, total.presents.G), F: taux(total.admis.F, total.presents.F), T: taux(total.admis.T, total.presents.T) };
      return { niveaux, total };
    },

    // Meilleurs élèves par niveau, selon la moyenne générale, le français ou les mathématiques.
    meilleurs: (compositionId, critere = "moyenne", nombre = 3) => {
      const cle = { moyenne: "moyenne", fr: "moyenne_fr", math: "moyenne_math" }[critere] || "moyenne";
      const parNiveau = {};
      for (const c of api.classes()) {
        const r = api.resultats(compositionId, c.id);
        for (const l of r.lignes.filter((l) => l.rang))
          (parNiveau[c.niveau] ||= []).push({ ...l, note: l[cle] });
      }
      return NIVEAUX.filter((n) => parNiveau[n]).map((n) => ({
        niveau: n,
        eleves: classer(parNiveau[n], "note", "rang_niveau")
          .filter((l) => l.rang_niveau <= nombre)
          .map((l) => ({ ...l, appreciation: appreciation(l.note) })),
      }));
    },

    // --- Tableau de bord ---
    tableauDeBord: () => {
      const classes = api.classes();
      const compte = (sql) => get(sql).n;
      return {
        ecole: api.ecole(),
        classes,
        eleves: {
          G: compte("SELECT COUNT(*) n FROM eleves WHERE sexe='M'"),
          F: compte("SELECT COUNT(*) n FROM eleves WHERE sexe='F'"),
          redoublants: compte("SELECT COUNT(*) n FROM eleves WHERE redoublant=1"),
          sans_classe: compte("SELECT COUNT(*) n FROM eleves WHERE classe_id IS NULL"),
        },
        personnel: compte("SELECT COUNT(*) n FROM personnel"),
        compositions: compte("SELECT COUNT(*) n FROM compositions"),
      };
    },
  };
  return api;
}

module.exports = { ouvrir, creerApi, NIVEAUX, appreciation };
