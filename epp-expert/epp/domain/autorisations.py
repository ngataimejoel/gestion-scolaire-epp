"""Demandes d'autorisation d'absence (personnel et élèves).

- La fiche se remplit à partir du matricule ou d'une recherche (nom, classe, fonction) : identité,
  fonction ou classe, enseignant, parent et téléphone sont repris automatiquement et restent modifiables.
- Une demande accordée est reportée automatiquement dans le volet Absences : une ligne par mois
  concerné (jours ouvrés du lundi au vendredi), avec le motif, « justifié » et le numéro de
  l'autorisation. Modifier ou refuser la demande met ces absences à jour ; la supprimer les retire.
- La fiche s'imprime (PDF, Word ou Excel) par son numéro, le matricule ou une recherche.
"""
from __future__ import annotations

from datetime import date

from epp.core.db import Database
from epp.core.security import Session, log
from epp.domain import calculs, calendrier, repo
from epp.domain.repo import Annee, ValidationError

STATUTS = {"EN_ATTENTE": "En attente", "ACCORDEE": "Accordée", "REFUSEE": "Refusée"}
DEMI = {"MATIN": "Matinée", "APRES_MIDI": "Après-midi"}
JOURS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


# =================================================================== recherche de la personne
def _personnel_fiche(p: dict) -> dict:
    return {"kind": "personnel", "personnel_id": p["id"], "matricule": p["matricule"], "nom": p["nom"],
            "sexe": p.get("sexe"), "fonction": p.get("fonction") or "", "grade": p.get("grade") or "",
            "classe": p.get("classe_tenue") if p.get("classe_tenue") not in (None, "-") else "",
            "telephone": p.get("telephone") or ""}


def _eleve_fiche(db: Database, annee: Annee, r: dict) -> dict:
    parent, tel = "", ""
    for qui in ("tuteur", "pere", "mere"):
        if r.get(f"{qui}_nom"):
            parent, tel = r[f"{qui}_nom"], r.get(f"{qui}_tel") or ""
            break
    ens = db.scalar("SELECT p.nom FROM affectation a JOIN personnel p ON p.id=a.personnel_id "
                    "WHERE a.annee_id=? AND a.classe_code=? ORDER BY p.ordre LIMIT 1", (annee.id, r["classe"]))
    return {"kind": "eleve", "inscription_id": r["inscription_id"], "matricule": r["matricule_ecole"],
            "nom": r["nom"], "sexe": r.get("sexe"), "classe": r["classe"], "enseignant": ens or "",
            "demandeur": parent, "telephone": tel}


def personnes(db: Database, annee: Annee, recherche: str, kind: str | None = None) -> list[dict]:
    """Personnes correspondant à un matricule (exact d'abord) ou à une recherche : sert à préremplir la fiche."""
    q = (recherche or "").strip()
    if not q:
        return []
    out = []
    if kind in (None, "personnel"):
        tous = repo.personnel(db, annee)
        exact = [p for p in tous if (p["matricule"] or "").upper() == q.upper()]
        trouves = exact or repo.personnel(db, annee, recherche=q)
        out += [_personnel_fiche(p) for p in trouves]
    if kind in (None, "eleve"):
        tous = repo.inscriptions(db, annee)
        exact = [r for r in tous if r["matricule_ecole"].upper() == q.upper()
                 or (r.get("matricule_desps") or "").upper() == q.upper()]
        trouves = exact or repo.inscriptions(db, annee, recherche=q) or [r for r in tous if r["classe"] == q.upper()]
        out += [_eleve_fiche(db, annee, r) for r in trouves]
    return out


def preremplir(db: Database, annee: Annee, recherche: str, kind: str | None = None) -> dict:
    """Champs de la fiche pour une seule personne trouvée ; erreur claire sinon."""
    trouves = personnes(db, annee, recherche, kind)
    if not trouves:
        raise ValidationError(f"Aucun élève ni agent ne correspond à « {recherche} ».", "recherche")
    if len(trouves) > 1:
        noms = ", ".join(f"{t['nom']} ({t['matricule']})" for t in trouves[:5])
        raise ValidationError(f"{len(trouves)} personnes correspondent : {noms}… Précisez le matricule.",
                              "recherche")
    return trouves[0]


