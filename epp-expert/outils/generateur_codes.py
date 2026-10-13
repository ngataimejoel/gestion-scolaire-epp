"""Générateur de codes d'activation de GESTION SCOLAIRE EPP EXPERT (outil du fournisseur).

Cet outil n'est PAS livré aux écoles : il sert au fournisseur à créer des codes « 1 an » ou
« à vie », à suivre leur utilisation, à libérer un code (changement d'ordinateur) ou à l'annuler.
Il parle au service d'activation en ligne avec un jeton d'administration secret, rangé dans le
dossier de configuration de l'utilisateur (jamais dans le dépôt).

    python generateur_codes.py                       fenêtre
    python generateur_codes.py generer --type vie --nombre 3 --note "EPP OUANINOU 2"
    python generateur_codes.py lister
    python generateur_codes.py liberer EPP-XXXX-XXXX-XXXX-XXXX
    python generateur_codes.py revoquer EPP-XXXX-XXXX-XXXX-XXXX
    python generateur_codes.py config --url https://... --jeton ...
    python generateur_codes.py initialiser           crée les clés du service (une seule fois)
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

TYPES = {"1an": "1 an", "vie": "À vie"}


class ErreurGenerateur(Exception):
    pass


def dossier_config() -> Path:
    if os.environ.get("EPP_GENERATEUR_CONFIG"):
        p = Path(os.environ["EPP_GENERATEUR_CONFIG"])
    elif sys.platform.startswith("win"):
        p = Path(os.environ.get("APPDATA") or Path.home()) / "GenerateurCodesEPP"
    else:
        p = Path.home() / ".config" / "GenerateurCodesEPP"
    p.mkdir(parents=True, exist_ok=True)
    return p


def lire_config() -> dict:
    try:
        return json.loads((dossier_config() / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def ecrire_config(**valeurs) -> dict:
    cfg = lire_config() | {k: v for k, v in valeurs.items() if v}
    f = dossier_config() / "config.json"
    f.write_text(json.dumps(cfg, indent=1), encoding="utf-8")
    try:
        os.chmod(f, 0o600)
    except OSError:
        pass
    return cfg


def appel(chemin: str, corps: dict | None = None, cfg: dict | None = None) -> dict:
    cfg = cfg or lire_config()
    if not cfg.get("url") or not cfg.get("jeton"):
        raise ErreurGenerateur("Configurez d'abord l'adresse du service et le jeton (commande config).")
    req = urllib.request.Request(
        cfg["url"].rstrip("/") + chemin, method="POST" if corps is not None else "GET",
        data=json.dumps(corps).encode() if corps is not None else None,
        headers={"Authorization": f"Bearer {cfg['jeton']}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode()).get("erreur")
        except ValueError:
            msg = None
        raise ErreurGenerateur(msg or f"Erreur du service ({e.code}).") from None
    except (urllib.error.URLError, OSError) as e:
        raise ErreurGenerateur(f"Service injoignable : {e}") from None


def generer(type_: str, nombre: int, note: str = "") -> list[dict]:
    if type_ not in TYPES:
        raise ErreurGenerateur("Type : 1an ou vie.")
    return appel("/api/admin/codes", {"type": type_, "nombre": nombre, "note": note})["codes"]


def lister() -> list[dict]:
    return appel("/api/admin/codes")["codes"]


def liberer(code: str) -> None:
    appel("/api/admin/liberer", {"code": code})


def revoquer(code: str) -> None:
    appel("/api/admin/revoquer", {"code": code})


def initialiser() -> dict:
    """Crée la paire de clés Ed25519 du service et un jeton d'administration."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    cle = Ed25519PrivateKey.generate()
    privee = base64.b64encode(cle.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8,
                                                serialization.NoEncryption())).decode()
    publique = base64.b64encode(cle.public_key().public_bytes(serialization.Encoding.Raw,
                                                              serialization.PublicFormat.Raw)).decode()
    return {"EPP_LICENCE_CLE_PRIVEE": privee, "EPP_ADMIN_TOKEN": secrets.token_urlsafe(36),
            "cle_publique": publique}


