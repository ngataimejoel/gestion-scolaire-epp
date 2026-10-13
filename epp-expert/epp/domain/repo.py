"""Accès métier aux données : années, classes, élèves, inscriptions, notes,
personnel, absences, textes de rapports. Toutes les écritures sont validées ici
(et non seulement dans l'interface) pour protéger les données."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from epp.core.db import Database
from epp.core.security import Session, log
from epp.domain import calculs


class ValidationError(ValueError):
    def __init__(self, message: str, champ: str | None = None):
        super().__init__(message)
        self.champ = champ


# ============================================================== années / structure
@dataclass
class Classe:
    id: int
    code: str
    libelle: str
    ordre: int
    niveau_suivant: str | None
    seuil: float
    bareme: float
    grille_id: int | None
    calendrier: str
    regle_mga: str


@dataclass
class Grille:
    id: int
    code: str
    libelle: str
    mode: str
    echelle: float
    note_max: float
    matieres: dict[int, list[dict]] = field(default_factory=dict)  # eval_num -> matières


@dataclass
class Annee:
    id: int
    libelle: str
    date_debut: str
    date_fin: str
    date_edition: str
    date_ref_age: str
    nouveaux_cp1: int
    active: bool
    classes: list[Classe] = field(default_factory=list)
    grilles: dict[int, Grille] = field(default_factory=dict)
    evaluations: dict[str, dict[int, dict]] = field(default_factory=dict)  # calendrier -> num -> eval
    jours: dict[int, dict] = field(default_factory=dict)

    def classe(self, code: str) -> Classe | None:
        return next((c for c in self.classes if c.code == code), None)

    def classe_par_id(self, cid: int) -> Classe | None:
        return next((c for c in self.classes if c.id == cid), None)

    def classe_precedente(self, code: str) -> Classe | None:
        return next((c for c in self.classes if c.niveau_suivant == code), None)

    @property
    def codes(self) -> list[str]:
        return [c.code for c in self.classes]

    def eval_nums(self) -> list[int]:
        nums = set()
        for cal in self.evaluations.values():
            nums.update(cal)
        return sorted(nums) or [1, 2, 3, 4]

    def libelle_evaluation(self, calendrier: str, num: int) -> str:
        e = self.evaluations.get(calendrier, {}).get(num)
        return e["libelle"] if e else f"Évaluation {num}"

    def an_debut(self) -> int:
        return int(self.libelle[:4])


def list_annees(db: Database) -> list[dict]:
    return [dict(r) for r in db.query("SELECT * FROM annee_scolaire ORDER BY libelle DESC")]


def active_annee_id(db: Database) -> int | None:
    return db.scalar("SELECT id FROM annee_scolaire WHERE active=1 ORDER BY libelle DESC LIMIT 1") or \
        db.scalar("SELECT id FROM annee_scolaire ORDER BY libelle DESC LIMIT 1")


def set_active_annee(db: Database, annee_id: int) -> None:
    with db.transaction():
        db.execute("UPDATE annee_scolaire SET active=0")
        db.execute("UPDATE annee_scolaire SET active=1 WHERE id=?", (annee_id,))


def load_annee(db: Database, annee_id: int) -> Annee:
    r = db.one("SELECT * FROM annee_scolaire WHERE id=?", (annee_id,))
    if r is None:
        raise ValidationError("Année scolaire introuvable.")
    a = Annee(r["id"], r["libelle"], r["date_debut"], r["date_fin"], r["date_edition"], r["date_ref_age"],
              r["nouveaux_cp1"] or 0, bool(r["active"]))
    for c in db.query("SELECT * FROM classe WHERE annee_id=? ORDER BY ordre, code", (annee_id,)):
        a.classes.append(Classe(c["id"], c["code"], c["libelle"] or c["code"], c["ordre"], c["niveau_suivant"],
                                c["seuil"], c["bareme"], c["grille_id"], c["calendrier"], c["regle_mga"]))
    for g in db.query("SELECT * FROM grille_notes WHERE annee_id=?", (annee_id,)):
        gr = Grille(g["id"], g["code"], g["libelle"], g["mode"], g["echelle"], g["note_max"])
        for m in db.query("SELECT * FROM matiere WHERE grille_id=? ORDER BY eval_num, ordre, id", (g["id"],)):
            gr.matieres.setdefault(m["eval_num"], []).append(dict(m))
        a.grilles[gr.id] = gr
    for e in db.query("SELECT * FROM evaluation WHERE annee_id=? ORDER BY calendrier, num", (annee_id,)):
        a.evaluations.setdefault(e["calendrier"], {})[e["num"]] = dict(e)
    for j in db.query("SELECT * FROM jours_classe WHERE annee_id=? ORDER BY CASE WHEN mois>=9 THEN mois-9 ELSE mois+3 END",
                      (annee_id,)):
        a.jours[j["mois"]] = dict(j)
    return a


def update_annee(db: Database, s: Session, annee_id: int, **fields) -> None:
    s.require("parametres.modifier")
    allowed = {"date_debut", "date_fin", "date_edition", "date_ref_age", "nouveaux_cp1", "cloturee"}
    sets = {k: v for k, v in fields.items() if k in allowed}
    if not sets:
        return
    db.execute(f"UPDATE annee_scolaire SET {', '.join(k + '=?' for k in sets)} WHERE id=?",
               (*sets.values(), annee_id))
    log(db, s.login, "MODIF_ANNEE", "annee_scolaire", f"{annee_id}: {sets}")


def save_classe(db: Database, s: Session, classe_id: int | None, annee_id: int, data: dict) -> int:
    s.require("parametres.modifier")
    code = (data.get("code") or "").strip().upper()
    if not code:
        raise ValidationError("Le code de la classe est obligatoire.", "code")
    if float(data.get("bareme") or 0) <= 0:
        raise ValidationError("Le barème doit être positif.", "bareme")
    seuil = float(data.get("seuil") or 0)
    if not 0 <= seuil <= float(data["bareme"]):
        raise ValidationError("Le seuil doit être compris entre 0 et le barème.", "seuil")
    vals = (code, data.get("libelle") or code, int(data.get("ordre") or 0), data.get("niveau_suivant") or None,
            seuil, float(data["bareme"]), data.get("grille_id"), data.get("calendrier") or "STD",
            data.get("regle_mga") or "STANDARD")
    if classe_id:
        db.execute("UPDATE classe SET code=?, libelle=?, ordre=?, niveau_suivant=?, seuil=?, bareme=?, grille_id=?, "
                   "calendrier=?, regle_mga=? WHERE id=?", (*vals, classe_id))
    else:
        if db.scalar("SELECT id FROM classe WHERE annee_id=? AND code=?", (annee_id, code)):
            raise ValidationError(f"La classe {code} existe déjà.", "code")
        classe_id = db.execute(
            "INSERT INTO classe(code, libelle, ordre, niveau_suivant, seuil, bareme, grille_id, calendrier, "
            "regle_mga, annee_id) VALUES(?,?,?,?,?,?,?,?,?,?)", (*vals, annee_id)).lastrowid
    log(db, s.login, "MODIF_CLASSE", "classe", code)
    return classe_id


def delete_classe(db: Database, s: Session, classe_id: int) -> None:
    s.require("parametres.modifier")
    n = db.scalar("SELECT COUNT(*) FROM inscription WHERE classe_id=?", (classe_id,))
    if n:
        raise ValidationError(f"Impossible de supprimer une classe qui compte {n} élève(s).")
    db.execute("DELETE FROM classe WHERE id=?", (classe_id,))


# ============================================================== listes et paramètres
def liste(db: Database, nom: str, actifs: bool = True) -> list[str]:
    sql = "SELECT valeur FROM liste_valeur WHERE liste=?" + (" AND actif=1" if actifs else "") + " ORDER BY ordre, valeur"
    return [r[0] for r in db.query(sql, (nom,))]


def set_liste(db: Database, s: Session, nom: str, valeurs: list[str]) -> None:
    s.require("parametres.modifier")
    with db.transaction():
        db.execute("DELETE FROM liste_valeur WHERE liste=?", (nom,))
        for i, v in enumerate(dict.fromkeys(v.strip() for v in valeurs if v.strip())):
            db.execute("INSERT INTO liste_valeur(liste, valeur, ordre) VALUES(?,?,?)", (nom, v, i))
    log(db, s.login, "MODIF_LISTE", nom, ", ".join(valeurs))


def etablissement(db: Database) -> dict:
    return {r["cle"]: r["valeur"] or "" for r in db.query("SELECT cle, valeur FROM parametre")}


def save_etablissement(db: Database, s: Session, data: dict) -> None:
    """Enregistre les paramètres de l'établissement. Les logos passent par set_logo (contrôle de l'image)."""
    s.require("parametres.modifier")
    data = {k: v for k, v in data.items() if k not in LOGOS}
    with db.transaction():
        for k, v in data.items():
            db.set_param(k, v)
    log(db, s.login, "MODIF_PARAMETRES", "etablissement", ", ".join(data))


# ============================================================== élèves et inscriptions
ELEVE_CHAMPS = [
    "matricule_desps", "nom", "sexe", "date_naissance", "nationalite", "localite", "sous_prefecture",
    "extrait", "acte_num", "acte_date", "centre_etat_civil", "orphelin", "orphelin_de",
    "pere_nom", "pere_profession", "pere_residence", "pere_tel",
    "mere_nom", "mere_profession", "mere_residence", "mere_tel",
    "tuteur_nom", "tuteur_profession", "tuteur_residence", "tuteur_tel", "observations",
]


def _clean(v):
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v.isoformat()[:10]
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def validate_eleve(data: dict, annee: Annee | None = None) -> dict:
    d = {k: _clean(data.get(k)) for k in ELEVE_CHAMPS}
    if not d["nom"]:
        raise ValidationError("Le nom et les prénoms sont obligatoires.", "nom")
    if d["sexe"] not in ("M", "F"):
        raise ValidationError("Le sexe doit être M ou F.", "sexe")
    if d["matricule_desps"]:
        d["matricule_desps"] = d["matricule_desps"].replace(" ", "")
        if not calculs.matricule_desps_valide(d["matricule_desps"]):
            raise ValidationError("Matricule DESPS invalide : " + calculs.MATRICULE_DESPS_AIDE, "matricule_desps")
    dn = calculs.to_date(d["date_naissance"])
    if d["date_naissance"] and dn is None:
        raise ValidationError("Date de naissance invalide.", "date_naissance")
    if dn:
        ref = calculs.to_date(annee.date_ref_age) if annee else date.today()
        if dn > (ref or date.today()):
            raise ValidationError("La date de naissance est postérieure à la date de référence.", "date_naissance")
        if ref and calculs.datedif_years(dn, ref) > 25:
            raise ValidationError("Date de naissance improbable pour un élève du primaire (plus de 25 ans).",
                                  "date_naissance")
    for k in ("extrait", "orphelin"):
        if d[k] and d[k] not in ("OUI", "NON"):
            raise ValidationError(f"Valeur attendue OUI ou NON ({k}).", k)
    if d["orphelin"] == "NON":
        d["orphelin_de"] = d["orphelin_de"] or "-"
    return d


def next_matricule(db: Database, annee: Annee, classe_code: str) -> str:
    prefix = f"{classe_code}-"
    suffix = f"-{annee.libelle[2:4]}"
    best = 0
    for (m,) in db.query("SELECT matricule_ecole FROM inscription WHERE annee_id=? AND matricule_ecole LIKE ?",
                         (annee.id, prefix + "%")):
        parts = m.split("-")
        if len(parts) >= 3 and m.endswith(suffix) and parts[-2].isdigit():
            best = max(best, int(parts[-2]))
    return calculs.matricule_ecole(classe_code, best + 1, annee.libelle)


def save_eleve(db: Database, s: Session, eleve_id: int | None, data: dict, annee: Annee | None = None) -> int:
    s.require("eleves.modifier")
    d = validate_eleve(data, annee)
    if d["matricule_desps"]:
        other = db.scalar("SELECT id FROM eleve WHERE matricule_desps=? AND id<>?",
                          (d["matricule_desps"], eleve_id or 0))
        if other:
            raise ValidationError("Ce matricule DESPS est déjà attribué à un autre élève.", "matricule_desps")
    cols = ELEVE_CHAMPS
    if eleve_id:
        db.execute(f"UPDATE eleve SET {', '.join(c + '=?' for c in cols)}, modifie_le=datetime('now','localtime') "
                   f"WHERE id=?", (*[d[c] for c in cols], eleve_id))
        log(db, s.login, "MODIF_ELEVE", "eleve", f"{eleve_id} {d['nom']}")
    else:
        eleve_id = db.execute(f"INSERT INTO eleve({', '.join(cols)}) VALUES({', '.join('?' * len(cols))})",
                              [d[c] for c in cols]).lastrowid
        log(db, s.login, "AJOUT_ELEVE", "eleve", f"{eleve_id} {d['nom']}")
    return eleve_id


def inscrire(db: Database, s: Session, eleve_id: int, annee: Annee, classe_code: str,
             redoublant: str = "NON", statut: str = "PRESENT", type_: str = "INSCRIPTION",
             matricule: str | None = None, date_inscription: str | None = None,
             observations: str | None = None) -> int:
    s.require("eleves.modifier")
    classe = annee.classe(classe_code)
    if classe is None:
        raise ValidationError(f"Classe inconnue pour {annee.libelle} : {classe_code}", "classe")
    if redoublant not in ("OUI", "NON"):
        raise ValidationError("Redoublant : OUI ou NON.", "redoublant")
    if statut not in ("PRESENT", "ABANDON", "TRANSFERE"):
        raise ValidationError("Statut invalide.", "statut")
    if db.scalar("SELECT id FROM inscription WHERE eleve_id=? AND annee_id=?", (eleve_id, annee.id)):
        raise ValidationError(f"Cet élève est déjà inscrit pour l'année {annee.libelle}.")
    matricule = matricule or next_matricule(db, annee, classe_code)
    if db.scalar("SELECT id FROM inscription WHERE annee_id=? AND matricule_ecole=?", (annee.id, matricule)):
        raise ValidationError(f"Le matricule école {matricule} est déjà utilisé.")
    ordre = (db.scalar("SELECT MAX(ordre) FROM inscription WHERE annee_id=?", (annee.id,), 0) or 0) + 1
    iid = db.execute(
        "INSERT INTO inscription(eleve_id, annee_id, classe_id, matricule_ecole, ordre, type, date_inscription, "
        "redoublant, statut, observations) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (eleve_id, annee.id, classe.id, matricule, ordre, type_, date_inscription or date.today().isoformat(),
         redoublant, statut, observations)).lastrowid
    log(db, s.login, "INSCRIPTION", "inscription", f"{matricule} ({type_})")
    return iid


def update_inscription(db: Database, s: Session, inscription_id: int, annee: Annee, classe_code: str,
                       redoublant: str, statut: str, observations: str | None = None) -> None:
    s.require("eleves.modifier")
    classe = annee.classe(classe_code)
    if classe is None:
        raise ValidationError("Classe inconnue.", "classe")
    old = db.one("SELECT * FROM inscription WHERE id=?", (inscription_id,))
    with db.transaction():
        if old["classe_id"] != classe.id:
            # Changement de classe : nouveau matricule ; les notes d'une autre grille ne s'appliquent plus.
            old_cl = annee.classe_par_id(old["classe_id"])
            if old_cl and old_cl.grille_id != classe.grille_id:
                db.execute("DELETE FROM note WHERE inscription_id=?", (inscription_id,))
            db.execute("UPDATE inscription SET classe_id=?, matricule_ecole=? WHERE id=?",
                       (classe.id, next_matricule(db, annee, classe.code), inscription_id))
        db.execute("UPDATE inscription SET redoublant=?, statut=?, observations=? WHERE id=?",
                   (redoublant, statut, observations, inscription_id))
    log(db, s.login, "MODIF_INSCRIPTION", "inscription", f"{inscription_id} {classe_code} {statut}")


def delete_eleve(db: Database, s: Session, eleve_id: int) -> None:
    s.require("eleves.supprimer")
    nom = db.scalar("SELECT nom FROM eleve WHERE id=?", (eleve_id,))
    db.execute("DELETE FROM eleve WHERE id=?", (eleve_id,))
    log(db, s.login, "SUPPRESSION_ELEVE", "eleve", f"{eleve_id} {nom}")


def get_eleve(db: Database, eleve_id: int) -> dict:
    r = db.one("SELECT * FROM eleve WHERE id=?", (eleve_id,))
    return dict(r) if r else {}


def inscriptions(db: Database, annee: Annee, classe_code: str | None = None, recherche: str | None = None,
                 statut: str | None = None) -> list[dict]:
    """Registre de l'année : une ligne par inscription, avec les champs de l'élève et l'âge."""
    sql = ("SELECT i.id AS inscription_id, i.matricule_ecole, i.ordre, i.type, i.date_inscription, i.redoublant, "
           "i.statut, i.observations AS observations_inscription, c.code AS classe, c.ordre AS classe_ordre, e.* "
           "FROM inscription i JOIN eleve e ON e.id=i.eleve_id JOIN classe c ON c.id=i.classe_id "
           "WHERE i.annee_id=?")
    params: list = [annee.id]
    if classe_code:
        sql += " AND c.code=?"
        params.append(classe_code)
    if statut:
        sql += " AND i.statut=?"
        params.append(statut)
    if recherche:
        sql += (" AND (e.nom LIKE ? OR i.matricule_ecole LIKE ? OR IFNULL(e.matricule_desps,'') LIKE ? "
                "OR IFNULL(e.pere_nom,'') LIKE ? OR IFNULL(e.mere_nom,'') LIKE ?)")
        params += [f"%{recherche}%"] * 5
    sql += " ORDER BY i.ordre, i.id"
    out = []
    for n, r in enumerate(db.query(sql, params), start=1):
        d = dict(r)
        d["eleve_id"] = d.pop("id")
        d["age"] = calculs.datedif_years(d["date_naissance"], annee.date_ref_age)
        d["numero"] = n
        out.append(d)
    return out


