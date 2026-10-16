"""Accès des enseignants : comptes créés par le directeur, validation des notes, période de saisie, suivi des
classes, appel du jour, messages du directeur et journal par enseignant.

Un compte enseignant (rôle ENSEIGNANT) est lié à une fiche du personnel : il ne voit et ne saisit que la classe
que cette fiche tient dans l'année (table affectation), sur l'ordinateur comme sur son téléphone. Une fiche du
personnel désactivée ou supprimée bloque le compte et ses téléphones (déclencheurs SQL, version 9).
"""
from __future__ import annotations

import secrets
from datetime import date

from epp.core import security
from epp.core.db import Database
from epp.core.security import AccessDenied, Session, log
from epp.domain import repo
from epp.domain.repo import Annee, ValidationError

PERMISSION = "enseignants.gerer"
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def mot_de_passe_provisoire() -> str:
    """8 caractères sans lettres ambiguës (l, i, o, 0, 1), faciles à recopier."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(8))


# =================================================================== comptes
def enseignants(db: Database, annee: Annee | None) -> list[dict]:
    """Agents actifs qui tiennent une classe dans l'année, ou qui ont un compte enseignant."""
    aid = annee.id if annee else 0
    rows = db.query(
        "SELECT p.id AS personnel_id, p.nom, p.matricule, p.fonction, a.classe_code AS classe, u.id AS utilisateur_id, "
        "u.login, u.actif AS compte_actif, u.doit_changer, u.derniere_connexion, "
        "(SELECT COUNT(*) FROM appareil ap WHERE ap.utilisateur_id=u.id AND ap.actif=1) AS telephones, "
        "(SELECT MAX(ap.dernier_contact) FROM appareil ap WHERE ap.utilisateur_id=u.id) AS derniere_synchro "
        "FROM personnel p LEFT JOIN affectation a ON a.personnel_id=p.id AND a.annee_id=? "
        "LEFT JOIN utilisateur u ON u.personnel_id=p.id "
        "WHERE p.actif=1 AND ((a.classe_code IS NOT NULL AND a.classe_code<>'') OR u.id IS NOT NULL) "
        "ORDER BY COALESCE(a.classe_code, 'zzz'), p.nom", (aid,))
    return [dict(r) for r in rows]


def comptes_sans_fiche(db: Database) -> list[dict]:
    """Comptes enseignants pas encore liés à une fiche du personnel (créés avant la version 1.2.0)."""
    return [dict(r) for r in db.query(
        "SELECT u.id, u.login, u.nom FROM utilisateur u JOIN role r ON r.id=u.role_id "
        "WHERE r.code=? AND u.personnel_id IS NULL ORDER BY u.login", (security.ROLE_ENSEIGNANT,))]


def _compte(db: Database, uid: int) -> dict:
    r = db.one("SELECT u.*, r.code AS role FROM utilisateur u JOIN role r ON r.id=u.role_id WHERE u.id=?", (uid,))
    if r is None:
        raise ValidationError("Compte introuvable.")
    if r["role"] != security.ROLE_ENSEIGNANT:
        raise AccessDenied("Ce compte n'est pas un compte enseignant : seul un administrateur peut le gérer.")
    return dict(r)


def creer_compte(db: Database, s: Session, personnel_id: int, login: str, mot_de_passe: str) -> int:
    """Compte enseignant lié à la fiche ; le mot de passe provisoire est à changer à la première connexion."""
    s.require(PERMISSION)
    p = db.one("SELECT nom, actif FROM personnel WHERE id=?", (personnel_id,))
    if p is None or not p["actif"]:
        raise ValidationError("Agent introuvable ou désactivé.")
    if db.scalar("SELECT id FROM utilisateur WHERE personnel_id=?", (personnel_id,)):
        raise ValidationError(f"{p['nom']} a déjà un compte.")
    with db.transaction():
        uid = security.create_user(db, login, p["nom"], mot_de_passe, security.ROLE_ENSEIGNANT, doit_changer=True)
        db.execute("UPDATE utilisateur SET personnel_id=? WHERE id=?", (personnel_id, uid))
    log(db, s.login, "AJOUT_COMPTE_ENSEIGNANT", "utilisateur", f"{login} ({p['nom']})")
    return uid


