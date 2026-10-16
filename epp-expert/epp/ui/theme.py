"""Couleurs et feuille de style de l'interface (reprises du prototype AKWA SCHOOL v6)."""
from __future__ import annotations

PRIMAIRE = "#0E6646"            # vert AKWA
PRIMAIRE_FONCE = "#0A4D35"
PRIMAIRE_PALE = "#E3EEE8"       # fond des éléments actifs (vert à 12 %)
ACCENT = "#E8892F"              # orange AKWA
ACCENT_FONCE = "#9C520D"
FOND = "#F2F4EF"
CARTE = "#FFFFFF"
CREUX = "#E9EDE6"               # zones en creux (onglets en pastilles, survols)
TEXTE = "#14201A"
DISCRET = "#5A6961"
BORDURE = "#DCE3DA"
BORDURE_FORTE = "#C8D1C6"
SUCCES = "#11804F"
ALERTE = "#9F5C06"
DANGER = "#BF3A33"
INFO = "#2B6CB0"
GARCONS = "#08704B"             # graphiques : garçons / filles
FILLES = "#CC6E16"

# anciens noms (barre latérale sombre de la version 1.0.0)
SIDEBAR = CARTE
SIDEBAR_HOVER = CREUX

POLICE = "Segoe UI"

# couleur des pastilles de statut : (fond, texte)
PASTILLES = {
    "PRESENT": ("#E1F0E8", SUCCES), "ADMIS": ("#E1F0E8", SUCCES), "ACCORDEE": ("#E1F0E8", SUCCES),
    "ABANDON": ("#F8E3E1", DANGER), "EXCLU": ("#F8E3E1", DANGER), "REFUSEE": ("#F8E3E1", DANGER),
    "TRANSFERE": ("#E6EEF8", INFO), "REDOUBLE": ("#F6ECDD", ALERTE), "EN_ATTENTE": ("#F6ECDD", ALERTE),
    "OUI": ("#E1F0E8", SUCCES), "NON": ("#F8E3E1", DANGER),
}