def reinscrire(db: Database, s: Session, src: Annee, dst: Annee, decisions: dict[int, str] | None = None,
               inscription_ids: list[int] | None = None) -> dict:
    """Passage d'année : ADMIS -> classe suivante (CM2 admis : sortie), REDOUBLE -> même classe (redoublant OUI).

    decisions : {inscription_id: décision} (calculées par le module résultats si absent).
    Renvoie un bilan {'reinscrits': n, 'sortants': n, 'ignores': n, 'deja': n}.
    """
    s.require("eleves.modifier")
    if decisions is None:
        from epp.domain import resultats
        decisions = {r["inscription_id"]: r["decision"] for r in resultats.compute(db, src)}
    bilan = {"reinscrits": 0, "sortants": 0, "ignores": 0, "deja": 0}
    rows = inscriptions(db, src)
    with db.transaction():
        for r in rows:
            if inscription_ids is not None and r["inscription_id"] not in inscription_ids:
                continue
            if r["statut"] != "PRESENT":
                bilan["ignores"] += 1
                continue
            dec = decisions.get(r["inscription_id"])
            cl = src.classe(r["classe"])
            if dec == "ADMIS":
                cible, red = (cl.niveau_suivant if cl else None), "NON"
            elif dec == "REDOUBLE":
                cible, red = r["classe"], "OUI"
            else:
                bilan["ignores"] += 1
                continue
            if not cible:
                bilan["sortants"] += 1
                continue
            if dst.classe(cible) is None:
                bilan["ignores"] += 1
                continue
            if db.scalar("SELECT id FROM inscription WHERE eleve_id=? AND annee_id=?", (r["eleve_id"], dst.id)):
                bilan["deja"] += 1
                continue
            inscrire(db, s, r["eleve_id"], dst, cible, red, "PRESENT", "REINSCRIPTION")
            bilan["reinscrits"] += 1
    log(db, s.login, "REINSCRIPTIONS", "annee", f"{src.libelle} -> {dst.libelle} : {bilan}")
    return bilan