def lier_compte(db: Database, s: Session, uid: int, personnel_id: int) -> None:
    s.require(PERMISSION)
    u = _compte(db, uid)
    if db.scalar("SELECT id FROM utilisateur WHERE personnel_id=? AND id<>?", (personnel_id, uid)):
        raise ValidationError("Cet agent a déjà un autre compte.")
    db.execute("UPDATE utilisateur SET personnel_id=? WHERE id=?", (personnel_id, uid))
    log(db, s.login, "LIEN_COMPTE_ENSEIGNANT", "utilisateur", f"{u['login']} -> personnel {personnel_id}")


def reinitialiser(db: Database, s: Session, uid: int, mot_de_passe: str) -> None:
    s.require(PERMISSION)
    u = _compte(db, uid)
    security.set_password(db, uid, mot_de_passe)
    db.execute("UPDATE utilisateur SET doit_changer=1 WHERE id=?", (uid,))
    log(db, s.login, "REINIT_MOT_DE_PASSE", "utilisateur", u["login"])


def activer(db: Database, s: Session, uid: int, actif: bool) -> None:
    """Désactiver un compte coupe aussi ses téléphones ; le réactiver ne les réactive pas (nouvelle association)."""
    s.require(PERMISSION)
    u = _compte(db, uid)
    if actif and u["personnel_id"] and not db.scalar("SELECT actif FROM personnel WHERE id=?", (u["personnel_id"],)):
        raise ValidationError("La fiche du personnel de cet enseignant est désactivée : réactivez-la d'abord.")
    with db.transaction():
        db.execute("UPDATE utilisateur SET actif=? WHERE id=?", (int(actif), uid))
        if not actif:
            db.execute("UPDATE appareil SET actif=0 WHERE utilisateur_id=?", (uid,))
    log(db, s.login, "ACTIVATION_COMPTE" if actif else "DESACTIVATION_COMPTE", "utilisateur", u["login"])


# =================================================================== période de saisie
def evaluations(db: Database, annee: Annee) -> list[dict]:
    return [dict(r) for r in db.query(
        "SELECT calendrier, num, libelle, date, saisie_fermee, fin_saisie FROM evaluation WHERE annee_id=? "
        "ORDER BY num, calendrier", (annee.id,))]


def regler_saisie(db: Database, s: Session, annee: Annee, calendrier: str, num: int, fermee: bool,
                  fin_saisie: str | None = None) -> None:
    s.require(PERMISSION)
    if annee.cloturee:
        raise ValidationError("Année clôturée.")
    db.execute("UPDATE evaluation SET saisie_fermee=?, fin_saisie=? WHERE annee_id=? AND calendrier=? AND num=?",
               (int(fermee), fin_saisie or None, annee.id, calendrier, num))
    log(db, s.login, "SAISIE_FERMEE" if fermee else "SAISIE_OUVERTE", "evaluation",
        f"{calendrier} {num}" + (f" (fin {fin_saisie})" if fin_saisie else ""))


# =================================================================== validation des notes
def notes_en_attente(db: Database, annee: Annee) -> list[dict]:
    """Par classe et par évaluation : nombre de notes saisies par les enseignants en attente de validation."""
    return [dict(r) for r in db.query(
        "SELECT c.code AS classe, m.eval_num, COUNT(*) AS n, GROUP_CONCAT(DISTINCT n.saisi_par) AS saisi_par "
        "FROM note n JOIN inscription i ON i.id=n.inscription_id JOIN classe c ON c.id=i.classe_id "
        "JOIN matiere m ON m.id=n.matiere_id WHERE i.annee_id=? AND n.en_attente=1 "
        "GROUP BY c.code, m.eval_num ORDER BY c.ordre, c.code, m.eval_num", (annee.id,))]


