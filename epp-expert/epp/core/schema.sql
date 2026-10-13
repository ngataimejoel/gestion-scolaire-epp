-- Schéma de la base GESTION SCOLAIRE EPP EXPERT (version 1)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
    cle TEXT PRIMARY KEY,
    valeur TEXT
);

-- Paramètres clé / valeur : identité de l'établissement, préférences, sauvegarde
CREATE TABLE IF NOT EXISTS parametre (
    cle TEXT PRIMARY KEY,
    valeur TEXT
);

-- Listes de choix (nationalités, fonctions, motifs, statuts...)
CREATE TABLE IF NOT EXISTS liste_valeur (
    id INTEGER PRIMARY KEY,
    liste TEXT NOT NULL,
    valeur TEXT NOT NULL,
    ordre INTEGER NOT NULL DEFAULT 0,
    actif INTEGER NOT NULL DEFAULT 1,
    UNIQUE (liste, valeur)
);

CREATE TABLE IF NOT EXISTS annee_scolaire (
    id INTEGER PRIMARY KEY,
    libelle TEXT NOT NULL UNIQUE,            -- 2026-2027
    date_debut TEXT,
    date_fin TEXT,
    date_edition TEXT,                        -- date imprimée sur les états
    date_ref_age TEXT,                        -- date de calcul des âges
    nouveaux_cp1 INTEGER NOT NULL DEFAULT 0,  -- nouveaux inscrits CP1 attendus l'année suivante
    active INTEGER NOT NULL DEFAULT 0,
    cloturee INTEGER NOT NULL DEFAULT 0
);

-- Grille de notation (un groupe de classes partageant les mêmes matières)
CREATE TABLE IF NOT EXISTS grille_notes (
    id INTEGER PRIMARY KEY,
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    code TEXT NOT NULL,                       -- CP, CE1, CE2-CM1, CM2
    libelle TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('COEF', 'BAREME')),
    echelle REAL NOT NULL DEFAULT 10,         -- moyenne sur 10 ou 20
    note_max REAL NOT NULL DEFAULT 10,        -- mode COEF : note maximale d'une matière
    UNIQUE (annee_id, code)
);

CREATE TABLE IF NOT EXISTS classe (
    id INTEGER PRIMARY KEY,
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    code TEXT NOT NULL,                       -- CP1 ... CM2
    libelle TEXT,
    ordre INTEGER NOT NULL DEFAULT 0,
    niveau_suivant TEXT,                      -- code de la classe supérieure (vide = sortie)
    seuil REAL NOT NULL DEFAULT 5,            -- moyenne de passage
    bareme REAL NOT NULL DEFAULT 10,          -- moyennes sur 10 ou 20
    grille_id INTEGER REFERENCES grille_notes(id) ON DELETE SET NULL,
    calendrier TEXT NOT NULL DEFAULT 'STD',   -- STD (CP1-CM1) ou CM2
    regle_mga TEXT NOT NULL DEFAULT 'STANDARD' CHECK (regle_mga IN ('STANDARD', 'MOYENNE4')),
    UNIQUE (annee_id, code)
);

CREATE TABLE IF NOT EXISTS evaluation (
    id INTEGER PRIMARY KEY,
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    calendrier TEXT NOT NULL,
    num INTEGER NOT NULL,
    libelle TEXT NOT NULL,
    date TEXT,
    UNIQUE (annee_id, calendrier, num)
);

CREATE TABLE IF NOT EXISTS matiere (
    id INTEGER PRIMARY KEY,
    grille_id INTEGER NOT NULL REFERENCES grille_notes(id) ON DELETE CASCADE,
    eval_num INTEGER NOT NULL,
    ordre INTEGER NOT NULL DEFAULT 0,
    libelle TEXT NOT NULL,
    valeur REAL NOT NULL                      -- coefficient (mode COEF) ou barème (mode BAREME)
);

CREATE TABLE IF NOT EXISTS jours_classe (
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    mois INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
    libelle TEXT NOT NULL,
    jours INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (annee_id, mois)
);