# ============================================================== notes
def classes_de_grille(annee: Annee, grille_id: int) -> list[Classe]:
    return [c for c in annee.classes if c.grille_id == grille_id]


def notes_grille(db: Database, annee: Annee, grille_id: int, eval_num: int,
                 classe_code: str | None = None) -> tuple[list[dict], list[dict]]:
    """Feuille de notes : (matières, lignes). Chaque ligne : inscription + présence + notes {matiere_id: valeur}."""
    grille = annee.grilles[grille_id]
    mats = grille.matieres.get(eval_num, [])
    codes = [c.code for c in classes_de_grille(annee, grille_id)]
    if classe_code:
        codes = [c for c in codes if c == classe_code]
    rows = [r for r in inscriptions(db, annee) if r["classe"] in codes]
    ids = [r["inscription_id"] for r in rows]
    notes: dict[int, dict[int, float]] = {}
    pres: dict[int, bool] = {}
    if ids:
        q = ",".join("?" * len(ids))
        mids = [m["id"] for m in mats] or [0]
        qm = ",".join("?" * len(mids))
        for n in db.query(f"SELECT * FROM note WHERE inscription_id IN ({q}) AND matiere_id IN ({qm})", (*ids, *mids)):
            notes.setdefault(n["inscription_id"], {})[n["matiere_id"]] = n["valeur"]
        for p in db.query(f"SELECT * FROM presence_eval WHERE eval_num=? AND inscription_id IN ({q})", (eval_num, *ids)):
            pres[p["inscription_id"]] = bool(p["present"])
    out = []
    for r in rows:
        iid = r["inscription_id"]
        present = pres.get(iid, True)
        n = notes.get(iid, {})
        total, moy = calculs.moyenne_evaluation([(n.get(m["id"]), m["valeur"]) for m in mats],
                                                grille.mode, grille.echelle, present)
        out.append({**r, "present": present, "notes": n, "total": total, "moyenne": moy})
    return mats, out


