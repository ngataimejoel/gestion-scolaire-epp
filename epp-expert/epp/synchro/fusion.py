"""Envoi sur l'ordinateur des données d'un téléphone utilisé seul (sans ordinateur) jusque-là.

Le téléphone envoie sa base complète (même forme que l'instantané : classes, grilles, élèves, notes, absences,
personnel). L'ordinateur l'ajoute à l'année active sans jamais écraser ce qu'il contient déjà :
- classes reconnues par leur code (créées si besoin, avec la grille de même code) ;
- élèves reconnus par leur matricule DESPS, sinon par leur nom et leur date de naissance ; les autres sont
  inscrits ;
- notes rattachées à la matière de même évaluation et de même libellé ; une note déjà saisie sur l'ordinateur
  avec une autre valeur n'est pas remplacée : elle est signalée (« différences ») ;
- absences ajoutées sauf si la même personne a déjà une absence ce jour-là ;
- personnel reconnu par son matricule, sinon par son nom.
L'envoi peut être refait sans créer de doublons. Il demande le mot de passe d'un administrateur de
l'ordinateur, et les droits du compte associé au téléphone (élèves, notes, absences, personnel, paramètres pour
créer une classe).
"""
from __future__ import annotations

from epp.core import security
from epp.core.db import AnneeCloturee, Database
from epp.core.security import AccessDenied, Session
from epp.domain import repo
from epp.domain.referentiels import norm
from epp.domain.repo import ValidationError
from epp.synchro.donnees import trouver_inscription


def _f(v):
    return None if v in (None, "") else float(v)


