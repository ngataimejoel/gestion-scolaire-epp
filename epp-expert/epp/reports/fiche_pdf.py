"""Fiche scolaire de l'élève en PDF (une page A4, modèle de l'école) et en-tête officiel « fiche scolaire ».

L'en-tête reprend la fiche de l'école : à gauche le ministère, la direction régionale et l'inspection
séparés par des tirets ; à droite la République, la devise et les logos ; un trait sous l'ensemble.
Le même en-tête est utilisé par tous les documents (rapports, bulletins, demandes, fiches).
"""
from __future__ import annotations

import io

from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Flowable

from epp.domain import calculs
from epp.reports import engine as E

NOIR = colors.black
GRIS = colors.HexColor("#A6A6A6")
GRIS_TXT = colors.HexColor("#6B6B6B")
TIRETS = "-" * 26
ORDINAUX = ("1ère", "2ème", "3ème", "4ème", "5ème", "6ème", "7ème", "8ème")


def _date(v) -> str:
    d = calculs.to_date(v) if v else None
    return d.strftime("%d/%m/%Y") if d else ""


def _image(c, data, x, y, w, h) -> bool:
    try:
        ir = ImageReader(io.BytesIO(data))
        iw, ih = ir.getSize()
    except Exception:
        return False
    k = min(w / iw, h / ih)
    c.drawImage(ir, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k, mask="auto")
    return True


class _Mesure:
    """Canevas factice : permet de calculer la hauteur de l'en-tête sans le dessiner."""

    def __getattr__(self, nom):
        return lambda *a, **k: None


def dessiner_entete(c, x0: float, y_haut: float, W: float, gauche: list[str], droite: list[str],
                    logos: list[bytes], polices: tuple[str, str], logo_h: float = 18 * mm,
                    taille: float = 8.2, tirets: bool = True) -> float:
    """Dessine l'en-tête officiel (style fiche scolaire) ; renvoie la hauteur utilisée (trait compris).
    Avec c=None, rien n'est dessiné : seule la hauteur est calculée."""
    c = c or _Mesure()
    F, FB = polices
    wg, wd = min(W * 0.56, 110 * mm), min(W * 0.40, 80 * mm)
    xd = x0 + W - wd
    pas = taille * 1.22
    c.setFillColor(NOIR)
    y = y_haut - taille
    bloc = max([min(stringWidth(l, FB, taille), wg) for l in gauche] or [wg])
    for i, l in enumerate(gauche):
        if i and tirets:
            c.setFont(F, 6.5)
            c.drawCentredString(x0 + bloc / 2, y + 1.2, TIRETS)
            y -= pas * 0.85
        for morceau in simpleSplit(l, FB, taille, wg):
            c.setFont(FB, taille)
            c.drawString(x0, y, morceau)
            y -= pas
    bas_g = y + pas
    y = y_haut - taille - 1.5
    xc = xd + wd / 2
    for i, l in enumerate(droite):
        t = taille + 2 if i == 0 else (taille - 1 if i == 1 else taille)
        for morceau in simpleSplit(l, FB, t, wd):
            c.setFont(FB, t)
            c.drawCentredString(xc, y, morceau)
            y -= t * 1.25
        if i == 1 and tirets:
            c.setFont(F, 6.5)
            c.drawCentredString(xc, y + 2.5, TIRETS)
            y -= pas * 0.6
    bas_d = y + pas * 0.6
    if logos:
        n = len(logos)
        lw = min(wd / n - 2 * mm, 30 * mm)
        y -= logo_h - 1.5 * mm
        if not isinstance(c, _Mesure):
            for i, data in enumerate(logos):
                _image(c, data, xc - (n * lw) / 2 + i * lw + 1 * mm, y, lw - 2 * mm, logo_h)
        bas_d = y
    bas = min(bas_g, bas_d) - 2.5 * mm
    c.setStrokeColor(NOIR)
    c.setLineWidth(1)
    c.line(x0, bas, x0 + W, bas)
    return y_haut - bas


