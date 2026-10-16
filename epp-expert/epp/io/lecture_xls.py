"""Lecture des classeurs Excel 97-2003 (.xls) sans bibliothèque externe.

Les exports nationaux (fichier ELEVES, SOUSPREFECTURES, CODENATIONALITES…) sont au format .xls :
un fichier composé OLE2 (« Compound File Binary ») qui contient le flux « Workbook » en BIFF8.
Ce module en lit la première feuille (ou une feuille choisie) et renvoie ses lignes, sur le modèle
de la fonction readXLS du prototype AKWA SCHOOL.

Enregistrements BIFF8 pris en charge : BOF, EOF, BOUNDSHEET, SST (+ CONTINUE), LABELSST, LABEL,
RSTRING, NUMBER, RK, MULRK, BOOLERR, FORMULA (+ STRING). Les autres sont ignorés.
"""
from __future__ import annotations

import struct
from pathlib import Path

MAGIC_OLE = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"
FIN_CHAINE = 0xFFFFFFFA          # au-delà : ENDOFCHAIN, FREESECT, FATSECT, DIFSECT


class FichierXlsInvalide(ValueError):
    pass


# =================================================================== conteneur OLE2
def _flux_workbook(data: bytes) -> bytes:
    """Contenu du flux « Workbook » (ou « Book ») d'un fichier composé OLE2."""
    if data[:8] != MAGIC_OLE:
        raise FichierXlsInvalide("Ce fichier n'est pas un classeur Excel 97-2003 (.xls).")
    u16 = lambda o: struct.unpack_from("<H", data, o)[0]       # noqa: E731
    u32 = lambda o: struct.unpack_from("<I", data, o)[0]       # noqa: E731
    ss, mss = 1 << u16(30), 1 << u16(32)
    n_fat, dir0, mini_cut, mfat0, difat0, n_difat = u32(44), u32(48), u32(56), u32(60), u32(68), u32(72)

    def off(s: int) -> int:
        return (s + 1) * ss               # l'en-tête occupe le premier secteur (512 ou 4096 octets)

    def secteur(s: int) -> bytes:
        o = off(s)
        if o + ss > len(data):
            raise FichierXlsInvalide("Fichier .xls tronqué ou endommagé.")
        return data[o:o + ss]

    difat = [u32(76 + i * 4) for i in range(109)]
    d, k = difat0, 0
    while k < n_difat and d < FIN_CHAINE:
        b = secteur(d)
        difat += struct.unpack_from(f"<{ss // 4 - 1}I", b, 0)
        d = struct.unpack_from("<I", b, ss - 4)[0]
        k += 1
    fat: list[int] = []
    for s in difat[:n_fat]:
        fat += struct.unpack(f"<{ss // 4}I", secteur(s))

    def chaine(s: int, table: list[int]) -> list[int]:
        out, vus = [], set()
        while s < FIN_CHAINE:
            if s in vus or s >= len(table):
                raise FichierXlsInvalide("Chaîne de secteurs invalide dans le fichier .xls.")
            vus.add(s)
            out.append(s)
            s = table[s]
        return out

    def gros(s: int) -> bytes:
        return b"".join(secteur(x) for x in chaine(s, fat))

    rep = gros(dir0)
    entrees = []
    for p in range(0, len(rep) - 127, 128):
        nl = struct.unpack_from("<H", rep, p + 64)[0]
        nom = rep[p:p + max(0, nl - 2)].decode("utf-16-le", "replace")
        entrees.append((nom, rep[p + 66], struct.unpack_from("<I", rep, p + 116)[0],
                        struct.unpack_from("<I", rep, p + 120)[0]))
    if not entrees:
        raise FichierXlsInvalide("Fichier .xls sans répertoire.")
    racine = entrees[0]
    e = next((x for x in entrees if x[0] in ("Workbook", "Book") and x[1] == 2), None)
    if e is None:
        raise FichierXlsInvalide("Classeur introuvable dans le fichier .xls.")
    _, _, debut, taille = e
    if taille < mini_cut:
        mini = gros(racine[2])
        mfat: list[int] = []
        for s in chaine(mfat0, fat):
            mfat += struct.unpack(f"<{ss // 4}I", secteur(s))
        flux = b"".join(mini[x * mss:(x + 1) * mss] for x in chaine(debut, mfat))
    else:
        flux = gros(debut)
    return flux[:taille]


# =================================================================== BIFF8
def _rk(v: int) -> float | int:
    if v & 2:
        x = v >> 2
        if x & (1 << 29):                 # entier signé sur 30 bits
            x -= 1 << 30
    else:
        x = struct.unpack("<d", struct.pack("<II", 0, v & 0xFFFFFFFC))[0]
    if v & 1:
        x = x / 100
    return x


def _nombre(x: float):
    """Entier si la valeur est entière (1.0 -> 1), sinon le nombre arrondi à 10 décimales."""
    if isinstance(x, float):
        if x.is_integer() and abs(x) < 1e15:
            return int(x)
        return round(x, 10)
    return x


def _chaine_courte(b: bytes, p: int) -> str:
    """XLUnicodeString : longueur (2 octets), options (1 octet), caractères."""
    n, fl = struct.unpack_from("<HB", b, p)
    p += 3
    if fl & 1:
        return b[p:p + 2 * n].decode("utf-16-le", "replace")
    return b[p:p + n].decode("latin-1")


def _enregistrements(flux: bytes):
    p, n = 0, len(flux)
    while p + 4 <= n:
        t, l = struct.unpack_from("<HH", flux, p)
        yield t, p, flux[p + 4:p + 4 + l]
        p += 4 + l