def ecrire_csv(codes: list[dict], fichier: str) -> None:
    with open(fichier, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Code", "Type", "Note", "Utilisé", "École", "Activé le", "Expire le"])
        for c in codes:
            w.writerow([c["code"], TYPES.get(c["type"], c["type"]), c.get("note", ""),
                        "OUI" if c.get("utilise") else "NON", c.get("ecole", ""),
                        (c.get("active_le") or "")[:10], (c.get("expire_le") or "")[:10]])


# ------------------------------------------------------------------ fenêtre
def fenetre() -> int:
    from PySide6.QtWidgets import (QApplication, QComboBox, QFileDialog, QHBoxLayout, QHeaderView, QLabel,
                                   QLineEdit, QMessageBox, QPushButton, QSpinBox, QTableWidget,
                                   QTableWidgetItem, QVBoxLayout, QWidget)
    app = QApplication.instance() or QApplication(sys.argv)
    w = QWidget()
    w.setWindowTitle("Générateur de codes d'activation – EPP Expert")
    w.resize(900, 560)
    lay = QVBoxLayout(w)
    ligne = QHBoxLayout()
    type_ = QComboBox()
    type_.addItem("Licence 1 an", "1an")
    type_.addItem("Licence à vie", "vie")
    nombre = QSpinBox()
    nombre.setRange(1, 500)
    note = QLineEdit()
    note.setPlaceholderText("École ou client (facultatif)")
    bouton = QPushButton("Générer")
    for x in (QLabel("Type :"), type_, QLabel("Nombre :"), nombre, note, bouton):
        ligne.addWidget(x)
    lay.addLayout(ligne)
    table = QTableWidget(0, 7)
    table.setHorizontalHeaderLabels(["Code", "Type", "Note", "Utilisé", "École", "Activé le", "Expire le"])
    table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
    lay.addWidget(table)
    bas = QHBoxLayout()
    actions = {n: QPushButton(n) for n in ("Actualiser", "Copier le code", "Libérer", "Annuler le code",
                                           "Exporter (CSV)")}
    for b in actions.values():
        bas.addWidget(b)
    lay.addLayout(bas)
    donnees: list[dict] = []

    def erreur(e):
        QMessageBox.warning(w, "Générateur", str(e))

    def remplir():
        nonlocal donnees
        try:
            donnees = lister()
        except ErreurGenerateur as e:
            return erreur(e)
        table.setRowCount(len(donnees))
        for i, c in enumerate(donnees):
            vals = [c["code"], TYPES.get(c["type"], c["type"]) + (" (annulé)" if c.get("revoque") else ""),
                    c.get("note", ""), "OUI" if c.get("utilise") else "NON", c.get("ecole", ""),
                    (c.get("active_le") or "")[:10], (c.get("expire_le") or "")[:10] or (
                        "jamais" if c.get("utilise") and c["type"] == "vie" else "")]
            for j, v in enumerate(vals):
                table.setItem(i, j, QTableWidgetItem(v))

    def code_choisi():
        r = table.currentRow()
        return donnees[r]["code"] if 0 <= r < len(donnees) else None

    def sur_generer():
        try:
            codes = generer(type_.currentData(), nombre.value(), note.text())
        except ErreurGenerateur as e:
            return erreur(e)
        QApplication.clipboard().setText("\n".join(c["code"] for c in codes))
        QMessageBox.information(w, "Générateur", f"{len(codes)} code(s) créé(s) et copiés :\n\n"
                                + "\n".join(c["code"] for c in codes))
        remplir()

    def sur_action(fn, question):
        c = code_choisi()
        if c and QMessageBox.question(w, "Générateur", question.format(c)) == QMessageBox.Yes:
            try:
                fn(c)
            except ErreurGenerateur as e:
                return erreur(e)
            remplir()

    def sur_csv():
        f, _ = QFileDialog.getSaveFileName(w, "Exporter", "codes_activation.csv", "CSV (*.csv)")
        if f:
            ecrire_csv(donnees, f)

    bouton.clicked.connect(sur_generer)
    actions["Actualiser"].clicked.connect(remplir)
    actions["Copier le code"].clicked.connect(lambda: code_choisi() and QApplication.clipboard().setText(code_choisi()))
    actions["Libérer"].clicked.connect(lambda: sur_action(
        liberer, "Libérer {} ? L'école pourra l'activer sur un autre ordinateur."))
    actions["Annuler le code"].clicked.connect(lambda: sur_action(
        revoquer, "Annuler définitivement {} ? Il ne pourra plus être activé."))
    actions["Exporter (CSV)"].clicked.connect(sur_csv)
    w.show()
    if lire_config().get("url"):
        remplir()
    return app.exec()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Générateur de codes d'activation EPP Expert")
    sub = ap.add_subparsers(dest="cmd")
    g = sub.add_parser("generer")
    g.add_argument("--type", choices=list(TYPES), required=True)
    g.add_argument("--nombre", type=int, default=1)
    g.add_argument("--note", default="")
    g.add_argument("--csv")
    l = sub.add_parser("lister")
    l.add_argument("--csv")
    for n in ("liberer", "revoquer"):
        sub.add_parser(n).add_argument("code")
    c = sub.add_parser("config")
    c.add_argument("--url")
    c.add_argument("--jeton")
    sub.add_parser("initialiser")
    a = ap.parse_args(argv)
    try:
        if a.cmd is None:
            return fenetre()
        if a.cmd == "generer":
            codes = generer(a.type, a.nombre, a.note)
            print("\n".join(x["code"] for x in codes))
            if a.csv:
                ecrire_csv(codes, a.csv)
        elif a.cmd == "lister":
            codes = lister()
            if a.csv:
                ecrire_csv(codes, a.csv)
            for x in codes:
                print(f"{x['code']}  {TYPES[x['type']]:6}  {'utilisé' if x['utilise'] else 'libre':8}  "
                      f"{x.get('ecole', '')}  {x.get('note', '')}")
        elif a.cmd == "liberer":
            liberer(a.code)
        elif a.cmd == "revoquer":
            revoquer(a.code)
        elif a.cmd == "config":
            ecrire_config(url=a.url, jeton=a.jeton)
            print(f"Configuration enregistrée dans {dossier_config()}")
        elif a.cmd == "initialiser":
            s = initialiser()
            f = dossier_config() / "cles_service_SECRET.json"
            f.write_text(json.dumps(s, indent=1), encoding="utf-8")
            ecrire_config(jeton=s["EPP_ADMIN_TOKEN"])
            print(f"Clés créées dans {f} (à garder secret).\n"
                  "Copiez EPP_LICENCE_CLE_PRIVEE et EPP_ADMIN_TOKEN dans les variables du service en ligne,\n"
                  f"et la clé publique dans epp/resources/activation.json :\n{s['cle_publique']}")
    except ErreurGenerateur as e:
        print(f"Erreur : {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