def valider_notes(db: Database, s: Session, annee: Annee, classe_code: str, eval_num: int) -> int:
    """Les notes en attente de la classe pour l'évaluation comptent désormais (moyennes, bulletins)."""
    s.require(PERMISSION)
    cl = annee.classe(classe_code)
    if cl is None:
        raise ValidationError("Classe inconnue.")
    n = db.execute(
        "UPDATE note SET en_attente=0 WHERE en_attente=1 AND inscription_id IN "
        "(SELECT id FROM inscription WHERE classe_id=?) AND matiere_id IN "
        "(SELECT id FROM matiere WHERE grille_id=? AND eval_num=?)", (cl.id, cl.grille_id, eval_num)).rowcount
    log(db, s.login, "NOTES_VALIDEES", "note", f"{classe_code} évaluation {eval_num} : {n} note(s)")
    return n


# =================================================================== appel du jour
def enregistrer_appel(db: Database, s: Session, annee: Annee, classe_code: str, jour: str,
                      absents: list[int], demi_journee: bool = False) -> int:
    """Appel d'une classe : une absence par élève absent (sauf s'il en a déjà une ce jour-là). Renvoie le
    nombre d'absences créées."""
    s.require("absences.modifier")
    s.verifier_classe(annee.id, classe_code)
    cl = annee.classe(classe_code)
    if cl is None:
        raise ValidationError("Classe inconnue.")
    inscrits = {r["inscription_id"] for r in repo.inscriptions(db, annee, classe_code)}
    crees = 0
    with db.transaction():
        for iid in absents:
            if iid not in inscrits:
                raise ValidationError("Un élève de l'appel n'est pas dans la classe.")
            if db.scalar("SELECT 1 FROM absence_eleve WHERE inscription_id=? AND date=? AND nature='ABSENCE'",
                         (iid, jour)):
                continue
            repo.save_absence(db, s, "eleve", None, annee, {
                "inscription_id": iid, "date": jour, "nature": "ABSENCE", "jours": 0.5 if demi_journee else 1,
                "justifie": "NON", "observations": "Appel du jour"})
            crees += 1
        db.execute("INSERT INTO appel(annee_id, classe_code, date, absents, presents, fait_par) VALUES(?,?,?,?,?,?) "
                   "ON CONFLICT(annee_id, classe_code, date) DO UPDATE SET absents=excluded.absents, "
                   "presents=excluded.presents, fait_par=excluded.fait_par, fait_le=datetime('now','localtime')",
                   (annee.id, classe_code, jour, len(absents), len(inscrits) - len(absents), s.login))
    log(db, s.login, "APPEL", "classe", f"{classe_code} {jour} : {len(absents)} absent(s)")
    return crees


# =================================================================== suivi des classes
def suivi(db: Database, annee: Annee, eval_num: int, jour: str | None = None) -> list[dict]:
    """Une ligne par classe : enseignant, notes saisies / attendues pour l'évaluation, notes en attente, appel et
    absences du jour, dernière synchronisation du téléphone de l'enseignant."""
    jour = jour or date.today().isoformat()
    profs = {}
    for e in enseignants(db, annee):
        if e["classe"]:
            profs.setdefault(e["classe"], e)
    appels = {r["classe_code"]: dict(r) for r in db.query(
        "SELECT * FROM appel WHERE annee_id=? AND date=?", (annee.id, jour))}
    abs_jour: dict[str, int] = {}
    for r in db.query("SELECT c.code, COUNT(*) AS n FROM absence_eleve a JOIN inscription i ON i.id=a.inscription_id "
                      "JOIN classe c ON c.id=i.classe_id WHERE a.annee_id=? AND a.date=? GROUP BY c.code",
                      (annee.id, jour)):
        abs_jour[r["code"]] = r["n"]
    out = []
    for cl in annee.classes:
        saisies = attendues = attente = 0
        if cl.grille_id in annee.grilles:
            mats, lignes = repo.notes_grille(db, annee, cl.grille_id, eval_num, cl.code)
            for r in lignes:
                if r["present"]:
                    attendues += len(mats)
                    saisies += len(r["notes"])
                    attente += len(r["attente"])
        p = profs.get(cl.code) or {}
        ap = appels.get(cl.code)
        out.append({
            "classe": cl.code, "enseignant": p.get("nom") or "", "login": p.get("login") or "",
            "notes_saisies": saisies, "notes_attendues": attendues,
            "notes_manquantes": max(0, attendues - saisies), "notes_en_attente": attente,
            "appel": (ap["fait_le"][11:16] + f" ({ap['absents']} abs.)") if ap else "",
            "absences_jour": abs_jour.get(cl.code, 0),
            "derniere_synchro": (p.get("derniere_synchro") or "")[:16].replace("T", " ")})
    return out