# =================================================================== jours et absences
def jours_ouvres(debut: date, fin: date, exclus: set[date] | None = None) -> list[date]:
    """Jours de classe de la période : lundi à vendredi, hors jours fériés et vacances (exclus)."""
    return calendrier.jours_de_classe(debut, fin, exclus)


def _segments(debut: date, fin: date, demi: str | None, exclus: set[date] | None = None) -> list[tuple[date, float, date]]:
    """[(premier jour, nombre de jours, dernier jour)] par mois : une ligne d'absence par mois concerné,
    pour que chaque rapport mensuel compte ses propres jours."""
    if demi:
        return [(debut, 0.5, debut)]
    par_mois: dict[tuple[int, int], list[date]] = {}
    for d in jours_ouvres(debut, fin, exclus):
        par_mois.setdefault((d.year, d.month), []).append(d)
    return [(js[0], float(len(js)), js[-1]) for _, js in sorted(par_mois.items())]


def _valider(db: Database, annee: Annee, data: dict, aid: int | None) -> dict:
    kind = data.get("kind")
    if kind not in ("eleve", "personnel"):
        raise ValidationError("Choisissez un élève ou un agent.", "kind")
    cible = data.get("inscription_id" if kind == "eleve" else "personnel_id")
    if not cible:
        raise ValidationError("Choisissez " + ("l'élève." if kind == "eleve" else "l'agent."), "matricule")
    if kind == "eleve" and not db.scalar("SELECT 1 FROM inscription WHERE id=? AND annee_id=?", (cible, annee.id)):
        raise ValidationError("Cet élève n'est pas inscrit pour l'année en cours.", "matricule")
    if kind == "personnel" and not db.scalar("SELECT 1 FROM personnel WHERE id=?", (cible,)):
        raise ValidationError("Agent inconnu.", "matricule")
    d1, d2 = calculs.to_date(data.get("date_debut")), calculs.to_date(data.get("date_fin") or data.get("date_debut"))
    if d1 is None:
        raise ValidationError("Indiquez la date de début de l'absence.", "date_debut")
    if d2 is None or d2 < d1:
        raise ValidationError("La date de fin doit être postérieure ou égale à la date de début.", "date_fin")
    a1, a2 = calculs.to_date(annee.date_debut), calculs.to_date(annee.date_fin)
    if a1 and a2 and not (a1 <= d1 and d2 <= a2):
        raise ValidationError(f"La période doit être comprise dans l'année scolaire {annee.libelle}.", "date_debut")
    demi = data.get("demi_journee") or None
    if demi and demi not in DEMI:
        raise ValidationError("Demi-journée : MATIN ou APRES_MIDI.", "demi_journee")
    if demi and d1 != d2:
        raise ValidationError("Une demi-journée ne concerne qu'un seul jour.", "demi_journee")
    exclus = calendrier.jours_sans_classe(db, annee)
    if demi and (d1.weekday() >= 5 or d1 in exclus):
        raise ValidationError("Ce jour n'est pas un jour de classe (week-end, jour férié ou vacances).", "date_debut")
    jours = 0.5 if demi else float(len(jours_ouvres(d1, d2, exclus)))
    if jours == 0:
        raise ValidationError("La période ne contient aucun jour de classe (week-end, jours fériés ou vacances).",
                              "date_debut")
    motif = (data.get("motif") or "").strip()
    if not motif:
        raise ValidationError("Le motif est obligatoire.", "motif")
    dd = calculs.to_date(data.get("date_demande")) or date.today()
    statut = data.get("statut") or "EN_ATTENTE"
    if statut not in STATUTS:
        raise ValidationError("Statut : EN_ATTENTE, ACCORDEE ou REFUSEE.", "statut")
    fk = "inscription_id" if kind == "eleve" else "personnel_id"
    chevauche = db.one(f"SELECT numero, date_debut, date_fin FROM autorisation_absence WHERE {fk}=? AND annee_id=? "
                       "AND statut<>'REFUSEE' AND id<>? AND date_debut<=? AND date_fin>=?",
                       (cible, annee.id, aid or 0, d2.isoformat(), d1.isoformat()))
    if chevauche:
        raise ValidationError(f"Une autre demande ({chevauche['numero']}) couvre déjà une partie de cette période "
                              f"(du {calculs.to_date(chevauche['date_debut']):%d/%m/%Y} au "
                              f"{calculs.to_date(chevauche['date_fin']):%d/%m/%Y}).", "date_debut")

    def txt(k):
        v = data.get(k)
        return str(v).strip() or None if v not in (None, "") else None
    return {"kind": kind, "personnel_id": cible if kind == "personnel" else None,
            "inscription_id": cible if kind == "eleve" else None, "date_demande": dd.isoformat(),
            "date_debut": d1.isoformat(), "date_fin": d2.isoformat(), "demi_journee": demi, "jours": jours,
            "motif": motif, "precisions": txt("precisions"), "lieu": txt("lieu"), "contact": txt("contact"),
            "interim": txt("interim"), "demandeur": txt("demandeur"), "statut": statut, "avis": txt("avis")}