QSS = f"""
* {{ font-family: "Segoe UI Variable Text", "{POLICE}", "Source Sans 3", sans-serif; font-size: 10pt; color: {TEXTE}; }}
QMainWindow, QDialog, #page, #volet, #contenu {{ background: {FOND}; }}
QToolTip {{ background: {TEXTE}; color: white; border: none; padding: 4px 6px; border-radius: 4px; }}

/* ---------- barre latérale ---------- */
#sidebar {{ background: {CARTE}; border-right: 1px solid {BORDURE}; }}
#marque {{ font-size: 11.5pt; font-weight: 700; letter-spacing: 1px; }}
#marqueSous {{ color: {DISCRET}; font-size: 8.5pt; }}
QPushButton#navGroupe {{ background: transparent; border: none; border-radius: 10px; padding: 8px 10px;
    text-align: left; color: {DISCRET}; font-weight: 600; }}
QPushButton#navGroupe:hover {{ background: {CREUX}; color: {TEXTE}; }}
QPushButton#navGroupe:checked {{ background: transparent; color: {PRIMAIRE}; }}
QPushButton#navSous {{ background: transparent; border: none; border-left: 2px solid {BORDURE};
    border-radius: 0; padding: 5px 12px; text-align: left; color: {DISCRET}; font-size: 9.5pt; }}
QPushButton#navSous:hover {{ color: {TEXTE}; }}
QPushButton#navSous:checked {{ color: {TEXTE}; font-weight: 600; border-left: 2px solid {ACCENT}; }}
QLabel#raccourci {{ color: #98A59E; font-size: 8pt; }}
#carteEcole {{ background: {CREUX}; border-radius: 12px; }}
#carteEcole QLabel {{ color: {DISCRET}; font-size: 8.5pt; }}
#carteEcole QLabel#carteEcoleNom {{ color: {TEXTE}; font-size: 9.5pt; font-weight: 600; }}
#sidebarPied {{ color: {DISCRET}; font-size: 8.5pt; }}

/* ---------- barre du haut ---------- */
#barre {{ background: {FOND}; border-bottom: 1px solid {BORDURE}; }}
#fil {{ color: {DISCRET}; }}
QLineEdit#recherche {{ border-radius: 10px; padding: 6px 10px; background: {CARTE}; }}
#resultatsRecherche {{ background: {CARTE}; border: 1px solid {BORDURE}; border-radius: 12px; }}
#resultatsRecherche QListWidget {{ border: none; background: transparent; outline: none; }}
#resultatsRecherche QListWidget::item {{ padding: 6px 8px; border-radius: 8px; }}
#resultatsRecherche QListWidget::item:selected, #resultatsRecherche QListWidget::item:hover {{
    background: {CREUX}; color: {TEXTE}; }}
#titrePage {{ font-size: 16pt; font-weight: 700; }}
#sousTitre, .discret, QLabel[discret="true"] {{ color: {DISCRET}; }}
#badgeLicence {{ border-radius: 10px; padding: 3px 10px; font-size: 8.5pt; font-weight: 600; }}
QToolButton#compte {{ border: 1px solid {BORDURE}; border-radius: 10px; padding: 5px 10px; background: {CARTE}; }}
QToolButton#compte::menu-indicator {{ image: none; }}

/* ---------- volets : onglets soulignés ---------- */
QTabWidget#volet::pane, QTabWidget#ongletsAdmin::pane {{ border: none; background: {FOND}; }}
QTabWidget#volet > QTabBar, QTabWidget#ongletsAdmin > QTabBar {{ background: {FOND}; }}
QTabWidget#volet > QTabBar::tab, QTabWidget#ongletsAdmin > QTabBar::tab {{ padding: 10px 16px; margin: 0;
    border: none; border-bottom: 2px solid transparent; color: {DISCRET}; font-weight: 600; background: {FOND}; }}
QTabWidget#volet > QTabBar::tab:hover, QTabWidget#ongletsAdmin > QTabBar::tab:hover {{ color: {TEXTE}; }}
QTabWidget#volet > QTabBar::tab:selected, QTabWidget#ongletsAdmin > QTabBar::tab:selected {{
    color: {PRIMAIRE}; border-bottom: 2px solid {PRIMAIRE}; }}

/* ---------- cartes et indicateurs ---------- */
QFrame#carte, QFrame#kpi {{ background: {CARTE}; border: 1px solid {BORDURE}; border-radius: 14px; }}
QFrame#kpi:hover {{ border-color: {PRIMAIRE}; }}
QLabel#kpiValeur {{ font-size: 21pt; font-weight: 700; }}
QLabel#kpiTitre {{ color: {DISCRET}; font-size: 9pt; font-weight: 600; }}
QLabel#titreCarte {{ font-weight: 700; font-size: 10.5pt; }}
QFrame#hero {{ background: {PRIMAIRE}; border-radius: 18px; }}
QFrame#hero QLabel {{ color: white; }}
QLabel#heroTitre {{ font-size: 18pt; font-weight: 700; }}
QLabel#puce {{ background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.22); border-radius: 10px;
    padding: 2px 10px; font-size: 8.5pt; font-weight: 600; }}
QLabel#puceOrange {{ background: {ACCENT}; color: #1D1205; border-radius: 10px; padding: 2px 10px;
    font-size: 8.5pt; font-weight: 600; }}
QPushButton#actionHero {{ background: rgba(255,255,255,0.10); color: white; border: 1px solid rgba(255,255,255,0.28);
    border-radius: 11px; padding: 8px 13px; font-weight: 600; }}
QPushButton#actionHero:hover {{ background: rgba(255,255,255,0.20); }}
QPushButton#actionHeroBlanc {{ background: white; color: #0B3D2A; border: 1px solid white; border-radius: 11px;
    padding: 8px 13px; font-weight: 600; }}
QPushButton#ligneListe {{ background: transparent; border: none; border-bottom: 1px solid {BORDURE};
    border-radius: 0; padding: 8px 4px; text-align: left; }}
QPushButton#ligneListe:hover {{ background: {CREUX}; }}
QLabel#etiquette {{ border-radius: 9px; padding: 1px 8px; font-size: 8pt; font-weight: 700; }}

/* ---------- boutons et champs ---------- */
QPushButton {{ background: {CARTE}; border: 1px solid {BORDURE}; border-radius: 10px; padding: 6px 13px;
    font-weight: 600; }}
QPushButton:hover {{ border-color: {PRIMAIRE}; color: {PRIMAIRE}; }}
QPushButton:disabled {{ color: #9AA49F; background: #F0F2EE; }}
QPushButton[role="primaire"] {{ background: {PRIMAIRE}; color: white; border: 1px solid {PRIMAIRE}; }}
QPushButton[role="primaire"]:hover {{ background: {PRIMAIRE_FONCE}; color: white; }}
QPushButton[role="primaire"]:disabled {{ background: #8FB5A5; border-color: #8FB5A5; color: #EEF4F1; }}
QPushButton[role="accent"] {{ background: {ACCENT}; color: white; border: 1px solid {ACCENT}; }}
QPushButton[role="accent"]:hover {{ color: white; background: #D27A26; }}
QPushButton[role="danger"] {{ color: {DANGER}; }}
QPushButton[role="danger"]:hover {{ border-color: {DANGER}; background: #FBE9E7; }}
QPushButton[role="lien"] {{ border: none; background: transparent; color: {PRIMAIRE}; padding: 2px 4px; }}
QToolButton {{ border-radius: 8px; }}

QLineEdit, QComboBox, QDateEdit, QSpinBox, QDoubleSpinBox, QPlainTextEdit, QTextEdit {{
    background: {CARTE}; border: 1px solid {BORDURE_FORTE}; border-radius: 8px; padding: 5px 8px; }}
QLineEdit:focus, QComboBox:focus, QDateEdit:focus, QPlainTextEdit:focus, QTextEdit:focus,
QSpinBox:focus, QDoubleSpinBox:focus {{ border: 1px solid {PRIMAIRE}; }}
QComboBox {{ min-width: 7em; }}
QLineEdit[erreur="true"], QComboBox[erreur="true"], QDateEdit[erreur="true"] {{ border: 1px solid {DANGER}; background: #FFF6F5; }}

/* ---------- tableaux ---------- */
QTableView::item:hover {{ background: #EEF5F0; }}
QTableView::item:selected {{ background: #D9EADF; color: {TEXTE}; }}
QTableView {{ background: {CARTE}; border: 1px solid {BORDURE}; border-radius: 12px; gridline-color: {BORDURE};
    selection-background-color: #D9EADF; selection-color: {TEXTE}; alternate-background-color: #F8FAF6; }}
QHeaderView::section {{ background: {CREUX}; color: {DISCRET}; font-weight: 700; font-size: 8.5pt; border: none;
    border-bottom: 1px solid {BORDURE}; padding: 7px 8px; }}
QTabWidget::pane {{ border: 1px solid {BORDURE}; border-radius: 12px; background: {CARTE}; top: -1px; }}
QTabBar::tab {{ padding: 7px 14px; border: 1px solid transparent; color: {DISCRET}; font-weight: 600; }}
QTabBar::tab:selected {{ color: {PRIMAIRE}; border-bottom: 2px solid {PRIMAIRE}; }}
QGroupBox {{ border: 1px solid {BORDURE}; border-radius: 12px; margin-top: 12px; padding-top: 8px; background: {CARTE}; }}
QGroupBox::title {{ subcontrol-origin: margin; left: 10px; padding: 0 4px; color: {PRIMAIRE}; font-weight: 700; }}
QScrollArea {{ border: none; background: transparent; }}
QProgressBar {{ border: 1px solid {BORDURE}; border-radius: 5px; background: {CARTE}; text-align: center; height: 14px; }}
QProgressBar::chunk {{ background: {PRIMAIRE}; border-radius: 4px; }}
QListWidget, QTreeWidget {{ background: {CARTE}; border: 1px solid {BORDURE}; border-radius: 10px; }}
QTreeWidget::item, QListWidget::item {{ padding: 3px 2px; }}
QTreeWidget::item:selected, QListWidget::item:selected {{ background: {PRIMAIRE_PALE}; color: {PRIMAIRE}; }}

/* ---------- bandeaux ---------- */
#bandeauEssai {{ background: #FBEEDD; border-bottom: 1px solid #F1D2A8; }}
#bandeauEssai QLabel {{ color: #7A4A12; }}
#bandeauArchive {{ background: #E6EEF8; border-bottom: 1px solid #C5D5EA; }}
#bandeauArchive QLabel {{ color: #1F4E79; }}

/* ---------- fiche détaillée (panneau à droite) ---------- */
QFrame#tiroir {{ background: {CARTE}; border-left: 1px solid {BORDURE}; }}
QLabel#tiroirNom {{ font-size: 14pt; font-weight: 700; }}
"""