def max_note(grille: Grille, matiere: dict) -> float:
    return grille.note_max if grille.mode == "COEF" else matiere["valeur"]


def set_note(db: Database, s: Session, annee: Annee, inscription_id: int, matiere_id: int,
             valeur: float | None) -> None:
    s.require("notes.modifier")
    m = db.one("SELECT m.*, g.id AS gid FROM matiere m JOIN grille_notes g ON g.id=m.grille_id WHERE m.id=?",
               (matiere_id,))
    if m is None:
        raise ValidationError("Matière inconnue.")
    grille = annee.grilles[m["gid"]]
    if valeur is not None:
        try:
            valeur = float(str(valeur).replace(",", "."))
        except ValueError:
            raise ValidationError("La note doit être un nombre.")
        mx = max_note(grille, dict(m))
        if not 0 <= valeur <= mx:
            raise ValidationError(f"La note de {m['libelle']} doit être comprise entre 0 et {mx:g}.")
        present = db.scalar("SELECT present FROM presence_eval WHERE inscription_id=? AND eval_num=?",
                            (inscription_id, m["eval_num"]), 1)
        if not present:
            raise ValidationError("L'élève est noté absent à cette évaluation : la saisie de notes est refusée.")
        db.execute("INSERT INTO note(inscription_id, matiere_id, valeur) VALUES(?,?,?) "
                   "ON CONFLICT(inscription_id, matiere_id) DO UPDATE SET valeur=excluded.valeur",
                   (inscription_id, matiere_id, valeur))
    else:
        db.execute("DELETE FROM note WHERE inscription_id=? AND matiere_id=?", (inscription_id, matiere_id))