CREATE TABLE IF NOT EXISTS eleve (
    id INTEGER PRIMARY KEY,
    matricule_desps TEXT UNIQUE,
    nom TEXT NOT NULL,
    sexe TEXT NOT NULL CHECK (sexe IN ('M', 'F')),
    date_naissance TEXT,
    nationalite TEXT,
    localite TEXT,
    sous_prefecture TEXT,
    extrait TEXT CHECK (extrait IN ('OUI', 'NON') OR extrait IS NULL),
    acte_num TEXT,
    acte_date TEXT,
    centre_etat_civil TEXT,
    orphelin TEXT CHECK (orphelin IN ('OUI', 'NON') OR orphelin IS NULL),
    orphelin_de TEXT,
    pere_nom TEXT, pere_profession TEXT, pere_residence TEXT, pere_tel TEXT,
    mere_nom TEXT, mere_profession TEXT, mere_residence TEXT, mere_tel TEXT,
    tuteur_nom TEXT, tuteur_profession TEXT, tuteur_residence TEXT, tuteur_tel TEXT,
    observations TEXT,
    cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    modifie_le TEXT
);

CREATE TABLE IF NOT EXISTS inscription (
    id INTEGER PRIMARY KEY,
    eleve_id INTEGER NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    classe_id INTEGER NOT NULL REFERENCES classe(id),
    matricule_ecole TEXT NOT NULL,
    ordre INTEGER NOT NULL DEFAULT 0,          -- ordre d'inscription (n° du registre)
    type TEXT NOT NULL DEFAULT 'INSCRIPTION' CHECK (type IN ('INSCRIPTION', 'REINSCRIPTION')),
    date_inscription TEXT,
    redoublant TEXT NOT NULL DEFAULT 'NON' CHECK (redoublant IN ('OUI', 'NON')),
    statut TEXT NOT NULL DEFAULT 'PRESENT' CHECK (statut IN ('PRESENT', 'ABANDON', 'TRANSFERE')),
    observations TEXT,
    UNIQUE (eleve_id, annee_id),
    UNIQUE (annee_id, matricule_ecole)
);
CREATE INDEX IF NOT EXISTS ix_inscription_classe ON inscription(classe_id);

CREATE TABLE IF NOT EXISTS presence_eval (
    inscription_id INTEGER NOT NULL REFERENCES inscription(id) ON DELETE CASCADE,
    eval_num INTEGER NOT NULL,
    present INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (inscription_id, eval_num)
);

CREATE TABLE IF NOT EXISTS note (
    inscription_id INTEGER NOT NULL REFERENCES inscription(id) ON DELETE CASCADE,
    matiere_id INTEGER NOT NULL REFERENCES matiere(id) ON DELETE CASCADE,
    valeur REAL NOT NULL,
    PRIMARY KEY (inscription_id, matiere_id)
);

CREATE TABLE IF NOT EXISTS personnel (
    id INTEGER PRIMARY KEY,
    matricule TEXT NOT NULL UNIQUE,
    nom TEXT NOT NULL,
    sexe TEXT NOT NULL CHECK (sexe IN ('M', 'F')),
    date_naissance TEXT,
    fonction TEXT,
    grade TEXT,
    diplome TEXT,
    date_prise_service TEXT,
    date_arrivee TEXT,
    telephone TEXT,
    situation_matrimoniale TEXT,
    observations TEXT,
    actif INTEGER NOT NULL DEFAULT 1,
    ordre INTEGER NOT NULL DEFAULT 0
);

-- Classe tenue par un agent pour une année
CREATE TABLE IF NOT EXISTS affectation (
    personnel_id INTEGER NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    classe_code TEXT,
    PRIMARY KEY (personnel_id, annee_id)
);