def _numero(db: Database, annee: Annee) -> str:
    n = 0
    for (num,) in db.query("SELECT numero FROM autorisation_absence WHERE annee_id=?", (annee.id,)):
        tail = num.rsplit("-", 1)[-1]
        if tail.isdigit():
            n = max(n, int(tail))
    return f"AA-{annee.an_debut()}-{n + 1:03d}"


def _reporter_absences(db: Database, annee: Annee, aid: int) -> None:
    """Recrée les absences liées à l'autorisation (aucune si elle n'est pas accordée)."""
    a = db.one("SELECT * FROM autorisation_absence WHERE id=?", (aid,))
    table, fk = ("absence_eleve", "inscription_id") if a["kind"] == "eleve" else ("absence_personnel",
                                                                                  "personnel_id")
    db.execute(f"DELETE FROM {table} WHERE autorisation_id=?", (aid,))
    if a["statut"] != "ACCORDEE":
        return
    d1, d2 = calculs.to_date(a["date_debut"]), calculs.to_date(a["date_fin"])
    for premier, jours, dernier in _segments(d1, d2, a["demi_journee"], calendrier.jours_sans_classe(db, annee)):
        obs = f"Autorisation n° {a['numero']}"
        obs += f" ({DEMI[a['demi_journee']].lower()} du {premier:%d/%m/%Y})" if a["demi_journee"] else \
            (f" (le {premier:%d/%m/%Y})" if premier == dernier else f" (du {premier:%d/%m/%Y} au {dernier:%d/%m/%Y})")
        if a["precisions"]:
            obs += f" – {a['precisions']}"
        db.execute(f"INSERT INTO {table}(annee_id, {fk}, date, nature, jours, motif, justifie, observations, "
                   "autorisation_id) VALUES(?,?,?,?,?,?,?,?,?)",
                   (annee.id, a[fk], premier.isoformat(), "ABSENCE", jours, a["motif"], "OUI", obs[:250], aid))


def recalculer(db: Database, annee: Annee) -> int:
    """Après une modification du calendrier (jour férié, vacances) : durée et absences des demandes
    mises à jour. Renvoie le nombre de demandes recalculées."""
    exclus = calendrier.jours_sans_classe(db, annee)
    n = 0
    with db.transaction():
        for a in db.query("SELECT * FROM autorisation_absence WHERE annee_id=?", (annee.id,)):
            d1, d2 = calculs.to_date(a["date_debut"]), calculs.to_date(a["date_fin"])
            jours = 0.5 if a["demi_journee"] else float(len(jours_ouvres(d1, d2, exclus)))
            if jours != a["jours"]:
                db.execute("UPDATE autorisation_absence SET jours=? WHERE id=?", (jours, a["id"]))
                n += 1
            _reporter_absences(db, annee, a["id"])
    return n