def set_presence(db: Database, s: Session, inscription_id: int, eval_num: int, present: bool,
                 grille_id: int | None = None) -> None:
    """« Présent ? » = NON : les notes de l'évaluation sont effacées (la moyenne vaut 0)."""
    s.require("notes.modifier")
    with db.transaction():
        db.execute("INSERT INTO presence_eval(inscription_id, eval_num, present) VALUES(?,?,?) "
                   "ON CONFLICT(inscription_id, eval_num) DO UPDATE SET present=excluded.present",
                   (inscription_id, eval_num, int(present)))
        if not present:
            db.execute("DELETE FROM note WHERE inscription_id=? AND matiere_id IN "
                       "(SELECT id FROM matiere WHERE eval_num=?" + (" AND grille_id=?" if grille_id else "") + ")",
                       (inscription_id, eval_num, *([grille_id] if grille_id else [])))


def save_matieres(db: Database, s: Session, grille_id: int, eval_num: int, matieres: list[dict]) -> None:
    """Remplace la liste des matières d'une évaluation (libellé, valeur). Les notes des matières conservées restent."""
    s.require("parametres.modifier")
    with db.transaction():
        keep = [m["id"] for m in matieres if m.get("id")]
        q = ",".join("?" * len(keep)) or "0"
        db.execute(f"DELETE FROM matiere WHERE grille_id=? AND eval_num=? AND id NOT IN ({q})",
                   (grille_id, eval_num, *keep))
        for i, m in enumerate(matieres):
            if not (m.get("libelle") or "").strip():
                raise ValidationError("Chaque matière doit avoir un libellé.")
            if float(m.get("valeur") or 0) < 0:
                raise ValidationError("Coefficient ou barème négatif.")
            if m.get("id"):
                db.execute("UPDATE matiere SET ordre=?, libelle=?, valeur=? WHERE id=?",
                           (i, m["libelle"].strip(), float(m["valeur"]), m["id"]))
            else:
                db.execute("INSERT INTO matiere(grille_id, eval_num, ordre, libelle, valeur) VALUES(?,?,?,?,?)",
                           (grille_id, eval_num, i, m["libelle"].strip(), float(m["valeur"])))
    log(db, s.login, "MODIF_MATIERES", "grille", f"{grille_id} éval {eval_num}")