CREATE TABLE IF NOT EXISTS absence_eleve (
    id INTEGER PRIMARY KEY,
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    inscription_id INTEGER NOT NULL REFERENCES inscription(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    nature TEXT NOT NULL CHECK (nature IN ('RETARD', 'ABSENCE')),
    jours REAL,
    retard_min INTEGER,
    motif TEXT,
    justifie TEXT,
    observations TEXT,
    autorisation_id INTEGER REFERENCES autorisation_absence(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS absence_personnel (
    id INTEGER PRIMARY KEY,
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    personnel_id INTEGER NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    nature TEXT NOT NULL CHECK (nature IN ('RETARD', 'ABSENCE')),
    jours REAL,
    retard_min INTEGER,
    motif TEXT,
    justifie TEXT,
    observations TEXT,
    autorisation_id INTEGER REFERENCES autorisation_absence(id) ON DELETE CASCADE
);

-- Zones de texte à rédiger dans les rapports (observations, rapport mensuel...)
CREATE TABLE IF NOT EXISTS texte_rapport (
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    rapport TEXT NOT NULL,
    cle TEXT NOT NULL DEFAULT '',
    champ TEXT NOT NULL,
    texte TEXT,
    PRIMARY KEY (annee_id, rapport, cle, champ)
);

CREATE TABLE IF NOT EXISTS role (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    libelle TEXT NOT NULL,
    systeme INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS role_permission (
    role_id INTEGER NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS utilisateur (
    id INTEGER PRIMARY KEY,
    login TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nom TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES role(id),
    hash TEXT NOT NULL,
    actif INTEGER NOT NULL DEFAULT 1,
    doit_changer INTEGER NOT NULL DEFAULT 0,
    derniere_connexion TEXT,
    cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS modele_rapport (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    nom TEXT NOT NULL,
    description TEXT,
    categorie TEXT,
    actif INTEGER NOT NULL DEFAULT 1,
    integre INTEGER NOT NULL DEFAULT 0,       -- modèle livré avec l'application
    version_courante INTEGER NOT NULL DEFAULT 1,
    cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    modifie_le TEXT,
    cree_par TEXT
);

CREATE TABLE IF NOT EXISTS modele_version (
    modele_id INTEGER NOT NULL REFERENCES modele_rapport(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    definition TEXT NOT NULL,                 -- JSON
    commentaire TEXT,
    cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    cree_par TEXT,
    PRIMARY KEY (modele_id, version)
);

CREATE TABLE IF NOT EXISTS journal (
    id INTEGER PRIMARY KEY,
    horodatage TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    utilisateur TEXT,
    action TEXT NOT NULL,
    objet TEXT,
    details TEXT
);

-- version 2 : photos des élèves et du personnel (image JPEG réduite, incluse dans les sauvegardes)
CREATE TABLE IF NOT EXISTS photo (
    kind TEXT NOT NULL CHECK (kind IN ('eleve', 'personnel')),
    ref_id INTEGER NOT NULL,
    data BLOB NOT NULL,
    mime TEXT NOT NULL DEFAULT 'image/jpeg',
    modifie_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (kind, ref_id)
);
CREATE TRIGGER IF NOT EXISTS photo_eleve_suppr AFTER DELETE ON eleve
    BEGIN DELETE FROM photo WHERE kind='eleve' AND ref_id=OLD.id; END;
CREATE TRIGGER IF NOT EXISTS photo_personnel_suppr AFTER DELETE ON personnel
    BEGIN DELETE FROM photo WHERE kind='personnel' AND ref_id=OLD.id; END;

-- version 3 : décisions de fin d'année validées (la décision calculée sert de proposition)
CREATE TABLE IF NOT EXISTS decision_fin_annee (
    inscription_id INTEGER PRIMARY KEY REFERENCES inscription(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK (decision IN ('ADMIS', 'REDOUBLE', 'ABANDON', 'EXCLU', 'TRANSFERE')),
    decision_calculee TEXT,                    -- proposition au moment de la validation
    motif TEXT,
    valide_par TEXT NOT NULL,
    valide_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Demandes d'autorisation d'absence (élèves et personnel) ; une demande accordée crée ses absences
CREATE TABLE IF NOT EXISTS autorisation_absence (
    id INTEGER PRIMARY KEY,
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    numero TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('eleve', 'personnel')),
    personnel_id INTEGER REFERENCES personnel(id) ON DELETE CASCADE,
    inscription_id INTEGER REFERENCES inscription(id) ON DELETE CASCADE,
    date_demande TEXT NOT NULL,
    date_debut TEXT NOT NULL,
    date_fin TEXT NOT NULL,
    demi_journee TEXT,
    jours REAL NOT NULL,
    motif TEXT NOT NULL,
    precisions TEXT,
    lieu TEXT,
    contact TEXT,
    interim TEXT,
    demandeur TEXT,
    statut TEXT NOT NULL DEFAULT 'EN_ATTENTE' CHECK (statut IN ('EN_ATTENTE', 'ACCORDEE', 'REFUSEE')),
    avis TEXT,
    decide_par TEXT,
    decide_le TEXT,
    cree_par TEXT,
    cree_le TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (annee_id, numero),
    CHECK ((kind = 'eleve' AND inscription_id IS NOT NULL) OR (kind = 'personnel' AND personnel_id IS NOT NULL))
);

-- version 5 : jours fériés et vacances scolaires (exclus des jours de classe)
CREATE TABLE IF NOT EXISTS conge (
    id INTEGER PRIMARY KEY,
    annee_id INTEGER NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'FERIE' CHECK (type IN ('FERIE', 'VACANCES', 'AUTRE')),
    libelle TEXT NOT NULL,
    date_debut TEXT NOT NULL,
    date_fin TEXT NOT NULL,
    CHECK (date_fin >= date_debut)
);
CREATE INDEX IF NOT EXISTS idx_conge_annee ON conge(annee_id, date_debut);
