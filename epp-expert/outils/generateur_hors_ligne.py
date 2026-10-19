"""Générateur de codes de licence HORS LIGNE d'AKWA SCHOOL (outil du fournisseur, Windows).

Pour les écoles sans réseau : l'appareil de l'école affiche un code de demande (16 caractères) ; ce
générateur renvoie un code de licence scellé pour cet appareil seulement (25 caractères, 5-5-5-5-5), sans Internet.
La clé maîtresse est gardée chiffrée par un mot de passe dans le dossier de l'utilisateur, jamais dans le dépôt.
Le secret des applications en est dérivé (bouton « Clé pour GitHub », secret AKWA_CLES_CODES_COURTS).
Cet outil n'est PAS livré aux écoles.

    python generateur_hors_ligne.py          fenêtre
"""
from __future__ import annotations

import base64
import csv
import json
import os
import secrets
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from epp.core import hors_ligne  # noqa: E402

NOM = "AKWA Codes hors ligne"
LIBELLES = {"1an": "École, 1 an", "vie": "École, à vie", "ens1an": "Enseignant seul, 1 an",
            "ensvie": "Enseignant seul, à vie"}
ITERATIONS = 300_000
_PKCS8 = bytes.fromhex("302e020100300506032b657004220420")


class Erreur(Exception):
    pass


def dossier() -> Path:
    if os.environ.get("AKWA_CODES_DOSSIER"):
        p = Path(os.environ["AKWA_CODES_DOSSIER"])
    elif sys.platform.startswith("win"):
        p = Path(os.environ.get("APPDATA", Path.home())) / "AkwaCodesHorsLigne"
    else:
        p = Path.home() / ".config" / "akwa-codes-hors-ligne"
    p.mkdir(parents=True, exist_ok=True)
    return p


# ---------------------------------------------------------------------- clé de signature
def graine_depuis_texte(texte: str) -> bytes:
    """Clé privée collée : PKCS8 en base64 (variable EPP_LICENCE_CLE_PRIVEE du service) ou graine de 32 octets."""
    try:
        b = base64.b64decode("".join((texte or "").split()), validate=True)
    except ValueError:
        raise Erreur("Clé illisible : collez la clé privée en base64.") from None
    if len(b) == 48 and b[:16] == _PKCS8:
        return b[16:]
    if len(b) == 32:
        return b
    raise Erreur("Ce n'est pas une clé privée Ed25519.")


def publique(graine: bytes) -> str:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    cle = Ed25519PrivateKey.from_private_bytes(graine).public_key()
    return base64.b64encode(cle.public_bytes(Encoding.Raw, PublicFormat.Raw)).decode()


def _cle_mdp(mdp: str, sel: bytes) -> bytes:
    import hashlib
    return hashlib.pbkdf2_hmac("sha256", mdp.encode("utf-8"), sel, ITERATIONS, 32)