# ============================================================== personnel
PERSONNEL_CHAMPS = ["matricule", "nom", "sexe", "date_naissance", "fonction", "grade", "diplome",
                    "date_prise_service", "date_arrivee", "telephone", "situation_matrimoniale", "observations"]


def personnel(db: Database, annee: Annee | None = None, actifs: bool = True, recherche: str | None = None) -> list[dict]:
    sql = ("SELECT p.*, a.classe_code FROM personnel p LEFT JOIN affectation a ON a.personnel_id=p.id AND a.annee_id=? "
           "WHERE 1=1")
    params: list = [annee.id if annee else 0]
    if actifs:
        sql += " AND p.actif=1"
    if recherche:
        sql += " AND (p.nom LIKE ? OR p.matricule LIKE ? OR IFNULL(p.fonction,'') LIKE ?)"
        params += [f"%{recherche}%"] * 3
    sql += " ORDER BY p.ordre, p.id"
    out = []
    for n, r in enumerate(db.query(sql, params), start=1):
        d = dict(r)
        d["numero"] = n
        d["age"] = calculs.datedif_years(d["date_naissance"], annee.date_ref_age) if annee else None
        d["anciennete"] = calculs.datedif_years(d["date_prise_service"], annee.date_edition) if annee else None
        d["classe_tenue"] = d.get("classe_code") or "-"
        out.append(d)
    return out


def save_personnel(db: Database, s: Session, pid: int | None, data: dict, annee: Annee | None = None) -> int:
    s.require("personnel.modifier")
    d = {k: _clean(data.get(k)) for k in PERSONNEL_CHAMPS}
    if not d["matricule"]:
        raise ValidationError("Le matricule est obligatoire.", "matricule")
    if not d["nom"]:
        raise ValidationError("Le nom est obligatoire.", "nom")
    if d["sexe"] not in ("M", "F"):
        raise ValidationError("Le sexe doit être M ou F.", "sexe")
    for k in ("date_naissance", "date_prise_service", "date_arrivee"):
        if d[k] and calculs.to_date(d[k]) is None:
            raise ValidationError("Date invalide.", k)
    if db.scalar("SELECT id FROM personnel WHERE matricule=? AND id<>?", (d["matricule"], pid or 0)):
        raise ValidationError("Ce matricule est déjà utilisé.", "matricule")
    cols = PERSONNEL_CHAMPS
    with db.transaction():
        if pid:
            db.execute(f"UPDATE personnel SET {', '.join(c + '=?' for c in cols)} WHERE id=?",
                       (*[d[c] for c in cols], pid))
        else:
            ordre = (db.scalar("SELECT MAX(ordre) FROM personnel", default=0) or 0) + 1
            pid = db.execute(f"INSERT INTO personnel({', '.join(cols)}, ordre) VALUES({', '.join('?' * len(cols))}, ?)",
                             (*[d[c] for c in cols], ordre)).lastrowid
        if annee is not None and "classe_tenue" in data:
            ct = _clean(data.get("classe_tenue"))
            ct = None if ct in (None, "-") else ct
            if ct and annee.classe(ct) is None:
                raise ValidationError("Classe tenue inconnue.", "classe_tenue")
            db.execute("INSERT INTO affectation(personnel_id, annee_id, classe_code) VALUES(?,?,?) "
                       "ON CONFLICT(personnel_id, annee_id) DO UPDATE SET classe_code=excluded.classe_code",
                       (pid, annee.id, ct))
    log(db, s.login, "MODIF_PERSONNEL", "personnel", f"{pid} {d['nom']}")
    return pid


def delete_personnel(db: Database, s: Session, pid: int) -> None:
    s.require("personnel.supprimer")
    nom = db.scalar("SELECT nom FROM personnel WHERE id=?", (pid,))
    db.execute("DELETE FROM personnel WHERE id=?", (pid,))
    log(db, s.login, "SUPPRESSION_PERSONNEL", "personnel", f"{pid} {nom}")


# ============================================================== absences
def _validate_absence(d: dict, annee: Annee) -> dict:
    dt = calculs.to_date(d.get("date"))
    if dt is None:
        raise ValidationError("La date est obligatoire.", "date")
    a1 = calculs.to_date(annee.date_debut)
    a2 = calculs.to_date(annee.date_fin)
    if a1 and a2 and not a1 <= dt <= a2:
        raise ValidationError(f"La date doit être comprise dans l'année scolaire {annee.libelle}.", "date")
    nature = d.get("nature")
    if nature not in ("RETARD", "ABSENCE"):
        raise ValidationError("Nature : RETARD ou ABSENCE.", "nature")
    jours = d.get("jours")
    retard = d.get("retard_min")
    jours = None if jours in (None, "") else float(str(jours).replace(",", "."))
    retard = None if retard in (None, "") else int(float(retard))
    if jours is not None and not 0 <= jours <= 31:
        raise ValidationError("Jours d'absence : entre 0 et 31 (0,5 = demi-journée).", "jours")
    if retard is not None and not 0 <= retard <= 600:
        raise ValidationError("Retard : entre 0 et 600 minutes.", "retard_min")
    if nature == "ABSENCE" and not jours:
        raise ValidationError("Indiquez le nombre de jours d'absence.", "jours")
    if nature == "RETARD" and not retard:
        raise ValidationError("Indiquez la durée du retard en minutes.", "retard_min")
    j = d.get("justifie")
    if j and j not in ("OUI", "NON"):
        raise ValidationError("Justifié : OUI ou NON.", "justifie")
    return {"date": dt.isoformat(), "nature": nature, "jours": jours if nature == "ABSENCE" else None,
            "retard_min": retard if nature == "RETARD" else None, "motif": _clean(d.get("motif")),
            "justifie": j, "observations": _clean(d.get("observations"))}


