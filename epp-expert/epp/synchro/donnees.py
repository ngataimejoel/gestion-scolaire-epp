"""Données échangées avec les téléphones : copie de l'année en cours envoyée au téléphone (selon les droits de
l'utilisateur associé) et application des saisies faites sur le téléphone.

Les règles de l'application Windows s'appliquent à l'identique, ici, côté ordinateur :
- droits du rôle de l'utilisateur (notes.modifier, absences.modifier…) et licence valable ;
- corriger ou effacer une note déjà saisie, noter absent un élève qui a des notes, supprimer une absence :
  mot de passe d'un administrateur (chaque tentative est inscrite au journal) ;
- année clôturée en lecture seule ; contrôles de validité des notes et des absences (repo).
Depuis la version 1.1.1, le téléphone peut aussi inscrire un élève (droit eleves.modifier) et corriger la fiche
d'un élève enregistré (mot de passe d'un administrateur, comme sur l'ordinateur). Un élève inscrit sur le
téléphone porte l'identifiant provisoire « u:<uid de l'opération> » jusqu'à la synchronisation : les saisies qui
le concernent (notes, absences) sont rattachées à l'élève créé, même envoyées plus tard.
La fiche du personnel reste modifiable sur l'ordinateur seulement.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from epp import __version__
from epp.core import security
from epp.core.db import AnneeCloturee, Database
from epp.core.security import AccessDenied, Session
from epp.domain import repo, resultats
from epp.domain.referentiels import norm
from epp.domain.repo import ValidationError

CHAMPS_ELEVE = ("inscription_id", "eleve_id", "numero", "matricule_ecole", "matricule_desps", "nom", "sexe",
                "date_naissance", "age", "classe", "statut", "redoublant", "type", "nationalite", "localite",
                "groupe_sanguin", "allergies", "pere_nom", "pere_tel", "mere_nom", "mere_tel", "tuteur_nom",
                "tuteur_tel", "observations")
CHAMPS_PERSONNEL = ("id", "numero", "matricule", "nom", "sexe", "fonction", "grade", "telephone", "classe_tenue")
CHAMPS_ABSENCE = ("id", "date", "nature", "jours", "retard_min", "motif", "justifie", "observations",
                  "autorisation_id")
PARAMETRES_ECOLE = ("ecole_nom", "iepp", "dren", "localite", "directeur", "pays", "ministere")


# =================================================================== copie envoyée au téléphone
def licence_resume(etat) -> dict:
    """État de la licence de l'ordinateur et date jusqu'à laquelle le téléphone peut afficher les données
    sans nouvelle synchronisation (fin d'essai ou fin de licence ; None = licence à vie)."""
    jusqua = None
    if etat.statut == "active" and etat.expire_le:
        jusqua = etat.expire_le.astimezone(timezone.utc).isoformat()
    elif etat.statut == "essai":
        jusqua = (datetime.now(timezone.utc) + timedelta(days=etat.jours_restants or 0)).isoformat()
    return {"statut": etat.statut, "utilisable": etat.utilisable, "message": etat.message, "valide_jusqua": jusqua}


def _sous(d: dict, champs) -> dict:
    return {k: d.get(k) for k in champs}


def instantane(db: Database, s: Session, etat_licence) -> dict:
    """Copie des données de l'année active pour le téléphone, limitée aux droits de l'utilisateur."""
    out = {
        "version": 1, "genere_le": datetime.now(timezone.utc).isoformat(), "app_version": __version__,
        "licence": licence_resume(etat_licence),
        "utilisateur": {"login": s.login, "nom": s.nom, "role": s.role_libelle,
                        "permissions": sorted(s.permissions)},
        "ecole": {k: db.get_param(k, "") or "" for k in PARAMETRES_ECOLE},
        "annee": None,
    }
    if not etat_licence.utilisable:
        return out                               # licence échue : aucune donnée
    aid = repo.active_annee_id(db)
    if not aid:
        return out
    a = repo.load_annee(db, aid)
    out["annee"] = {"id": a.id, "libelle": a.libelle, "date_debut": a.date_debut, "date_fin": a.date_fin,
                    "cloturee": a.cloturee}
    out["classes"] = [{"id": c.id, "code": c.code, "libelle": c.libelle, "grille_id": c.grille_id,
                       "calendrier": c.calendrier, "bareme": c.bareme, "seuil": c.seuil, "regle_mga": c.regle_mga,
                       "niveau_suivant": c.niveau_suivant} for c in a.classes]
    out["grilles"] = [{"id": g.id, "code": g.code, "libelle": g.libelle, "mode": g.mode, "echelle": g.echelle,
                       "note_max": g.note_max,
                       "matieres": {str(n): [{"id": m["id"], "libelle": m["libelle"], "valeur": m["valeur"]}
                                             for m in ms] for n, ms in g.matieres.items()}}
                      for g in a.grilles.values()]
    out["evaluations"] = {cal: [{"num": n, "libelle": e["libelle"], "date": e["date"]} for n, e in sorted(evs.items())]
                          for cal, evs in a.evaluations.items()}
    out["motifs_absence"] = repo.liste(db, "MOTIF_ABSENCE")
    if s.can("eleves.lire") or s.can("notes.lire") or s.can("absences.lire"):
        out["eleves"] = [_sous(r, CHAMPS_ELEVE) for r in repo.inscriptions(db, a)]
    if s.can("notes.lire"):
        notes: dict[str, dict[str, float]] = {}
        for n in db.query("SELECT n.inscription_id, n.matiere_id, n.valeur FROM note n JOIN inscription i "
                          "ON i.id=n.inscription_id WHERE i.annee_id=?", (a.id,)):
            notes.setdefault(str(n["inscription_id"]), {})[str(n["matiere_id"])] = n["valeur"]
        out["notes"] = notes
        absents: dict[str, list[int]] = {}
        for p in db.query("SELECT p.inscription_id, p.eval_num FROM presence_eval p JOIN inscription i "
                          "ON i.id=p.inscription_id WHERE i.annee_id=? AND p.present=0", (a.id,)):
            absents.setdefault(str(p["inscription_id"]), []).append(p["eval_num"])
        out["absents_evaluation"] = absents
        out["resultats"] = [{"inscription_id": r["inscription_id"], "moy1": r["moy1"], "moy2": r["moy2"],
                             "moy3": r["moy3"], "moy4": r["moy4"], "mga": r["mga"], "rang": r["rang"],
                             "decision": r["decision"], "observation": r["observation"]}
                            for r in resultats.compute(db, a)]
    if s.can("personnel.lire") or s.can("absences.lire"):
        out["personnel"] = [_sous(r, CHAMPS_PERSONNEL) for r in repo.personnel(db, a)]
    if s.can("absences.lire"):
        out["absences_eleves"] = [{**_sous(r, CHAMPS_ABSENCE), "inscription_id": r["inscription_id"]}
                                  for r in repo.absences_eleves(db, a)]
        out["absences_personnel"] = [{**_sous(r, CHAMPS_ABSENCE), "personnel_id": r["personnel_id"]}
                                     for r in repo.absences_personnel(db, a)]
    return out


# =================================================================== saisies reçues du téléphone
class AdminRequis(Exception):
    """L'opération demande le mot de passe d'un administrateur (non fourni ou incorrect)."""


class Conflit(Exception):
    """La donnée a changé sur l'ordinateur depuis la dernière synchronisation du téléphone."""


def _fmt(v) -> str:
    return "vide" if v is None else f"{v:g}"


def _nombre(v):
    if v in (None, ""):
        return None
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        raise ValidationError("La note doit être un nombre.") from None


class Applicateur:
    """Applique une liste d'opérations d'un téléphone avec les droits de son utilisateur."""

    def __init__(self, db: Database, s: Session, appareil: dict, mot_de_passe_admin: str | None = None):
        self.db, self.s, self.appareil = db, s, appareil
        self._mdp = mot_de_passe_admin or ""
        self._admin: str | None = None
        self.modifie: set[str] = set()           # « notes », « absences » : pages de l'ordinateur à actualiser

    def _exiger_admin(self, quoi: str) -> None:
        if not self._admin:
            raise AdminRequis(f"{quoi[:1].upper()}{quoi[1:]} : le mot de passe d'un administrateur est nécessaire."
                              if not self._mdp else "Mot de passe administrateur incorrect.")

    def appliquer(self, ops: list[dict]) -> list[dict]:
        if self._mdp:          # vérifié une fois, hors des transactions : la tentative reste au journal
            self._admin = security.verifier_admin(self.db, self.s, self._mdp,
                                                  f"saisies du téléphone « {self.appareil['nom']} »")
        return [self._une(op) for op in ops]

    def _une(self, op: dict) -> dict:
        uid = str(op.get("uid") or "")[:64]
        if not uid:
            return {"uid": uid, "ok": False, "code": "INVALIDE", "message": "Opération sans identifiant."}
        deja = self.db.scalar("SELECT resultat FROM synchro_op WHERE uid=?", (uid,))
        if deja:
            return json.loads(deja)              # déjà reçue (réponse perdue) : jamais appliquée deux fois
        try:
            with self.db.transaction():
                message = self._executer(op)
                extra = {}
                if isinstance(message, tuple):
                    message, extra = message
                res = {"uid": uid, "ok": True, "message": message, **extra}
                self.db.execute("INSERT INTO synchro_op(uid, appareil_id, resultat) VALUES(?,?,?)",
                                (uid, self.appareil["id"], json.dumps(res, ensure_ascii=False)))
            return res
        except AdminRequis as e:
            return {"uid": uid, "ok": False, "code": "ADMIN_REQUIS", "message": str(e)}
        except Conflit as e:
            return {"uid": uid, "ok": False, "code": "CONFLIT", "message": str(e)}
        except AnneeCloturee as e:
            return {"uid": uid, "ok": False, "code": "CLOTUREE", "message": str(e)}
        except AccessDenied as e:
            return {"uid": uid, "ok": False, "code": "DROITS", "message": str(e)}
        except (ValidationError, ValueError, KeyError, TypeError) as e:
            return {"uid": uid, "ok": False, "code": "INVALIDE", "message": str(e) or "Opération invalide."}

    # ------------------------------------------------------------------ opérations
    def _executer(self, op: dict):
        quoi = op.get("op")
        if quoi == "note":
            return self._note(op)
        if quoi == "presence":
            return self._presence(op)
        if quoi == "absence":
            return self._absence(op)
        if quoi == "suppr_absence":
            return self._suppr_absence(op)
        if quoi == "eleve":
            return self._eleve(op)
        raise ValidationError(f"Opération inconnue : {quoi}")

    def _resoudre(self, iid) -> int:
        """Identifiant d'inscription : entier, ou « u:<uid> » pour un élève inscrit depuis le téléphone."""
        if isinstance(iid, str) and iid.startswith("u:"):
            res = self.db.scalar("SELECT resultat FROM synchro_op WHERE uid=?", (iid[2:66],))
            vrai = json.loads(res).get("inscription_id") if res else None
            if not vrai:
                raise ValidationError("Élève inscrit sur le téléphone mais pas encore enregistré sur l'ordinateur.")
            return int(vrai)
        return int(iid)

    def _inscription(self, iid) -> dict:
        r = self.db.one("SELECT i.id, i.annee_id, i.matricule_ecole, e.nom FROM inscription i "
                        "JOIN eleve e ON e.id=i.eleve_id WHERE i.id=?", (self._resoudre(iid),))
        if r is None:
            raise ValidationError("Élève introuvable sur l'ordinateur (inscription supprimée ?).")
        return dict(r)

    def _note(self, op: dict) -> str:
        self.s.require("notes.modifier")
        ins = self._inscription(op["inscription_id"])
        mid = int(op["matiere_id"])
        m = self.db.one("SELECT libelle FROM matiere WHERE id=?", (mid,))
        if m is None:
            raise ValidationError("Matière introuvable sur l'ordinateur.")
        valeur, avant = _nombre(op.get("valeur")), _nombre(op.get("avant"))
        actuelle = self.db.scalar("SELECT valeur FROM note WHERE inscription_id=? AND matiere_id=?", (ins["id"], mid))
        if actuelle == valeur:
            return "Note déjà à jour."
        libelle = f"la note de {m['libelle']} de {ins['nom']}"
        if actuelle is not None and avant != actuelle:
            raise Conflit(f"{libelle[:1].upper()}{libelle[1:]} a été saisie sur l'ordinateur ({_fmt(actuelle)}) "
                          "après votre dernière synchronisation : vérifiez-la avant de la corriger.")
        if actuelle is not None:
            self._exiger_admin(f"corriger {libelle}")
        annee = repo.load_annee(self.db, ins["annee_id"])
        repo.set_note(self.db, self.s, annee, ins["id"], mid, valeur)
        if actuelle is not None:
            security.log(self.db, self.s.login, "NOTE_CORRIGEE", "note",
                         f"{ins['nom']} ({ins['matricule_ecole']}) {m['libelle']} : {_fmt(actuelle)} -> "
                         f"{_fmt(valeur) if valeur is not None else 'effacée'} (téléphone {self.appareil['nom']})")
        self.modifie.add("notes")
        return "Note enregistrée."

    def _presence(self, op: dict) -> str:
        self.s.require("notes.modifier")
        ins = self._inscription(op["inscription_id"])
        num, present = int(op["eval_num"]), bool(op["present"])
        grille_id = self.db.scalar("SELECT c.grille_id FROM inscription i JOIN classe c ON c.id=i.classe_id "
                                   "WHERE i.id=?", (ins["id"],))
        if not present:
            notes = self.db.scalar("SELECT COUNT(*) FROM note n JOIN matiere m ON m.id=n.matiere_id "
                                   "WHERE n.inscription_id=? AND m.eval_num=? AND m.grille_id=?",
                                   (ins["id"], num, grille_id), 0)
            if notes:
                self._exiger_admin(f"effacer les notes de {ins['nom']} (absent à l'évaluation {num})")
        repo.set_presence(self.db, self.s, ins["id"], num, present, grille_id)
        self.modifie.add("notes")
        return "Présence enregistrée."

    def _absence(self, op: dict) -> str:
        self.s.require("absences.modifier")
        kind = op.get("kind")
        if kind == "eleve":
            ins = self._inscription(op["cible"])
            annee = repo.load_annee(self.db, ins["annee_id"])
            data = {"inscription_id": ins["id"]}
        elif kind == "personnel":
            pid = self.db.scalar("SELECT id FROM personnel WHERE id=?", (int(op["cible"]),))
            if pid is None:
                raise ValidationError("Agent introuvable sur l'ordinateur.")
            annee = repo.load_annee(self.db, repo.active_annee_id(self.db))
            data = {"personnel_id": pid}
        else:
            raise ValidationError("Absence : élève ou personnel ?")
        data.update({k: op.get(k) for k in ("date", "nature", "jours", "retard_min", "motif", "justifie",
                                             "observations")})
        repo.save_absence(self.db, self.s, kind, None, annee, data)
        self.modifie.add("absences")
        return "Absence enregistrée."

    def _suppr_absence(self, op: dict) -> str:
        self.s.require("absences.modifier")
        kind = op.get("kind")
        table = {"eleve": "absence_eleve", "personnel": "absence_personnel"}.get(kind)
        if not table:
            raise ValidationError("Absence : élève ou personnel ?")
        r = self.db.one(f"SELECT id, date, autorisation_id FROM {table} WHERE id=?", (int(op["id"]),))
        if r is None:
            return "Absence déjà supprimée."
        if r["autorisation_id"]:
            raise ValidationError("Cette absence vient d'une autorisation accordée : gérez-la sur l'ordinateur "
                                  "(Absences › Autorisations).")
        self._exiger_admin(f"supprimer l'absence du {r['date']}")
        repo.delete_absence(self.db, self.s, kind, r["id"])
        self.modifie.add("absences")
        return "Absence supprimée."

    def _eleve(self, op: dict):
        """Inscription d'un élève (sans « inscription_id ») ou correction de sa fiche (mot de passe administrateur ;
        « avant » = valeurs vues par le téléphone, pour ne pas écraser une correction faite sur l'ordinateur)."""
        self.s.require("eleves.modifier")
        d = op.get("donnees") or {}
        aid = repo.active_annee_id(self.db)
        if not aid:
            raise ValidationError("Aucune année scolaire active sur l'ordinateur.")
        annee = repo.load_annee(self.db, aid)
        if annee.cloturee:
            raise AnneeCloturee()
        champs = {k: d.get(k) for k in repo.ELEVE_CHAMPS if k in d}
        if op.get("inscription_id") in (None, ""):
            classe = annee.classe(str(d.get("classe") or ""))
            if classe is None:
                raise ValidationError(f"Classe inconnue sur l'ordinateur : {d.get('classe')}.")
            existant = trouver_inscription(self.db, annee, champs)
            if existant:
                return "Élève déjà inscrit sur l'ordinateur.", {"inscription_id": existant}
            eid = None
            if champs.get("matricule_desps"):
                eid = self.db.scalar("SELECT id FROM eleve WHERE matricule_desps=?",
                                     (str(champs["matricule_desps"]).replace(" ", ""),))
            if eid:                 # élève connu d'une année précédente : réinscrit, sa fiche est conservée
                type_ = "REINSCRIPTION"
            else:
                eid = repo.save_eleve(self.db, self.s, None, champs, annee)
                type_ = "INSCRIPTION"
            iid = repo.inscrire(self.db, self.s, eid, annee, classe.code, redoublant=d.get("redoublant") or "NON",
                                statut=d.get("statut") or "PRESENT", type_=type_)
            self.modifie.add("eleves")
            return f"{champs.get('nom') or 'Élève'} inscrit en {classe.code}.", {"inscription_id": iid}
        ins = self._inscription(op["inscription_id"])
        cur = self.db.one("SELECT e.*, i.redoublant, i.statut, c.code AS classe FROM inscription i "
                          "JOIN eleve e ON e.id=i.eleve_id JOIN classe c ON c.id=i.classe_id WHERE i.id=?", (ins["id"],))
        cur = dict(cur)
        for k, v in (op.get("avant") or {}).items():
            if k in cur and str(cur[k] or "").strip() != str(v or "").strip():
                raise Conflit(f"La fiche de {cur['nom']} a été modifiée sur l'ordinateur après votre dernière "
                              "synchronisation : synchronisez, vérifiez-la, puis refaites la correction.")
        self._exiger_admin(f"modifier la fiche de {cur['nom']}")
        repo.save_eleve(self.db, self.s, cur["id"], {**{k: cur.get(k) for k in repo.ELEVE_CHAMPS}, **champs}, annee)
        classe = d.get("classe") or cur["classe"]
        redoublant, statut = d.get("redoublant") or cur["redoublant"], d.get("statut") or cur["statut"]
        if (classe, redoublant, statut) != (cur["classe"], cur["redoublant"], cur["statut"]):
            obs = self.db.scalar("SELECT observations FROM inscription WHERE id=?", (ins["id"],))
            repo.update_inscription(self.db, self.s, ins["id"], annee, classe, redoublant, statut, obs)
        security.log(self.db, self.s.login, "MODIF_ELEVE", "eleve",
                     f"{cur['nom']} ({ins['matricule_ecole']}) depuis le téléphone {self.appareil['nom']}")
        self.modifie.add("eleves")
        return "Fiche de l'élève enregistrée.", {"inscription_id": ins["id"]}


def trouver_inscription(db: Database, annee, champs: dict) -> int | None:
    """Inscription de l'année d'un élève déjà connu : même matricule DESPS, sinon même nom et même date de
    naissance (comparés sans accents ni ponctuation)."""
    m = str(champs.get("matricule_desps") or "").replace(" ", "")
    if m:
        iid = db.scalar("SELECT i.id FROM inscription i JOIN eleve e ON e.id=i.eleve_id "
                        "WHERE i.annee_id=? AND e.matricule_desps=?", (annee.id, m))
        if iid:
            return iid
    nom, dn = norm(champs.get("nom")), str(champs.get("date_naissance") or "")[:10]
    if not nom:
        return None
    for r in db.query("SELECT i.id, e.nom, e.date_naissance FROM inscription i JOIN eleve e ON e.id=i.eleve_id "
                      "WHERE i.annee_id=?", (annee.id,)):
        if norm(r["nom"]) == nom and str(r["date_naissance"] or "")[:10] == dn:
            return r["id"]
    return None