class EnteteOfficielPDF(Flowable):
    """En-tête officiel « fiche scolaire » comme élément de page (rapports, listes, bulletins classiques)."""

    def __init__(self, gauche, droite, logos, polices):
        super().__init__()
        self.gauche, self.droite, self.logos, self.polices = gauche, droite, logos, polices

    def wrap(self, aw, ah):
        self.width = aw
        self.height = dessiner_entete(None, 0, 0, aw, self.gauche, self.droite, self.logos, self.polices)
        return self.width, self.height

    def draw(self):
        dessiner_entete(self.canv, 0, self.height, self.width, self.gauche, self.droite, self.logos, self.polices)


def titre_encadre(c, xc: float, y_haut: float, texte: str, police: str, taille: float = 22) -> float:
    """Titre dans un cadre noir avec ombre grise (comme « FICHE SCOLAIRE ») ; renvoie la hauteur."""
    tw = stringWidth(texte, police, taille)
    w, h = tw + 18 * mm, taille * 0.72 + 9 * mm
    x, y = xc - w / 2, y_haut - h
    c.setFillColor(GRIS)
    c.rect(x + 1.6 * mm, y - 1.6 * mm, w, h, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setStrokeColor(NOIR)
    c.setLineWidth(1.6)
    c.rect(x, y, w, h, stroke=1, fill=1)
    c.setFillColor(NOIR)
    c.setFont(police, taille)
    yb = y + (h - taille * 0.72) / 2
    c.drawCentredString(xc, yb, texte)
    c.setLineWidth(1)
    c.line(xc - tw / 2, yb - 1.6, xc + tw / 2, yb - 1.6)
    return h + 1.6 * mm


def qr_dessin(texte: str, cote: float) -> Drawing:
    w = QrCodeWidget(texte, barLevel="M", barBorder=1)
    b = w.getBounds()
    d = Drawing(cote, cote, transform=[cote / (b[2] - b[0]), 0, 0, cote / (b[3] - b[1]), 0, 0])
    d.add(w)
    return d


class FicheScolairePDF(Flowable):
    def __init__(self, doc: E.Document, b: E.FicheScolaire, polices: tuple[str, str, str]):
        super().__init__()
        self.doc, self.d, self.photo, self.o = doc, b.data, b.photo, b.options
        self.F, self.FB, self.FI = polices

    def wrap(self, aw, ah):
        self.width, self.height = aw, ah - 1
        return self.width, self.height

    # ------------------------------------------------------------------ outils
    def _txt(self, x, y, s, font=None, size=10, align="left", maxw=None, color=NOIR):
        c = self.canv
        font = font or self.F
        s = str(s or "")
        if maxw:
            while size > 5.5 and stringWidth(s, font, size) > maxw:
                size -= 0.25
        c.setFont(font, size)
        c.setFillColor(color)
        {"left": c.drawString, "center": c.drawCentredString, "right": c.drawRightString}[align](x, y, s)
        return stringWidth(s, font, size)

    def _points(self, x1, x2, y):
        if x2 - x1 < 2 * mm:
            return
        c = self.canv
        c.saveState()
        c.setStrokeColor(NOIR)
        c.setDash(0.6, 1.8)
        c.setLineWidth(0.7)
        c.line(x1, y - 0.6, x2, y - 0.6)
        c.restoreState()

    def _champ(self, x, y, label, valeur, x_fin, taille=10.5):
        """« LABEL : valeur…… » : libellé en gras, valeur, pointillés jusqu'à x_fin."""
        lw = self._txt(x, y, label, self.FB, taille)
        xv = x + lw + 1.5 * mm
        vw = self._txt(xv, y, valeur, self.F, taille, maxw=x_fin - xv) if valeur else 0
        self._points(xv + vw + (1 * mm if vw else 0), x_fin, y)

    def _case(self, x, y, cochee, s=3.2 * mm):
        c = self.canv
        c.setStrokeColor(NOIR)
        c.setLineWidth(0.8)
        c.rect(x, y - 0.4 * mm, s, s, stroke=1, fill=0)
        if cochee:
            c.setLineWidth(1.3)
            c.line(x + 0.6 * mm, y + 1.3 * mm, x + 1.4 * mm, y + 0.3 * mm)
            c.line(x + 1.4 * mm, y + 0.3 * mm, x + 2.8 * mm, y + 2.8 * mm)
            c.setLineWidth(0.8)
        return s

    # ------------------------------------------------------------------ dessin
    def draw(self):
        c, d, o, doc = self.canv, self.d, self.o, self.doc
        W, H = self.width, self.height
        c.setStrokeColor(NOIR)
        c.setLineWidth(1.2)
        c.rect(0, 0, W, H, stroke=1, fill=0)
        m = 6 * mm
        x0, xf = m, W - m
        Wi = xf - x0
        y = H - 6 * mm

        gauche, droite, logos = E.entete_officiel(doc)
        y -= dessiner_entete(c, x0, y, Wi, gauche, droite, logos, (self.F, self.FB))
        # espacements réduits si l'en-tête est haut (parties fixes : titre, photo, tableau, signatures)
        k = max(0.55, min(1.0, (y - 2 * mm - 106 * mm) / (134 * mm)))
        y -= 4 * mm * k
        y -= titre_encadre(c, W / 2, y, o.get("titre_fiche") or "FICHE SCOLAIRE", self.FB, 22)
        y -= 5 * mm * k

        # ---------------------------------------------------- photo, sexe, classe, n° de fiche, QR
        pw, ph = 33 * mm, 40.5 * mm
        top = y
        c.setLineWidth(1)
        c.rect(x0 + 2 * mm, top - ph, pw, ph, stroke=1, fill=0)
        if not (o.get("photo", True) and self.photo and _image(c, self.photo, x0 + 2.5 * mm, top - ph + 0.5 * mm,
                                                               pw - 1 * mm, ph - 1 * mm)):
            self._txt(x0 + 2 * mm + pw / 2, top - ph / 2, "PHOTO", self.FB, 11, "center", color=GRIS_TXT)
            self._txt(x0 + 2 * mm + pw / 2, top - ph / 2 - 4.5 * mm, "33 × 40,5 mm", self.FI, 8, "center",
                      color=GRIS_TXT)
        qr = 26 * mm if o.get("qr", True) else 0
        xr = xf - max(qr, 44 * mm)
        # n° de fiche (cadre gris)
        c.setFillColor(colors.HexColor("#BFBFBF"))
        c.rect(xr, top - 10 * mm, xf - xr, 10 * mm, stroke=1, fill=1)
        self._txt((xr + xf) / 2, top - 6.3 * mm, f"FICHE N° {d.get('fiche_no', '')}", self.FB, 10, "center",
                  maxw=xf - xr - 2 * mm)
        if qr:
            renderPDF.draw(qr_dessin(d.get("qr") or "", qr), c, xf - qr - ((xf - xr) - qr) / 2, top - 12 * mm - qr)
            self._txt((xr + xf) / 2, top - 15 * mm - qr, "Code QR : école et élève", self.FI, 7, "center",
                      color=GRIS_TXT)
        xm = x0 + 2 * mm + pw + 6 * mm
        yy = top - 6 * mm
        xx = xm + self._txt(xm, yy, "Sexe :", self.FB, 10.5) + 2 * mm
        for code, lib in (("M", "Masculin"), ("F", "Féminin")):
            xx += self._case(xx, yy, d.get("sexe") == code) + 1 * mm
            xx += self._txt(xx, yy, lib, self.FB, 10.5) + 4 * mm
        yy -= 9 * mm
        xx = xm + self._txt(xm, yy, "Classe :", self.FB, 10.5) + 2 * mm
        tn = 10.0
        while tn > 7 and xx + 6 * (3.2 * mm + 0.8 * mm + stringWidth("CM2", self.FB, tn) + 2.2 * mm) > xr - 2 * mm:
            tn -= 0.25
        for n in ("CP1", "CP2", "CE1", "CE2", "CM1", "CM2"):
            xx += self._case(xx, yy, d.get("niveau") == n) + 0.8 * mm
            xx += self._txt(xx, yy, n, self.FB, tn) + 2.2 * mm
        yy -= 9 * mm
        self._txt(xm, yy, f"Classe : {d.get('classe', '')}    Matricule école : {d.get('matricule_ecole', '')}",
                  self.F, 9.5, maxw=xr - xm - 3 * mm)
        yy -= 9 * mm
        self._txt(xm, yy, "NUMÉRO MATRICULE :", self.FB, 10.5)
        bx = xm + stringWidth("NUMÉRO MATRICULE :", self.FB, 10.5) + 3 * mm
        bw = min(48 * mm, xr - bx - 3 * mm)
        c.setLineWidth(1.4)
        c.rect(bx, yy - 3 * mm, bw, 9 * mm, stroke=1, fill=0)
        self._txt(bx + bw / 2, yy, d.get("matricule_desps") or "", self.FB, 11, "center", maxw=bw - 2 * mm)
        c.setLineWidth(1)
        y = top - max(ph, 15 * mm + qr) - 7 * mm * k

        # ---------------------------------------------------- identité
        pas = 8 * mm * k
        xi = x0 + 2 * mm
        self._champ(xi, y, "NOM :", d.get("nom_famille"), xf)
        y -= pas
        self._champ(xi, y, "PRÉNOM(S) :", d.get("prenoms"), xf)
        y -= pas
        w3 = (xf - xi) / 3
        self._champ(xi, y, "Né(e) le :", _date(d.get("date_naissance")), xi + w3 * 0.95)
        self._champ(xi + w3, y, "à :", d.get("lieu_naissance"), xi + w3 * 1.95)
        self._champ(xi + w3 * 2, y, "S/P :", d.get("sous_prefecture"), xf)
        y -= pas
        self._champ(xi, y, "Nationalité :", d.get("nationalite"), xi + w3 * 0.95)
        self._champ(xi + w3, y, "Groupe sanguin :", d.get("groupe_sanguin"), xi + w3 * 1.95)
        self._champ(xi + w3 * 2, y, "Allergies / handicap :", d.get("allergies"), xf)
        y -= pas
        self._champ(xi, y, "Acte de naissance / Jugement supplétif N° :", d.get("acte_num"), xi + w3 * 1.55, 10)
        self._champ(xi + w3 * 1.6, y, "Du :", _date(d.get("acte_date")), xi + w3 * 2.15, 10)
        self._champ(xi + w3 * 2.2, y, "Délivré à :", d.get("centre_etat_civil"), xf, 10)
        y -= pas + 2 * mm * k

        # ---------------------------------------------------- parents
        wc = (xf - xi) / 3
        for i, p in enumerate(d.get("parents") or []):
            cx = xi + i * wc
            tw = self._txt(cx + wc / 2, y, p["titre"], self.FB, 10.5, "center")
            c.line(cx + wc / 2 - tw / 2, y - 1.5, cx + wc / 2 + tw / 2, y - 1.5)
            yy = y - 7 * mm * k
            for lab, cle in (("NOM :", "nom"), ("PRÉNOM(S) :", "prenoms"), ("DOMICILE :", "domicile"),
                             ("CONTACT :", "contact"), ("PROFESSION :", "profession")):
                self._champ(cx + 1.5 * mm, yy, lab, p.get(cle), cx + wc - 3 * mm, 9.5)
                yy -= 6.6 * mm * k
        y -= (7 * mm + 5 * 6.6 * mm + 1 * mm) * k

        # ---------------------------------------------------- scolarité
        sco = list(d.get("scolarite") or [])[-8:]
        w0 = 44 * mm
        wcol = (W - 2 * m - w0) / 8
        xt = x0
        h1, h2, h3 = 7 * mm, 7 * mm, 15 * mm
        haut = y
        c.setFillColor(colors.HexColor("#A6A6A6"))
        c.rect(xt, haut - h1, W - 2 * m, h1, stroke=0, fill=1)
        c.setLineWidth(1.2)
        c.rect(xt, haut - h1 - h2 - h3, W - 2 * m, h1 + h2 + h3, stroke=1, fill=0)
        c.setLineWidth(0.6)
        c.line(xt, haut - h1, xt + W - 2 * m, haut - h1)
        c.line(xt, haut - h1 - h2, xt + W - 2 * m, haut - h1 - h2)
        for n in range(9):
            xk = xt + w0 + n * wcol
            c.line(xk, haut, xk, haut - h1 - h2 - h3)
        self._txt(xt + 2 * mm, haut - 4.8 * mm, "ANNÉE SCOLAIRE", self.FB, 8.5)
        self._txt(xt + w0 / 2, haut - h1 - 4.8 * mm, "Année de scolarité", self.FI, 8.5, "center")
        for j, lib in enumerate(("Niveau de cours", "Moyenne annuelle", "Effectif de la classe")):
            self._txt(xt + 2 * mm, haut - h1 - h2 - 4.2 * mm - j * 4.6 * mm, lib, self.FB, 7.8)
        for n in range(8):
            xc = xt + w0 + n * wcol + wcol / 2
            s = sco[n] if n < len(sco) else None
            self._txt(xc, haut - 4.8 * mm, s["annee"].replace("-", "/") if s else "20…/20…", self.FB, 8, "center",
                      maxw=wcol - 1 * mm)
            self._txt(xc, haut - h1 - 4.8 * mm, ORDINAUX[n], self.FI, 8.5, "center")
            vals = ["……", "……", "……"]
            if s:
                moy = E.fmt(s["moyenne"], "decimal") if s.get("moyenne") is not None else "–"
                vals = [s["niveau"] or s["classe"], moy, str(s.get("effectif") or "–")]
            for j, v in enumerate(vals):
                self._txt(xc, haut - h1 - h2 - 4.2 * mm - j * 4.6 * mm, v, self.F if s else self.FB, 8, "center",
                          maxw=wcol - 1 * mm)
        y = haut - h1 - h2 - h3 - 7 * mm * k

        # ---------------------------------------------------- école
        self._champ(xi, y, "ÉCOLE :", d.get("ecole"), xi + (xf - xi) * 0.47)
        self._champ(xi + (xf - xi) * 0.5, y, "VILLE / SOUS-PRÉFECTURE :", d.get("ville"), xf)
        y -= 7.5 * mm * k
        self._champ(xi, y, "Fréquentée du :", _date(d.get("frequente_du")), xi + w3 * 0.95)
        self._champ(xi + w3, y, "au :", _date(d.get("frequente_au")), xi + w3 * 1.95)
        self._champ(xi + w3 * 2, y, "Matricule :", d.get("matricule_ecole"), xf)
        y -= 7.5 * mm * k
        self._champ(xi, y, "Motif de départ :", d.get("motif_depart"), xf)
        y -= 7.5 * mm * k
        v = doc.variables
        fait = f"Fait à {d.get('ville') or v.get('localite', '')}, le {v.get('date_jour', '')}"
        self._txt(xf, y, fait, self.FI, 10.5, "right")
        y -= 4 * mm * k

        # ---------------------------------------------------- signatures
        hb = max(14 * mm, min(30 * mm, y - 2 * mm))
        wb = (xf - xi - 8 * mm) / 3
        noms = ["", d.get("enseignant") or "", d.get("directeur") or v.get("directeur", "")]
        for i, t in enumerate(("Le Parent / Tuteur", "L'Enseignant(e)", "Le Directeur de l'école")):
            bx = xi + i * (wb + 4 * mm)
            c.setLineWidth(1)
            c.roundRect(bx, y - hb, wb, hb, 2.5 * mm, stroke=1, fill=0)
            tw = self._txt(bx + wb / 2, y - 5 * mm, t, self.FB, 9.5, "center")
            c.line(bx + wb / 2 - tw / 2, y - 5 * mm - 1.5, bx + wb / 2 + tw / 2, y - 5 * mm - 1.5)
            if noms[i]:
                self._txt(bx + wb / 2, y - hb + 3 * mm, noms[i], self.F, 8.5, "center", maxw=wb - 3 * mm)