def save_absence(db: Database, s: Session, kind: str, aid: int | None, annee: Annee, data: dict) -> int:
    """kind = 'eleve' (cible = inscription_id) ou 'personnel' (cible = personnel_id)."""
    s.require("absences.modifier")
    d = _validate_absence(data, annee)
    table, fk = ("absence_eleve", "inscription_id") if kind == "eleve" else ("absence_personnel", "personnel_id")
    cible = data.get(fk)
    if not cible:
        raise ValidationError("Choisissez " + ("l'élève." if kind == "eleve" else "l'agent."), fk)
    cols = ["date", "nature", "jours", "retard_min", "motif", "justifie", "observations"]
    if aid:
        db.execute(f"UPDATE {table} SET {fk}=?, {', '.join(c + '=?' for c in cols)} WHERE id=?",
                   (cible, *[d[c] for c in cols], aid))
    else:
        aid = db.execute(f"INSERT INTO {table}(annee_id, {fk}, {', '.join(cols)}) VALUES(?,?,{','.join('?' * len(cols))})",
                         (annee.id, cible, *[d[c] for c in cols])).lastrowid
    log(db, s.login, "ABSENCE_" + kind.upper(), table, str(aid))
    return aid


def delete_absence(db: Database, s: Session, kind: str, aid: int) -> None:
    s.require("absences.modifier")
    db.execute(f"DELETE FROM {'absence_eleve' if kind == 'eleve' else 'absence_personnel'} WHERE id=?", (aid,))
    log(db, s.login, "SUPPRESSION_ABSENCE", kind, str(aid))


def absences_eleves(db: Database, annee: Annee, mois: int | None = None) -> list[dict]:
    sql = ("SELECT a.*, i.matricule_ecole, e.nom, e.sexe, c.code AS classe FROM absence_eleve a "
           "JOIN inscription i ON i.id=a.inscription_id JOIN eleve e ON e.id=i.eleve_id "
           "JOIN classe c ON c.id=i.classe_id WHERE a.annee_id=?")
    params: list = [annee.id]
    if mois:
        sql += " AND CAST(strftime('%m', a.date) AS INTEGER)=?"
        params.append(mois)
    rows = [dict(r) for r in db.query(sql + " ORDER BY a.date, a.id", params)]
    for n, r in enumerate(rows, 1):
        r["numero"] = n
        r["mois"] = int(r["date"][5:7])
        r["annee_civile"] = int(r["date"][:4])
    return rows


def absences_personnel(db: Database, annee: Annee, mois: int | None = None) -> list[dict]:
    sql = ("SELECT a.*, p.matricule, p.nom, p.sexe, IFNULL(af.classe_code,'-') AS cours_tenu FROM absence_personnel a "
           "JOIN personnel p ON p.id=a.personnel_id LEFT JOIN affectation af ON af.personnel_id=p.id "
           "AND af.annee_id=a.annee_id WHERE a.annee_id=?")
    params: list = [annee.id]
    if mois:
        sql += " AND CAST(strftime('%m', a.date) AS INTEGER)=?"
        params.append(mois)
    rows = [dict(r) for r in db.query(sql + " ORDER BY a.date, a.id", params)]
    for n, r in enumerate(rows, 1):
        r["numero"] = n
        r["mois"] = int(r["date"][5:7])
        r["annee_civile"] = int(r["date"][:4])
    return rows


# ============================================================== textes à rédiger
def get_textes(db: Database, annee_id: int, rapport: str, cle: str = "") -> dict[str, str]:
    return {r["champ"]: r["texte"] or "" for r in db.query(
        "SELECT champ, texte FROM texte_rapport WHERE annee_id=? AND rapport=? AND cle=?", (annee_id, rapport, cle))}


def set_texte(db: Database, s: Session, annee_id: int, rapport: str, cle: str, champ: str, texte: str) -> None:
    s.require("rapports.generer")
    db.execute("INSERT INTO texte_rapport(annee_id, rapport, cle, champ, texte) VALUES(?,?,?,?,?) "
               "ON CONFLICT(annee_id, rapport, cle, champ) DO UPDATE SET texte=excluded.texte",
               (annee_id, rapport, cle or "", champ, texte))


# ============================================================== photos
PHOTO_MAX_PX = 480          # côté le plus long après réduction
PHOTO_MAX_OCTETS = 15 * 1024 * 1024