# =================================================================== enregistrement
def enregistrer(db: Database, s: Session, annee: Annee, aid: int | None, data: dict) -> int:
    """Crée ou modifie une demande. Accorder ou refuser demande le droit absences.autoriser ; sans ce droit,
    la demande est enregistrée « en attente »."""
    s.require("absences.modifier")
    d = _valider(db, annee, data, aid)
    ancien = db.one("SELECT * FROM autorisation_absence WHERE id=?", (aid,)) if aid else None
    if aid and ancien is None:
        raise ValidationError("Demande introuvable.")
    if not s.can("absences.autoriser"):
        if ancien and ancien["statut"] != "EN_ATTENTE":
            raise ValidationError("Cette demande a déjà été traitée : seul le directeur peut la modifier.")
        d["statut"], d["avis"] = "EN_ATTENTE", None
    decide = d["statut"] != "EN_ATTENTE" and (not ancien or ancien["statut"] != d["statut"])
    cols = list(d)
    with db.transaction():
        if aid:
            db.execute(f"UPDATE autorisation_absence SET {', '.join(c + '=?' for c in cols)} WHERE id=?",
                       (*[d[c] for c in cols], aid))
        else:
            d["numero"] = _numero(db, annee)
            d["cree_par"] = s.login
            cols = list(d)
            aid = db.execute(f"INSERT INTO autorisation_absence(annee_id, {', '.join(cols)}) "
                             f"VALUES(?, {', '.join('?' * len(cols))})", (annee.id, *[d[c] for c in cols])).lastrowid
        if decide:
            db.execute("UPDATE autorisation_absence SET decide_par=?, decide_le=datetime('now','localtime') "
                       "WHERE id=?", (s.login, aid))
        elif d["statut"] == "EN_ATTENTE":
            db.execute("UPDATE autorisation_absence SET decide_par=NULL, decide_le=NULL WHERE id=?", (aid,))
        _reporter_absences(db, annee, aid)
    num = db.scalar("SELECT numero FROM autorisation_absence WHERE id=?", (aid,))
    log(db, s.login, "AUTORISATION_ABSENCE", num, f"{d['statut']} {d['date_debut']} → {d['date_fin']}")
    return aid


def decider(db: Database, s: Session, annee: Annee, aid: int, statut: str, avis: str | None = None) -> None:
    """Le directeur accorde ou refuse la demande ; les absences suivent automatiquement."""
    s.require("absences.autoriser")
    a = get(db, aid)
    a.update(statut=statut, avis=avis if avis is not None else a.get("avis"))
    enregistrer(db, s, annee, aid, a)


def supprimer(db: Database, s: Session, aid: int) -> None:
    """Supprime la demande et les absences qu'elle avait créées."""
    s.require("absences.modifier")
    a = db.one("SELECT numero, statut FROM autorisation_absence WHERE id=?", (aid,))
    if a is None:
        return
    if a["statut"] != "EN_ATTENTE":
        s.require("absences.autoriser")
    db.execute("DELETE FROM autorisation_absence WHERE id=?", (aid,))
    log(db, s.login, "SUPPRESSION_AUTORISATION", a["numero"], a["statut"])


def get(db: Database, aid: int) -> dict:
    r = db.one("SELECT * FROM autorisation_absence WHERE id=?", (aid,))
    if r is None:
        raise ValidationError("Demande introuvable.")
    return dict(r)


# =================================================================== consultation
def lister(db: Database, annee: Annee, recherche: str | None = None, kind: str | None = None,
           statut: str | None = None) -> list[dict]:
    """Demandes de l'année avec la personne concernée ; recherche sur le numéro, le matricule, le nom,
    la classe ou la fonction, le motif, une date (jj/mm/aaaa) ou le statut."""
    rows = db.query(
        "SELECT a.*, COALESCE(p.matricule, i.matricule_ecole) AS matricule, COALESCE(p.nom, e.nom) AS nom, "
        "COALESCE(p.sexe, e.sexe) AS sexe, c.code AS classe_eleve, p.fonction, p.grade, p.telephone AS tel_agent, "
        "af.classe_code AS classe_agent "
        "FROM autorisation_absence a LEFT JOIN personnel p ON p.id=a.personnel_id "
        "LEFT JOIN inscription i ON i.id=a.inscription_id LEFT JOIN eleve e ON e.id=i.eleve_id "
        "LEFT JOIN classe c ON c.id=i.classe_id "
        "LEFT JOIN affectation af ON af.personnel_id=p.id AND af.annee_id=a.annee_id "
        "WHERE a.annee_id=? ORDER BY a.date_debut, a.id", (annee.id,))
    out = []
    q = (recherche or "").strip().lower()
    for n, r in enumerate(rows, start=1):
        d = dict(r)
        d["classe"] = d.pop("classe_eleve") or d.pop("classe_agent") or ""
        d.pop("classe_agent", None)
        d["categorie"] = "Élève" if d["kind"] == "eleve" else "Personnel"
        d["statut_libelle"] = STATUTS[d["statut"]]
        d["periode"] = _periode(d)
        if kind and d["kind"] != kind:
            continue
        if statut and d["statut"] != statut:
            continue
        if q:
            dates = " ".join(calculs.to_date(d[k]).strftime("%d/%m/%Y") for k in ("date_debut", "date_fin",
                                                                                  "date_demande"))
            meule = " ".join(str(d.get(k) or "") for k in ("numero", "matricule", "nom", "classe", "fonction",
                                                           "motif", "precisions", "statut_libelle", "demandeur", "lieu",
                                                           "interim", "avis"))
            if q not in (meule + " " + dates).lower():
                continue
        out.append(d)
    for i, d in enumerate(out, start=1):
        d["numero_ligne"] = i
    return out