def _sst(morceaux: list[bytes]) -> list[str]:
    """Table des chaînes partagées ; une chaîne peut se poursuivre dans un enregistrement CONTINUE
    (l'octet d'options y est alors répété)."""
    out: list[str] = []
    if not morceaux or len(morceaux[0]) < 8:
        return out
    total = struct.unpack_from("<I", morceaux[0], 4)[0]
    mi, b, p = 0, morceaux[0], 8

    def suivant() -> bool:
        nonlocal mi, b, p
        if mi + 1 >= len(morceaux):
            return False
        mi += 1
        b, p = morceaux[mi], 0
        return True

    for _ in range(total):
        if p + 3 > len(b) and not suivant():
            break
        n, fl = struct.unpack_from("<HB", b, p)
        p += 3
        rt = sz = 0
        if fl & 8:
            rt = struct.unpack_from("<H", b, p)[0]
            p += 2
        if fl & 4:
            sz = struct.unpack_from("<I", b, p)[0]
            p += 4
        morceaux_txt, reste = [], n
        while reste > 0:
            if p >= len(b):
                if not suivant():
                    break
                fl = b[p]
                p += 1
            large = fl & 1
            k = min(reste, (len(b) - p) // (2 if large else 1))
            if large:
                morceaux_txt.append(b[p:p + 2 * k].decode("utf-16-le", "replace"))
                p += 2 * k
            else:
                morceaux_txt.append(b[p:p + k].decode("latin-1"))
                p += k
            reste -= k
        saut = rt * 4 + sz
        while saut > 0:
            if p >= len(b) and not suivant():
                break
            t = min(saut, len(b) - p)
            p += t
            saut -= t
        out.append("".join(morceaux_txt))
    return out


def lire_xls(source: str | Path | bytes, feuille: int = 0) -> list[list]:
    """Lignes d'une feuille d'un classeur .xls (première feuille par défaut).

    Chaque cellule vaut une chaîne (texte), un int ou un float (nombre ; date = numéro de série Excel),
    un bool, ou « » (cellule vide). Les lignes vides intermédiaires sont conservées (listes vides)."""
    data = source if isinstance(source, (bytes, bytearray)) else Path(source).read_bytes()
    flux = _flux_workbook(bytes(data))
    recs = list(_enregistrements(flux))
    # ---------------------------------------------------- globales : SST et liste des feuilles
    sst: list[str] = []
    feuilles: list[int] = []
    i = 0
    while i < len(recs):
        t, _, b = recs[i]
        if t == 0x00FC:
            morceaux = [b]
            j = i + 1
            while j < len(recs) and recs[j][0] == 0x003C:
                morceaux.append(recs[j][2])
                j += 1
            sst = _sst(morceaux)
            i = j
            continue
        if t == 0x0085 and len(b) >= 6 and b[5] == 0:          # BOUNDSHEET : feuille de calcul
            feuilles.append(struct.unpack_from("<I", b, 0)[0])
        if t == 0x000A:                                          # EOF des globales
            break
        i += 1
    if not feuilles:
        raise FichierXlsInvalide("Aucune feuille de calcul dans le fichier .xls.")
    if feuille >= len(feuilles):
        raise FichierXlsInvalide(f"Le classeur ne contient que {len(feuilles)} feuille(s).")
    debut = feuilles[feuille]
    # ---------------------------------------------------- cellules de la feuille choisie
    lignes: dict[int, dict[int, object]] = {}

    def pose(r: int, c: int, v) -> None:
        lignes.setdefault(r, {})[c] = v

    k = next((n for n, (_, p, _) in enumerate(recs) if p == debut), None)
    if k is None:
        raise FichierXlsInvalide("Feuille introuvable dans le fichier .xls.")
    niveau = 0
    while k < len(recs):
        t, _, b = recs[k]
        k += 1
        if t == 0x0809:                     # BOF (feuille, ou graphique incorporé)
            niveau += 1
            continue
        if t == 0x000A:                     # EOF
            niveau -= 1
            if niveau <= 0:
                break
            continue
        if niveau != 1 or len(b) < 6:
            continue
        r, c = struct.unpack_from("<HH", b, 0)
        if t == 0x00FD and len(b) >= 10:                         # LABELSST
            idx = struct.unpack_from("<I", b, 6)[0]
            pose(r, c, sst[idx] if idx < len(sst) else "")
        elif t in (0x0204, 0x00D6) and len(b) >= 9:             # LABEL, RSTRING
            pose(r, c, _chaine_courte(b, 6))
        elif t == 0x0203 and len(b) >= 14:                       # NUMBER
            pose(r, c, _nombre(struct.unpack_from("<d", b, 6)[0]))
        elif t == 0x027E and len(b) >= 10:                       # RK
            pose(r, c, _nombre(_rk(struct.unpack_from("<I", b, 6)[0])))
        elif t == 0x00BD:                                        # MULRK
            n = (len(b) - 6) // 6
            for j in range(n):
                pose(r, c + j, _nombre(_rk(struct.unpack_from("<I", b, 4 + j * 6 + 2)[0])))
        elif t == 0x0205 and len(b) >= 8:                        # BOOLERR
            if b[7] == 0:
                pose(r, c, bool(b[6]))
        elif t == 0x0006 and len(b) >= 14:                       # FORMULA : résultat en cache
            if b[12:14] != b"\xff\xff":
                pose(r, c, _nombre(struct.unpack_from("<d", b, 6)[0]))
            elif b[6] == 0 and k < len(recs) and recs[k][0] == 0x0207:     # chaîne dans STRING
                pose(r, c, _chaine_courte(recs[k][2], 0))
            elif b[6] == 1:
                pose(r, c, bool(b[8]))
    if not lignes:
        return []
    out = []
    for r in range(max(lignes) + 1):
        cells = lignes.get(r, {})
        out.append([cells.get(c, "") for c in range(max(cells) + 1)] if cells else [])
    return out