def normaliser_photo(data: bytes) -> bytes:
    """Vérifie que le fichier est une image et la réduit en JPEG (≈ 30 à 80 Ko)."""
    if not data or len(data) > PHOTO_MAX_OCTETS:
        raise ValidationError("Photo vide ou trop volumineuse (15 Mo maximum).", "photo")
    from PySide6.QtCore import QBuffer, QByteArray, QIODevice, Qt
    from PySide6.QtGui import QImage
    img = QImage.fromData(QByteArray(data))
    if img.isNull():
        raise ValidationError("Ce fichier n'est pas une image reconnue (JPEG, PNG, BMP…).", "photo")
    if max(img.width(), img.height()) > PHOTO_MAX_PX:
        img = img.scaled(PHOTO_MAX_PX, PHOTO_MAX_PX, Qt.KeepAspectRatio, Qt.SmoothTransformation)
    img = img.convertToFormat(QImage.Format_RGB888)
    buf = QBuffer()
    buf.open(QIODevice.WriteOnly)
    img.save(buf, "JPEG", 85)
    return bytes(buf.data())


def set_photo(db: Database, s: Session, kind: str, ref_id: int, data: bytes | None) -> None:
    """Enregistre (ou supprime si data est None) la photo d'un élève ou d'un agent."""
    if kind not in ("eleve", "personnel"):
        raise ValueError(kind)
    s.require("eleves.modifier" if kind == "eleve" else "personnel.modifier")
    table = "eleve" if kind == "eleve" else "personnel"
    if not db.scalar(f"SELECT 1 FROM {table} WHERE id=?", (ref_id,)):
        raise ValidationError("Fiche introuvable.")
    if data is None:
        db.execute("DELETE FROM photo WHERE kind=? AND ref_id=?", (kind, ref_id))
        log(db, s.login, "PHOTO_SUPPRESSION", kind, str(ref_id))
        return
    jpeg = normaliser_photo(data)
    db.execute("INSERT INTO photo(kind, ref_id, data, mime) VALUES(?,?,?,'image/jpeg') "
               "ON CONFLICT(kind, ref_id) DO UPDATE SET data=excluded.data, mime=excluded.mime, "
               "modifie_le=datetime('now','localtime')", (kind, ref_id, jpeg))
    log(db, s.login, "PHOTO", kind, str(ref_id))


def get_photo(db: Database, kind: str, ref_id: int) -> bytes | None:
    return db.scalar("SELECT data FROM photo WHERE kind=? AND ref_id=?", (kind, ref_id))


# ============================================================== en-tête d'impression et logos
LOGOS = {"logo_iepp": "Logo de l'IEPP", "logo_ecole": "Logo de l'école"}
LOGO_MAX_PX = 400


def normaliser_logo(data: bytes) -> bytes:
    """Vérifie que le fichier est une image et la réduit en PNG (la transparence est conservée)."""
    if not data or len(data) > PHOTO_MAX_OCTETS:
        raise ValidationError("Logo vide ou trop volumineux (15 Mo maximum).", "logo")
    from PySide6.QtCore import QBuffer, QByteArray, QIODevice, Qt
    from PySide6.QtGui import QImage
    img = QImage.fromData(QByteArray(data))
    if img.isNull():
        raise ValidationError("Ce fichier n'est pas une image reconnue (PNG, JPEG, BMP…).", "logo")
    if max(img.width(), img.height()) > LOGO_MAX_PX:
        img = img.scaled(LOGO_MAX_PX, LOGO_MAX_PX, Qt.KeepAspectRatio, Qt.SmoothTransformation)
    buf = QBuffer()
    buf.open(QIODevice.WriteOnly)
    img.save(buf, "PNG")
    return bytes(buf.data())


def set_logo(db: Database, s: Session, quel: str, data: bytes | None) -> None:
    """Enregistre (ou retire si data est None) le logo de l'IEPP ou de l'école. Le logo est stocké
    dans la base : il fait donc partie des sauvegardes."""
    if quel not in LOGOS:
        raise ValueError(quel)
    s.require("parametres.modifier")
    if data is None:
        db.set_param(quel, "")
        log(db, s.login, "LOGO_SUPPRESSION", quel, "")
        return
    import base64
    db.set_param(quel, base64.b64encode(normaliser_logo(data)).decode("ascii"))
    log(db, s.login, "LOGO", quel, "")


def get_logo(db: Database, quel: str) -> bytes | None:
    return decode_logo(db.get_param(quel) if quel in LOGOS else None)


def decode_logo(valeur: str | None) -> bytes | None:
    if not valeur:
        return None
    import base64
    import binascii
    try:
        return base64.b64decode(valeur, validate=True)
    except (binascii.Error, ValueError):
        return None


def reset_entete(db: Database, s: Session) -> None:
    """Rétablit le texte officiel de l'en-tête d'impression (les logos ne sont pas touchés)."""
    from epp.core import seed
    s.require("parametres.modifier")
    with db.transaction():
        db.set_param("entete_gauche", seed.ENTETE_GAUCHE_DEFAUT)
        db.set_param("entete_droite", seed.ENTETE_DROITE_DEFAUT)
    log(db, s.login, "MODIF_PARAMETRES", "entete", "en-tête officiel rétabli")