def _periode(a: dict) -> str:
    d1, d2 = calculs.to_date(a["date_debut"]), calculs.to_date(a["date_fin"])
    if a.get("demi_journee"):
        return f"le {JOURS_FR[d1.weekday()]} {d1:%d/%m/%Y} ({DEMI[a['demi_journee']].lower()})"
    if d1 == d2:
        return f"le {JOURS_FR[d1.weekday()]} {d1:%d/%m/%Y}"
    return f"du {JOURS_FR[d1.weekday()]} {d1:%d/%m/%Y} au {JOURS_FR[d2.weekday()]} {d2:%d/%m/%Y}"


def trouver(db: Database, annee: Annee, ref) -> list[dict]:
    """Demandes à imprimer : identifiant, numéro (AA-2026-001), matricule ou recherche libre."""
    tous = lister(db, annee)
    if isinstance(ref, int) or (isinstance(ref, str) and ref.isdigit()):
        return [a for a in tous if a["id"] == int(ref)]
    r = str(ref or "").strip()
    for cle in ("numero", "matricule"):
        exact = [a for a in tous if str(a.get(cle) or "").upper() == r.upper()]
        if exact:
            return exact
    return lister(db, annee, recherche=r)


# =================================================================== fiche imprimable
def document(db: Database, annee: Annee, demandes: list[dict]):
    """Fiche(s) de demande d'autorisation d'absence (une page par demande), pour PDF, Word ou Excel."""
    from epp.reports import engine as E
    v = E.variables(db, annee, {})
    etab = repo.etablissement(db)
    doc = E.Document("Demande d'autorisation d'absence", "DEMANDE D'AUTORISATION D'ABSENCE", "", "portrait",
                     {"officiel": False, "logo": True, "texte": ""}, etab,
                     {"texte": "{ecole} – {annee}", "numerotation": True, "date_edition": True}, variables=v)
    for k, a in enumerate(demandes):
        if k:
            doc.blocks.append(E.PageBreak())
        doc.blocks += _fiche(db, annee, a, v, E)
    return doc


def _j(x) -> str:
    return f"{float(x):g}".replace(".", ",")


def _table(E, titre_bloc: str, lignes: list[tuple[str, str]]):
    rows = [E.Row([lab, val or "–"]) for lab, val in lignes]
    return E.Table("", [[E.HeaderCell(titre_bloc, colspan=2)]], rows, ["texte", "texte"], ["gauche", "gauche"],
                   [62, 132], first_col_header=True)   # A4 portrait : 194 mm utiles