# =================================================================== messages du directeur
def envoyer_message(db: Database, s: Session, titre: str, texte: str, destinataire_id: int | None = None) -> int:
    """destinataire_id None = tous les enseignants."""
    s.require(PERMISSION)
    titre, texte = (titre or "").strip(), (texte or "").strip()
    if not titre or not texte:
        raise ValidationError("Le titre et le texte du message sont obligatoires.")
    if destinataire_id:
        _compte(db, destinataire_id)
    mid = db.execute("INSERT INTO message(auteur, destinataire_id, titre, texte) VALUES(?,?,?,?)",
                     (s.nom or s.login, destinataire_id, titre, texte)).lastrowid
    log(db, s.login, "MESSAGE", "message", titre)
    return mid


def _destinataires(db: Database, m) -> int:
    if m["destinataire_id"]:
        return 1
    return db.scalar("SELECT COUNT(*) FROM utilisateur u JOIN role r ON r.id=u.role_id WHERE r.code=? AND u.actif=1",
                     (security.ROLE_ENSEIGNANT,), 0)


def messages_envoyes(db: Database) -> list[dict]:
    out = []
    for m in db.query("SELECT m.*, u.nom AS destinataire FROM message m LEFT JOIN utilisateur u ON "
                      "u.id=m.destinataire_id ORDER BY m.id DESC"):
        lus = db.query("SELECT u.nom FROM message_lu l JOIN utilisateur u ON u.id=l.utilisateur_id "
                       "WHERE l.message_id=? ORDER BY l.lu_le", (m["id"],))
        out.append({**dict(m), "destinataire": m["destinataire"] or "Tous les enseignants",
                    "lus": len(lus), "attendus": _destinataires(db, m), "lu_par": ", ".join(r[0] for r in lus)})
    return out


def messages_pour(db: Database, s: Session) -> list[dict]:
    """Messages reçus par l'utilisateur (les plus récents d'abord), avec « lu »."""
    tous = " OR m.destinataire_id IS NULL" if s.role_code == security.ROLE_ENSEIGNANT else ""
    return [{**dict(r), "lu": bool(r["lu_le"])} for r in db.query(
        "SELECT m.id, m.cree_le, m.auteur, m.titre, m.texte, l.lu_le FROM message m LEFT JOIN message_lu l ON "
        f"l.message_id=m.id AND l.utilisateur_id=? WHERE m.destinataire_id=?{tous} ORDER BY m.id DESC LIMIT 100",
        (s.user_id, s.user_id))]


def marquer_lu(db: Database, s: Session, message_id: int) -> None:
    if db.scalar("SELECT 1 FROM message WHERE id=?", (message_id,)):
        db.execute("INSERT OR IGNORE INTO message_lu(message_id, utilisateur_id) VALUES(?,?)", (message_id, s.user_id))


# =================================================================== journal par enseignant
def journal(db: Database, login: str | None = None, limite: int = 1000) -> list[dict]:
    """Journal des comptes enseignants (saisies et corrections de notes, appels, connexions…)."""
    if login:
        logins = [login]
    else:
        logins = [r[0] for r in db.query("SELECT u.login FROM utilisateur u JOIN role r ON r.id=u.role_id "
                                         "WHERE r.code=?", (security.ROLE_ENSEIGNANT,))]
    if not logins:
        return []
    q = ",".join("?" * len(logins))
    return [dict(r) for r in db.query(
        f"SELECT horodatage, utilisateur, action, details FROM journal WHERE utilisateur IN ({q}) "
        "ORDER BY id DESC LIMIT ?", (*logins, limite))]
