"""Fabrique les images du logo de l'application à partir du logo fourni (outils/sources/akwa_school_logo.png).

    python outils/logo.py      -> epp/resources/logo/ (symbole, logo complet, tuile) et epp/resources/app.ico

Le fond crème du logo est rendu transparent ; le symbole (le « A » au chapeau) est séparé du nom pour les
petites tailles (icône du programme, menu), où le nom serait illisible.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

RACINE = Path(__file__).resolve().parents[1]
SOURCE = RACINE / "outils" / "sources" / "akwa_school_logo.png"
SORTIE = RACINE / "epp" / "resources" / "logo"
CREME = (250, 243, 234)


def transparent(im: Image.Image) -> Image.Image:
    """Fond crème -> transparent ; les bords lissés gardent une transparence partielle."""
    im = im.convert("RGB")
    px = im.load()
    out = Image.new("RGBA", im.size)
    po = out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = px[x, y]
            d = max(abs(r - CREME[0]), abs(g - CREME[1]), abs(b - CREME[2]))
            a = min(255, d * 255 // 90)
            po[x, y] = (r, g, b, a)
    return out


def recadrer(im: Image.Image, marge: float = 0.04) -> Image.Image:
    x0, y0, x1, y1 = im.getbbox()
    m = int(max(x1 - x0, y1 - y0) * marge)
    return im.crop((max(0, x0 - m), max(0, y0 - m), min(im.width, x1 + m), min(im.height, y1 + m)))


def carre(im: Image.Image, cote: int, fond=None, rayon: float = 0.0, remplissage: float = 0.84) -> Image.Image:
    out = Image.new("RGBA", (cote, cote), (0, 0, 0, 0))
    if fond:
        masque = Image.new("L", (cote, cote), 0)
        ImageDraw.Draw(masque).rounded_rectangle((0, 0, cote - 1, cote - 1), int(cote * rayon), fill=255)
        out.paste(Image.new("RGBA", (cote, cote), fond), (0, 0), masque)
    k = cote * remplissage / max(im.size)
    s = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    out.alpha_composite(s, ((cote - s.width) // 2, (cote - s.height) // 2))
    return out


def fabriquer() -> list[Path]:
    src = transparent(Image.open(SOURCE))
    h = src.height
    symbole = recadrer(src.crop((0, 0, src.width, int(h * 0.80))))    # au-dessus du nom AKWA SCHOOL
    complet = recadrer(src)
    SORTIE.mkdir(parents=True, exist_ok=True)
    faits = []
    complet.thumbnail((900, 900), Image.LANCZOS)
    complet.save(SORTIE / "logo_complet.png", optimize=True)
    carre(symbole, 512, remplissage=0.96).save(SORTIE / "symbole.png", optimize=True)
    tuile = carre(symbole, 256, fond=CREME + (255,), rayon=0.22, remplissage=0.80)   # lisible sur fond sombre
    tuile.save(SORTIE / "tuile.png", optimize=True)
    tuile.save(RACINE / "epp" / "resources" / "app.ico",
               sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    faits += [SORTIE / n for n in ("logo_complet.png", "symbole.png", "tuile.png")]
    faits.append(RACINE / "epp" / "resources" / "app.ico")
    return faits


if __name__ == "__main__":
    for f in fabriquer():
        print(f, f.stat().st_size, file=sys.stdout)
