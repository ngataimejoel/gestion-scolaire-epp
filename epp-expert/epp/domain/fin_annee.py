"""Validation des décisions de fin d'année (fonction ajoutée : absente du classeur d'origine).

La décision calculée (ADMIS si MGA ≥ seuil, sinon REDOUBLE ; ABANDON / TRANSFERE selon le statut)
sert de proposition. Le directeur la confirme ou la corrige classe par classe, avec cinq décisions
possibles : admis, redoublant, abandon, exclu, transféré. Une fois validée, la décision remplace la
proposition dans les résultats, les statistiques, les bulletins annuels et la réinscription de
l'année suivante.
"""
from __future__ import annotations

from epp.core.db import Database
from epp.core.security import Session, log
from epp.domain import resultats
from epp.domain.repo import Annee, ValidationError

DECISIONS = {
    "ADMIS": "Admis(e)",
    "REDOUBLE": "Redoublant(e)",
    "ABANDON": "Abandon",
    "EXCLU": "Exclu(e)",
    "TRANSFERE": "Transféré(e)",
}
PARTANTS = ("ABANDON", "EXCLU", "TRANSFERE")     # ne sont pas réinscrits l'année suivante
MOTIF_OBLIGATOIRE = ("EXCLU",)


def propositions(db: Database, annee: Annee, classe_code: str | None = None) -> list[dict]:
    """Une ligne par élève : décision calculée, décision retenue (validée ou proposée) et état."""
    out = []
    for r in resultats.compute(db, annee, classe_code):
        cl = annee.classe(r["classe"])
        out.append({k: r.get(k) for k in ("inscription_id", "eleve_id", "numero", "matricule_ecole", "nom", "sexe",
                                          "classe", "statut", "mga", "rang", "decision_calculee", "a_revoir")}
                   | {"decision": r["decision"], "validee": r["decision_validee"] == "OUI",
                      "motif": r["motif_decision"], "classe_suivante": cl.niveau_suivant if cl else None})
    return out


def valider(db: Database, s: Session, annee: Annee, choix: dict[int, str | tuple[str, str | None]]) -> int:
    """Valide (ou corrige) la décision de quelques élèves : {inscription_id: décision ou (décision, motif)}."""
    s.require("fin_annee.valider")
    lignes = {r["inscription_id"]: r for r in propositions(db, annee)}
    with db.transaction():
        for iid, c in choix.items():
            dec, motif = c if isinstance(c, tuple) else (c, None)
            r = lignes.get(iid)
            if r is None:
                raise ValidationError(f"Inscription {iid} introuvable pour l'année {annee.libelle}.")
            _enregistrer(db, s, r, dec, motif if motif is not None else r["motif"])
    log(db, s.login, "VALIDATION_FIN_ANNEE", annee.libelle, f"{len(choix)} élève(s)")
    return len(choix)


def valider_classe(db: Database, s: Session, annee: Annee, classe_code: str,
                   choix: dict[int, str | tuple[str, str | None]] | None = None) -> dict:
    """Valide toute une classe. Sans choix pour un élève, la décision déjà validée ou la proposition
    calculée est retenue ; un élève sans proposition (MGA incomplète) doit recevoir une décision."""
    s.require("fin_annee.valider")
    if annee.classe(classe_code) is None:
        raise ValidationError(f"Classe inconnue : {classe_code}", "classe")
    choix = choix or {}
    lignes = propositions(db, annee, classe_code)
    manquants = [r["nom"] for r in lignes if r["inscription_id"] not in choix and not r["decision"]]
    if manquants:
        raise ValidationError(
            f"Décision à choisir pour {len(manquants)} élève(s) sans moyenne annuelle : " + ", ".join(manquants[:5])
            + ("…" if len(manquants) > 5 else ""), "decision")
    bilan = {k: 0 for k in DECISIONS}
    with db.transaction():
        for r in lignes:
            c = choix.get(r["inscription_id"], r["decision"])
            dec, motif = c if isinstance(c, tuple) else (c, None)
            _enregistrer(db, s, r, dec, motif if motif is not None else r["motif"])
            bilan[dec] += 1
    log(db, s.login, "VALIDATION_FIN_ANNEE", f"{annee.libelle} {classe_code}",
        ", ".join(f"{DECISIONS[k]} : {n}" for k, n in bilan.items() if n))
    return bilan


def _enregistrer(db: Database, s: Session, r: dict, dec: str, motif: str | None) -> None:
    if dec not in DECISIONS:
        raise ValidationError(f"Décision invalide pour {r['nom']} : {dec}", "decision")
    motif = (motif or "").strip() or None
    if dec in MOTIF_OBLIGATOIRE and not motif:
        raise ValidationError(f"Indiquez le motif de la décision « {DECISIONS[dec]} » pour {r['nom']}.", "motif")
    db.execute(
        "INSERT INTO decision_fin_annee(inscription_id, decision, decision_calculee, motif, valide_par) "
        "VALUES(?,?,?,?,?) ON CONFLICT(inscription_id) DO UPDATE SET decision=excluded.decision, "
        "decision_calculee=excluded.decision_calculee, motif=excluded.motif, valide_par=excluded.valide_par, "
        "valide_le=datetime('now','localtime')",
        (r["inscription_id"], dec, r["decision_calculee"], motif, s.login))


