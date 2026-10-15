"""Données de test du noyau Java du téléphone (lecture des tableaux, licence), comparées au code Python.

    python outils/fixtures_noyau.py preparer <dossier>   # fichiers d'essai et licences signées
    java ... TestNoyau <dossier>                          # le téléphone lit et vérifie, écrit ses résultats
    python outils/fixtures_noyau.py verifier <dossier>   # résultats Java == lecture Python (import_eleves19)

Les fichiers .xlsx et .csv sont créés ici ; le .xls (format de l'export national) est un fichier d'essai du
dépôt (android/test-jvm/donnees, noms fictifs) produit par LibreOffice, que l'intégration continue n'a pas.
"""
from __future__ import annotations

import base64
import json
import shutil
import sys
from datetime import date, datetime, timezone
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE))
XLS = RACINE / "android" / "test-jvm" / "donnees" / "eleves_essai.xls"


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _empreinte(ident: str) -> str:
    import hashlib
    return hashlib.sha256(f"AKWA-ANDROID|{ident}".encode()).hexdigest()


def preparer(dossier: Path) -> None:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from openpyxl import Workbook

    dossier.mkdir(parents=True, exist_ok=True)
    # ------------------------------------------------------------------ tableaux
    wb = Workbook()
    ws = wb.active
    ws.title = "Élèves"
    ws.append(["Nom", "Prénoms", "Sexe", "Date de naissance", "Classe", "Moyenne", "Redoublant", "Vide"])
    for i in range(60):
        ws.append([f"KOUASSI n°{i}", "Aïcha « Marie »" if i % 2 else "Jean;Baptiste", "F" if i % 2 else "M",
                   date(2015, 1 + i % 12, 1 + i % 28), "CE1" if i % 3 else "CM2", 7.25 + i if i % 4 else 12,
                   bool(i % 5 == 0), None])
    ws.append([])                                  # ligne vide : retirée
    ws.append(["fin", None, None, None, None, None, None, ""])
    wb.create_sheet("Autre").append(["ne pas lire"])
    wb.save(dossier / "essai.xlsx")
    lignes = [["Nom", "Téléphone", "Observation"], ["DIABATÉ Ibrahim", "0707070707", 'dit "le grand"; CP1'],
              ["KONÉ Fatoumata", "05 05 05", "ligne\nsur deux lignes"], ["", "", ""], ["YAO", "", ""]]
    import csv
    with open(dossier / "essai_utf8.csv", "w", encoding="utf-8-sig", newline="") as f:
        csv.writer(f, delimiter=";").writerows(lignes)
    with open(dossier / "essai_cp1252.csv", "w", encoding="cp1252", newline="") as f:
        csv.writer(f, delimiter=",").writerows([[c.replace("\n", " ") for c in r] for r in lignes])
    shutil.copy(XLS, dossier / "eleves_essai.xls")

    # ------------------------------------------------------------------ licences (clé de test)
    cle = Ed25519PrivateKey.generate()
    pub = base64.b64encode(cle.public_key().public_bytes(serialization.Encoding.Raw,
                                                         serialization.PublicFormat.Raw)).decode()
    machine = _empreinte("identifiant-android-test")
    maintenant = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)

    def signer(contenu: dict) -> tuple[str, str]:
        brut = json.dumps(contenu, ensure_ascii=False).encode("utf-8")
        return _b64u(brut), _b64u(cle.sign(brut))

    base = {"v": 1, "produit": "GESTION SCOLAIRE EPP EXPERT", "code": "ABCD-EFGH-JKLM", "machine": machine,
            "ecole": "EPP « ESSAI »", "active_le": maintenant.isoformat()}
    lic1, sig1 = signer({**base, "type": "1an", "expire_le": "2027-10-15T12:00:00.000Z"})
    lic_vie, sig_vie = signer({**base, "type": "vie", "expire_le": None})
    lic_echue, sig_echue = signer({**base, "type": "1an", "expire_le": "2026-10-01T00:00:00.000Z"})
    lic_autre, sig_autre = signer({**base, "type": "vie", "expire_le": None, "machine": _empreinte("autre")})
    falsifiee = _b64u(json.dumps({**base, "type": "vie", "expire_le": None}).encode())
    (dossier / "licence.txt").write_text("\n".join([
        pub, machine, str(int(maintenant.timestamp() * 1000)),
        lic1, sig1, lic_vie, sig_vie, lic_echue, sig_echue, lic_autre, sig_autre, falsifiee, sig1,
    ]) + "\n", encoding="utf-8")
    assert _empreinte("x") != machine
    print(f"données de test écrites dans {dossier}")


def verifier(dossier: Path) -> None:
    from epp.io.import_eleves19 import lire_fichier
    erreurs = 0
    for f in ("essai.xlsx", "essai_utf8.csv", "essai_cp1252.csv", "eleves_essai.xls"):
        attendu = lire_fichier(dossier / f)
        obtenu = json.loads((dossier / (f + ".java.json")).read_text(encoding="utf-8"))
        if obtenu != attendu:
            erreurs += 1
            print(f"ÉCHEC {f} : {len(obtenu)} lignes lues par le téléphone, {len(attendu)} par l'ordinateur")
            for i, (a, b) in enumerate(zip(attendu, obtenu)):
                if a != b:
                    print(f"  ligne {i + 1} :\n    ordinateur {a}\n    téléphone  {b}")
                    break
        else:
            print(f"ok {f} : {len(attendu)} lignes identiques")
    sys.exit(1 if erreurs else 0)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("preparer", "verifier"):
        sys.exit(__doc__)
    (preparer if sys.argv[1] == "preparer" else verifier)(Path(sys.argv[2]))