def enregistrer_cle(graine: bytes, mdp: str, numero: int = 1) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if len(mdp) < 8:
        raise Erreur("Le mot de passe doit compter 8 caractères au moins.")
    sel, nonce = secrets.token_bytes(16), secrets.token_bytes(12)
    chiffre = AESGCM(_cle_mdp(mdp, sel)).encrypt(nonce, graine, b"akwa/cle-hors-ligne")
    pub = publique(graine)
    data = {"v": 1, "sel": base64.b64encode(sel).decode(), "nonce": base64.b64encode(nonce).decode(),
            "chiffre": base64.b64encode(chiffre).decode(), "publique": pub, "numero": numero}
    (dossier() / "cle.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
    return pub


def cle_existe() -> bool:
    return (dossier() / "cle.json").exists()


def numero_cle() -> int:
    """Numéro du secret des codes courts (augmenté si un secret a fuité)."""
    return int(json.loads((dossier() / "cle.json").read_text(encoding="utf-8")).get("numero", 1))


def changer_numero(mdp: str) -> int:
    graine, n = ouvrir_cle(mdp), numero_cle()
    if n >= 7:
        raise Erreur("Dernier numéro de clé atteint : créez une nouvelle clé maîtresse.")
    enregistrer_cle(graine, mdp, n + 1)
    return n + 1


def cle_github(graine: bytes, numero: int) -> str:
    """Valeur du secret GitHub AKWA_CLES_CODES_COURTS (injecté masqué dans les applications à la compilation)."""
    return hors_ligne.ecrire_cles_courtes({numero: hors_ligne.secret_court(graine, numero)})


def ouvrir_cle(mdp: str) -> bytes:
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    d = json.loads((dossier() / "cle.json").read_text(encoding="utf-8"))
    try:
        return AESGCM(_cle_mdp(mdp, base64.b64decode(d["sel"]))).decrypt(
            base64.b64decode(d["nonce"]), base64.b64decode(d["chiffre"]), b"akwa/cle-hors-ligne")
    except InvalidTag:
        raise Erreur("Mot de passe incorrect.") from None


# ---------------------------------------------------------------------- codes
def generer(graine: bytes, demande: str, type_: str, aujourd_hui: date | None = None, numero: int = 1) -> dict:
    """Code court (25 caractères) pour le code de demande saisi."""
    jour = aujourd_hui or date.today()
    code = hors_ligne.coder_court(hors_ligne.secret_court(graine, numero), numero, demande, type_, jour)
    expire = jour + timedelta(days=hors_ligne.JOURS_AN) if type_.endswith("1an") else None
    d = hors_ligne.nettoyer(demande)
    v = 0
    for x in hors_ligne.nettoyer(code):
        v = (v << 5) | hors_ligne.ALPHABET.index(x)
    return {"code": code, "type": type_, "expire": expire.isoformat() if expire else "",
            "serie": f"HC-{(v & ((1 << 105) - 1)) >> 85:07d}", "demande": hors_ligne.grouper(d)}


def noter(g: dict, note: str) -> None:
    f = dossier() / "registre.csv"
    neuf = not f.exists()
    with f.open("a", newline="", encoding="utf-8-sig") as o:
        w = csv.writer(o, delimiter=";")
        if neuf:
            w.writerow(["Date", "Numéro", "Type", "Expire le", "Code de demande", "Établissement ou note"])
        w.writerow([datetime.now().strftime("%Y-%m-%d %H:%M"), g["serie"], LIBELLES[g["type"]], g["expire"],
                    g["demande"], note])


# ---------------------------------------------------------------------- fenêtre
def fenetre() -> int:  # pragma: no cover - interface
    import tkinter as tk
    from tkinter import filedialog, messagebox, simpledialog, ttk

    racine = tk.Tk()
    racine.title(NOM)
    racine.geometry("620x560")
    etat = {"graine": None}

    def installer_cle() -> bool:
        if not messagebox.askyesno(NOM, "Aucune clé maîtresse sur cet ordinateur.\n\nOui : importer la clé du "
                                        "service (variable EPP_LICENCE_CLE_PRIVEE de Netlify), à garder en lieu sûr."
                                        "\nNon : créer une nouvelle clé maîtresse.\n\nEnsuite, mettez la « Clé pour "
                                        "GitHub » dans le secret AKWA_CLES_CODES_COURTS avant de compiler."):
            graine = secrets.token_bytes(32)
        else:
            texte = simpledialog.askstring(NOM, "Collez la clé privée (base64) :", parent=racine)
            if not texte:
                return False
            graine = graine_depuis_texte(texte)
        m1 = simpledialog.askstring(NOM, "Choisissez le mot de passe du générateur (8 caractères au moins) :",
                                    show="•", parent=racine)
        m2 = simpledialog.askstring(NOM, "Confirmez le mot de passe :", show="•", parent=racine)
        if not m1 or m1 != m2:
            messagebox.showerror(NOM, "Les deux mots de passe sont différents.")
            return False
        enregistrer_cle(graine, m1)
        etat["graine"] = graine
        return True

    def deverrouiller() -> bool:
        for _ in range(5):
            m = simpledialog.askstring(NOM, "Mot de passe du générateur :", show="•", parent=racine)
            if m is None:
                return False
            try:
                etat["graine"] = ouvrir_cle(m)
                return True
            except Erreur as e:
                messagebox.showerror(NOM, str(e))
        return False

    racine.withdraw()
    try:
        ok = deverrouiller() if cle_existe() else installer_cle()
    except Erreur as e:
        messagebox.showerror(NOM, str(e))
        ok = False
    if not ok:
        racine.destroy()
        return 1
    racine.deiconify()

    cadre = ttk.Frame(racine, padding=16)
    cadre.pack(fill="both", expand=True)
    ttk.Label(cadre, text=NOM, font=("Segoe UI", 14, "bold")).pack(anchor="w")
    info = ttk.Label(cadre, wraplength=580)
    info.pack(anchor="w", pady=4)

    def afficher_numero():
        info.config(text=f"Clé n° {numero_cle()} : les applications compilées avec la même « Clé pour GitHub » "
                         "acceptent les codes.")

    afficher_numero()
    ttk.Label(cadre, text="Code de demande affiché par l'appareil de l'école :").pack(anchor="w", pady=(12, 0))
    demande = ttk.Entry(cadre, font=("Consolas", 13))
    demande.pack(fill="x")
    ttk.Label(cadre, text="Type de licence :").pack(anchor="w", pady=(10, 0))
    choix = ttk.Combobox(cadre, values=list(LIBELLES.values()), state="readonly")
    choix.current(0)
    choix.pack(fill="x")
    ttk.Label(cadre, text="Établissement ou note (registre) :").pack(anchor="w", pady=(10, 0))
    note = ttk.Entry(cadre)
    note.pack(fill="x")
    sortie = tk.Text(cadre, height=4, font=("Consolas", 13), wrap="word")

    def lancer():
        try:
            g = generer(etat["graine"], demande.get(), list(LIBELLES)[choix.current()], numero=numero_cle())
        except (hors_ligne.CodeInvalide, ValueError) as e:
            messagebox.showerror(NOM, str(e))
            return
        noter(g, note.get().strip())
        sortie.delete("1.0", "end")
        sortie.insert("1.0", f"{g['code']}\n\n{LIBELLES[g['type']]}"
                             f"{', expire le ' + g['expire'] if g['expire'] else ''} · {g['serie']}")
        racine.clipboard_clear()
        racine.clipboard_append(g["code"])

    def github():
        v = cle_github(etat["graine"], numero_cle())
        racine.clipboard_clear()
        racine.clipboard_append(v)
        messagebox.showinfo(NOM, "Clé copiée. Collez-la dans GitHub › Settings › Secrets and variables › Actions, "
                                 "secret AKWA_CLES_CODES_COURTS, puis compilez une nouvelle version.\n\nNe la "
                                 "donnez à personne d'autre.")

    def nouveau_numero():
        if not messagebox.askyesno(NOM, "À faire seulement si des codes pirates circulent : les codes de la clé "
                                        "actuelle seront refusés par la prochaine version des applications. "
                                        "Continuer ?"):
            return
        m = simpledialog.askstring(NOM, "Mot de passe du générateur :", show="•", parent=racine)
        try:
            changer_numero(m or "")
        except Erreur as e:
            messagebox.showerror(NOM, str(e))
            return
        afficher_numero()
        github()

    def exporter():
        f = filedialog.asksaveasfilename(defaultextension=".csv", initialfile="registre-codes-hors-ligne.csv")
        if f and (dossier() / "registre.csv").exists():
            Path(f).write_bytes((dossier() / "registre.csv").read_bytes())

    barre = ttk.Frame(cadre)
    barre.pack(fill="x", pady=12)
    ttk.Button(barre, text="Générer le code de licence", command=lancer).pack(side="left")
    ttk.Button(barre, text="Exporter le registre", command=exporter).pack(side="right")
    barre2 = ttk.Frame(cadre)
    barre2.pack(fill="x", side="bottom", pady=(8, 0))
    ttk.Button(barre2, text="Clé pour GitHub", command=github).pack(side="left")
    ttk.Button(barre2, text="Changer de numéro de clé (fuite)", command=nouveau_numero).pack(side="right")
    ttk.Label(cadre, text="Code de licence à saisir sur l'appareil de l'école (copié automatiquement) :").pack(
        anchor="w")
    sortie.pack(fill="both", expand=True)
    racine.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(fenetre())