class Fusion:
    def __init__(self, db: Database, s: Session, appareil: dict):
        self.db, self.s, self.appareil = db, s, appareil
        self.r = {"classes_creees": 0, "eleves_ajoutes": 0, "eleves_reconnus": 0, "notes_ajoutees": 0,
                  "notes_identiques": 0, "absences_ajoutees": 0, "absences_existantes": 0, "personnel_ajoute": 0,
                  "personnel_reconnu": 0, "differences": [], "erreurs": []}

    def _erreur(self, quoi: str, e: Exception) -> None:
        if len(self.r["erreurs"]) < 200:
            self.r["erreurs"].append(f"{quoi} : {e}")

    def appliquer(self, base: dict) -> dict:
        aid = repo.active_annee_id(self.db)
        if not aid:
            raise ValidationError("Aucune année scolaire active sur l'ordinateur.")
        annee = repo.load_annee(self.db, aid)
        if annee.cloturee:
            raise AnneeCloturee()
        lib = (base.get("annee") or {}).get("libelle")
        if lib != annee.libelle:
            raise ValidationError(f"Le téléphone contient l'année {lib or '?'} et l'ordinateur l'année {annee.libelle} : "
                                  "créez ou activez la même année scolaire avant d'envoyer les données.")
        annee = self._classes(base, annee)
        ins = self._eleves(base, annee)
        self._notes(base, annee, ins)
        agents = self._personnel(base, annee)
        self._absences(base, annee, ins, agents)
        security.log(self.db, self.s.login, "FUSION_TELEPHONE", "appareil",
                     f"« {self.appareil['nom']} » : {self.r['eleves_ajoutes']} élève(s), {self.r['notes_ajoutees']} "
                     f"note(s), {self.r['absences_ajoutees']} absence(s) ajoutés ; "
                     f"{len(self.r['differences'])} différence(s)")
        return self.r

    # ------------------------------------------------------------------ classes
    def _classes(self, base: dict, annee):
        grilles_tel = {g["id"]: g for g in base.get("grilles") or []}
        grille_par_code = {g.code: g.id for g in annee.grilles.values()}
        for c in base.get("classes") or []:
            code = str(c.get("code") or "").strip().upper()
            if not code or annee.classe(code):
                continue
            g = grilles_tel.get(c.get("grille_id")) or {}
            try:
                with self.db.transaction():
                    repo.save_classe(self.db, self.s, None, annee.id, {
                        "code": code, "libelle": c.get("libelle") or code, "ordre": c.get("ordre") or 0,
                        "niveau_suivant": c.get("niveau_suivant"), "seuil": c.get("seuil", 5),
                        "bareme": c.get("bareme", 10), "grille_id": grille_par_code.get(g.get("code")),
                        "calendrier": c.get("calendrier") or "STD", "regle_mga": c.get("regle_mga") or "STANDARD"})
                self.r["classes_creees"] += 1
            except (AccessDenied, ValidationError, ValueError) as e:
                self._erreur(f"Classe {code}", e)
        return repo.load_annee(self.db, annee.id)

    # ------------------------------------------------------------------ élèves
    def _eleves(self, base: dict, annee) -> dict:
        """{inscription du téléphone: inscription de l'ordinateur}"""
        out = {}
        for e in base.get("eleves") or []:
            champs = {k: e.get(k) for k in repo.ELEVE_CHAMPS if k in e}
            existant = trouver_inscription(self.db, annee, champs)
            if existant:
                out[str(e.get("inscription_id"))] = existant
                self.r["eleves_reconnus"] += 1
                continue
            classe = annee.classe(str(e.get("classe") or ""))
            if classe is None:
                self._erreur(e.get("nom") or "Élève", ValidationError(f"classe {e.get('classe')} absente de l'ordinateur"))
                continue
            try:
                with self.db.transaction():
                    m = str(champs.get("matricule_desps") or "").replace(" ", "")
                    eid = self.db.scalar("SELECT id FROM eleve WHERE matricule_desps=?", (m,)) if m else None
                    type_ = "REINSCRIPTION" if eid else "INSCRIPTION"
                    if not eid:
                        eid = repo.save_eleve(self.db, self.s, None, champs, annee)
                    mat = e.get("matricule_ecole")
                    if not mat or self.db.scalar("SELECT 1 FROM inscription WHERE annee_id=? AND matricule_ecole=?",
                                                 (annee.id, mat)):
                        mat = None
                    iid = repo.inscrire(self.db, self.s, eid, annee, classe.code, redoublant=e.get("redoublant") or "NON",
                                        statut=e.get("statut") or "PRESENT", type_=type_, matricule=mat)
                out[str(e.get("inscription_id"))] = iid
                self.r["eleves_ajoutes"] += 1
            except (AccessDenied, ValidationError, ValueError) as ex:
                self._erreur(e.get("nom") or "Élève", ex)
        return out

    # ------------------------------------------------------------------ notes et présences
    def _notes(self, base: dict, annee, ins: dict) -> None:
        if not self.s.can("notes.modifier"):
            if base.get("notes"):
                self._erreur("Notes", AccessDenied("le compte du téléphone ne permet pas de saisir les notes"))
            return
        mat_tel = {}            # matière du téléphone -> (évaluation, libellé normalisé)
        for g in base.get("grilles") or []:
            for num, ms in (g.get("matieres") or {}).items():
                for m in ms:
                    mat_tel[str(m["id"])] = (int(num), norm(m["libelle"]), m["libelle"])
        noms = {str(e.get("inscription_id")): e.get("nom") for e in base.get("eleves") or []}
        grille_ins = {}

        def matieres_ordi(iid: int) -> dict:
            if iid not in grille_ins:
                gid = self.db.scalar("SELECT c.grille_id FROM inscription i JOIN classe c ON c.id=i.classe_id "
                                     "WHERE i.id=?", (iid,))
                grille_ins[iid] = {(m["eval_num"], norm(m["libelle"])): m["id"] for m in self.db.query(
                    "SELECT id, eval_num, libelle FROM matiere WHERE grille_id=?", (gid,))} if gid else {}
            return grille_ins[iid]

        for itel, nums in (base.get("absents_evaluation") or {}).items():
            iid = ins.get(str(itel))
            if not iid:
                continue
            for num in nums:
                deja = self.db.scalar("SELECT COUNT(*) FROM note n JOIN matiere m ON m.id=n.matiere_id "
                                      "WHERE n.inscription_id=? AND m.eval_num=?", (iid, int(num)), 0)
                if deja:
                    self._difference(noms.get(str(itel)), f"évaluation {num}", "absent", "notes saisies")
                    continue
                with self.db.transaction():
                    repo.set_presence(self.db, self.s, iid, int(num), False)
        for itel, notes in (base.get("notes") or {}).items():
            iid = ins.get(str(itel))
            if not iid:
                continue
            for mtel, valeur in notes.items():
                cle = mat_tel.get(str(mtel))
                mid = matieres_ordi(iid).get(cle[:2]) if cle else None
                if not mid:
                    self._erreur(f"Note de {noms.get(str(itel))}", ValidationError(
                        f"matière « {cle[2] if cle else mtel} » absente de la grille de l'ordinateur"))
                    continue
                actuelle = self.db.scalar("SELECT valeur FROM note WHERE inscription_id=? AND matiere_id=?", (iid, mid))
                if actuelle is not None:
                    if abs(actuelle - float(valeur)) < 1e-9:
                        self.r["notes_identiques"] += 1
                    else:
                        self._difference(noms.get(str(itel)), cle[2], f"{float(valeur):g}", f"{actuelle:g}")
                    continue
                try:
                    with self.db.transaction():
                        repo.set_note(self.db, self.s, annee, iid, mid, valeur)
                    self.r["notes_ajoutees"] += 1
                except (ValidationError, ValueError) as e:
                    self._erreur(f"Note de {noms.get(str(itel))} en {cle[2]}", e)

    def _difference(self, nom, quoi, telephone, ordinateur) -> None:
        if len(self.r["differences"]) < 500:
            self.r["differences"].append({"eleve": nom or "?", "quoi": quoi, "telephone": telephone,
                                          "ordinateur": ordinateur})

    # ------------------------------------------------------------------ personnel
    def _personnel(self, base: dict, annee) -> dict:
        out = {}
        existants = repo.personnel(self.db, annee, actifs=False)
        for p in base.get("personnel") or []:
            mat, nom = str(p.get("matricule") or "").strip(), norm(p.get("nom"))
            trouve = next((x["id"] for x in existants if mat and x["matricule"] == mat), None) \
                or next((x["id"] for x in existants if nom and norm(x["nom"]) == nom), None)
            if trouve:
                out[str(p.get("id"))] = trouve
                self.r["personnel_reconnu"] += 1
                continue
            try:
                data = {k: p.get(k) for k in repo.PERSONNEL_CHAMPS}
                if p.get("classe_tenue") and p["classe_tenue"] != "-" and annee.classe(p["classe_tenue"]):
                    data["classe_tenue"] = p["classe_tenue"]
                out[str(p.get("id"))] = repo.save_personnel(self.db, self.s, None, data, annee)
                self.r["personnel_ajoute"] += 1
            except (AccessDenied, ValidationError, ValueError) as e:
                self._erreur(f"Agent {p.get('nom')}", e)
        return out

    # ------------------------------------------------------------------ absences
    def _absences(self, base: dict, annee, ins: dict, agents: dict) -> None:
        listes = (("eleve", "absences_eleves", "inscription_id", ins, "absence_eleve"),
                  ("personnel", "absences_personnel", "personnel_id", agents, "absence_personnel"))
        for kind, cle, ref, table_ids, table in listes:
            lignes = base.get(cle) or []
            if lignes and not self.s.can("absences.modifier"):
                self._erreur("Absences", AccessDenied("le compte du téléphone ne permet pas de saisir les absences"))
                return
            for a in lignes:
                cible = table_ids.get(str(a.get(ref)))
                if not cible:
                    continue
                if self.db.scalar(f"SELECT 1 FROM {table} WHERE {ref}=? AND date=?", (cible, a.get("date"))):
                    self.r["absences_existantes"] += 1
                    continue
                data = {ref: cible, **{k: a.get(k) for k in ("date", "nature", "motif", "justifie", "observations")},
                        "jours": _f(a.get("jours")), "retard_min": a.get("retard_min")}
                try:
                    with self.db.transaction():
                        repo.save_absence(self.db, self.s, kind, None, annee, data)
                    self.r["absences_ajoutees"] += 1
                except (ValidationError, ValueError) as e:
                    self._erreur(f"Absence du {a.get('date')}", e)