def annuler_validation(db: Database, s: Session, annee: Annee, classe_code: str) -> int:
    """Rouvre une classe : les décisions validées sont retirées, les propositions calculées reviennent."""
    s.require("fin_annee.valider")
    cur = db.execute(
        "DELETE FROM decision_fin_annee WHERE inscription_id IN (SELECT i.id FROM inscription i "
        "JOIN classe c ON c.id = i.classe_id WHERE i.annee_id=? AND c.code=?)", (annee.id, classe_code))
    log(db, s.login, "VALIDATION_FIN_ANNEE_ANNULEE", f"{annee.libelle} {classe_code}", f"{cur.rowcount} élève(s)")
    return cur.rowcount


def etat(db: Database, annee: Annee) -> list[dict]:
    """Avancement de la validation, classe par classe."""
    lignes = propositions(db, annee)
    out = []
    for code in annee.codes:
        rs = [r for r in lignes if r["classe"] == code]
        valides = sum(r["validee"] for r in rs)
        out.append({
            "classe": code, "effectif": len(rs), "valides": valides,
            "complete": bool(rs) and valides == len(rs),
            "sans_proposition": sum(1 for r in rs if not r["decision"]),
            "a_revoir": sum(1 for r in rs if r["a_revoir"]),
            **{k: sum(1 for r in rs if r["decision"] == k) for k in DECISIONS},
        })
    return out


def annee_validee(db: Database, annee: Annee) -> bool:
    return all(e["complete"] or not e["effectif"] for e in etat(db, annee))


# ============================================================== passage à l'année suivante
def libelle_suivant(annee: Annee) -> str:
    a = int(annee.libelle[:4])
    return f"{a + 1}-{a + 2}"


def apercu_passage(db: Database, annee: Annee) -> dict:
    """Ce que fera le passage, à montrer avant de demander la confirmation."""
    lignes = propositions(db, annee)
    non_valides = [e["classe"] for e in etat(db, annee) if e["effectif"] and not e["complete"]]
    monte = [r for r in lignes if r["decision"] == "ADMIS" and r["classe_suivante"]]
    par_classe: dict[str, dict] = {}
    for r in lignes:
        if r["decision"] == "ADMIS" and r["classe_suivante"]:
            cible = r["classe_suivante"]
        elif r["decision"] == "REDOUBLE":
            cible = r["classe"]
        else:
            continue
        d = par_classe.setdefault(cible, {"admis": 0, "redoublants": 0})
        d["redoublants" if r["decision"] == "REDOUBLE" else "admis"] += 1
    return {
        "annee": annee.libelle, "annee_suivante": libelle_suivant(annee),
        "existe_deja": bool(db.scalar("SELECT 1 FROM annee_scolaire WHERE libelle=?", (libelle_suivant(annee),))),
        "cloturee": annee.cloturee, "classes_non_validees": non_valides, "pret": not non_valides and not annee.cloturee,
        "montent": len(monte),
        "redoublent": sum(1 for r in lignes if r["decision"] == "REDOUBLE"),
        "sortants": sum(1 for r in lignes if r["decision"] == "ADMIS" and not r["classe_suivante"]),
        "partants": {k: sum(1 for r in lignes if r["decision"] == k) for k in PARTANTS},
        "effectifs_suivants": {c: par_classe.get(c, {"admis": 0, "redoublants": 0}) for c in annee.codes},
    }


def passer_annee_suivante(db: Database, s: Session, annee: Annee) -> dict:
    """Clôture l'année après validation complète : sauvegarde, création de l'année suivante (même
    structure), réinscription selon les décisions validées, archivage de l'année en lecture seule.
    Tout ou rien : en cas d'erreur, la base reste dans son état d'avant (et la sauvegarde existe)."""
    from epp.core import backup, seed
    from epp.domain import repo
    s.require("fin_annee.valider")
    s.require("eleves.modifier")
    ap = apercu_passage(db, annee)
    if annee.cloturee:
        raise ValidationError(f"L'année {annee.libelle} est déjà clôturée.")
    if ap["classes_non_validees"]:
        raise ValidationError("Validez d'abord les décisions de fin d'année de : "
                              + ", ".join(ap["classes_non_validees"]) + ".")
    suivant = ap["annee_suivante"]
    sauvegarde = backup.sauvegarde_auto(db, f"avant passage {annee.libelle} vers {suivant}", login=s.login)
    with db.transaction():
        aid = db.scalar("SELECT id FROM annee_scolaire WHERE libelle=?", (suivant,))
        if aid is None:
            aid = seed.create_year(db, suivant, copy_from=annee.id, active=False)
        dst = repo.load_annee(db, aid)
        if dst.cloturee:
            raise ValidationError(f"L'année {suivant} est clôturée.")
        bilan = repo.reinscrire(db, s, annee, dst, exiger_validation=True)
        db.execute("UPDATE annee_scolaire SET cloturee=1, active=0 WHERE id=?", (annee.id,))
        db.execute("UPDATE annee_scolaire SET active=0 WHERE id<>?", (aid,))
        db.execute("UPDATE annee_scolaire SET active=1 WHERE id=?", (aid,))
    log(db, s.login, "PASSAGE_ANNEE", f"{annee.libelle} -> {suivant}",
        f"{bilan} ; sauvegarde {sauvegarde.name}")
    return {**bilan, "annee_suivante": suivant, "annee_suivante_id": aid, "sauvegarde": sauvegarde}


def rouvrir_annee(db: Database, s: Session, annee: Annee) -> None:
    """Rouvre une année clôturée pour corriger une erreur (administrateur). Les élèves déjà
    réinscrits dans l'année suivante n'en sont pas retirés."""
    s.require("parametres.modifier")
    s.require("fin_annee.valider")
    db.execute("UPDATE annee_scolaire SET cloturee=0 WHERE id=?", (annee.id,))
    log(db, s.login, "ANNEE_ROUVERTE", annee.libelle, "")