def _fiche(db, annee, a: dict, v: dict, E) -> list:
    eleve = a["kind"] == "eleve"
    dd = calculs.to_date(a["date_demande"])
    blocs = [E.EnteteOfficiel(),
             ("TITRE", "DEMANDE D'AUTORISATION D'ABSENCE",
              f"N° {a['numero']} – {'Élève' if eleve else 'Personnel'} – Année scolaire {annee.libelle}")]
    if eleve:
        ins = db.one("SELECT i.*, e.* FROM inscription i JOIN eleve e ON e.id=i.eleve_id WHERE i.id=?",
                     (a["inscription_id"],))
        fiche = _eleve_fiche(db, annee, {**dict(ins), "inscription_id": a["inscription_id"],
                                         "classe": a["classe"]}) if ins else {}
        demandeur = a.get("demandeur") or fiche.get("demandeur") or ""
        blocs.append(_table(E, "ÉLÈVE CONCERNÉ", [
            ("Nom et prénoms", a["nom"]), ("Matricule école", a["matricule"]), ("Classe", a["classe"]),
            ("Enseignant(e)", fiche.get("enseignant", "")),
            ("Parent / tuteur demandeur", demandeur), ("Téléphone", a.get("contact") or fiche.get("telephone", ""))]))
        phrase = (f"Je soussigné(e) {demandeur or '……………………………'}, parent / tuteur de l'élève {a['nom']} "
                  f"({a['classe']}), sollicite pour mon enfant une autorisation d'absence {a['periode']}, "
                  f"soit {_j(a['jours'])} jour(s) de classe, pour le motif suivant : "
                  f"{a['motif']}{' – ' + a['precisions'] if a.get('precisions') else ''}.")
    else:
        blocs.append(_table(E, "IDENTITÉ DE L'AGENT", [
            ("Nom et prénoms", a["nom"]), ("Matricule", a["matricule"]), ("Fonction", a.get("fonction")),
            ("Grade / emploi", a.get("grade")), ("Classe tenue", a["classe"]),
            ("Établissement", v.get("ecole")), ("Téléphone", a.get("contact") or a.get("tel_agent"))]))
        phrase = (f"Je soussigné(e) {a['nom']}, {a.get('fonction') or 'agent'} à l'{v.get('ecole', '')}, "
                  f"sollicite une autorisation d'absence {a['periode']}, soit "
                  f"{_j(a['jours'])} jour(s) de classe, pour le motif suivant : "
                  f"{a['motif']}{' – ' + a['precisions'] if a.get('precisions') else ''}.")
    objet = [("Date de la demande", f"{dd:%d/%m/%Y}"), ("Période d'absence", a["periode"]),
             ("Nombre de jours de classe", _j(a["jours"])),
             ("Motif", a["motif"]), ("Précisions", a.get("precisions")),
             ("Lieu pendant l'absence", a.get("lieu"))]
    if not eleve:
        objet.append(("Intérim / suppléance assuré(e) par", a.get("interim")))
    blocs += [_table(E, "OBJET DE LA DEMANDE", objet), E.Paragraph(phrase, "encadre"),
              E.Signature(f"Fait à {v.get('localite', '')}, le {dd:%d/%m/%Y}",
                          "LE PARENT / TUTEUR" if eleve else "L'INTÉRESSÉ(E)", "" if eleve else a["nom"])]
    coche = {s: "[X]" if a["statut"] == s else "[  ]" for s in STATUTS}
    decision = (f"{coche['ACCORDEE']} Accordée      {coche['REFUSEE']} Refusée      "
                f"{coche['EN_ATTENTE']} En attente de décision")
    if a.get("decide_le"):
        decision += f"      (décision du {calculs.to_date(a['decide_le'][:10]):%d/%m/%Y})"
    blocs += [E.Paragraph("DÉCISION DU DIRECTEUR", "titre2"), E.Paragraph(decision),
              E.TextZone("Avis et observations du directeur :", a.get("avis") or "", 3),
              E.Signature("", "LE DIRECTEUR", v.get("directeur", ""))]
    if not eleve:
        blocs += [E.TextZone("Avis de l'Inspecteur de l'Enseignement Préscolaire et Primaire (IEPP) :", "", 3)]
    if a["statut"] == "ACCORDEE":
        blocs.append(E.Paragraph(f"Absence reportée automatiquement dans le registre des absences "
                                 f"({_j(a['jours'])} jour(s), motif « {a['motif']} », "
                                 f"justifiée).", "note"))
    return blocs


def imprimer(db: Database, s: Session, annee: Annee, ref, chemin, format_: str | None = None):
    """Imprime la ou les fiches retrouvées par numéro, matricule ou recherche (une page par demande)."""
    from pathlib import Path

    from epp.reports import service
    demandes = trouver(db, annee, ref)
    if not demandes:
        raise ValidationError(f"Aucune demande d'autorisation ne correspond à « {ref} ».")
    chemin = Path(chemin)
    f = service._format(format_, chemin)
    service._droits_format(s, f)
    out = service._ecrire(document(db, annee, demandes), f, chemin, "Autorisation")
    log(db, s.login, "IMPRESSION_AUTORISATION", ", ".join(a["numero"] for a in demandes), str(out))
    return out
