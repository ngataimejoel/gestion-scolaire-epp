"""Couleurs et feuille de style de l'interface (reprises de la maquette validée)."""
from __future__ import annotations

SIDEBAR = "#0A4D35"
SIDEBAR_HOVER = "#0F5C40"
PRIMAIRE = "#0E6646"
PRIMAIRE_FONCE = "#0A4D35"
FOND = "#F4F3EE"
CARTE = "#FFFFFF"
ACCENT = "#E8892F"
TEXTE = "#17231E"
DISCRET = "#55635C"
BORDURE = "#DAD8CF"
BORDURE_FORTE = "#C9C7BD"
SUCCES = "#1E7B4F"
ALERTE = "#B7791F"
DANGER = "#B23A30"
INFO = "#2B6CB0"

POLICE = "Segoe UI"

# couleur des pastilles de statut : (fond, texte)
PASTILLES = {
    "PRESENT": ("#E3F1E9", SUCCES), "ADMIS": ("#E3F1E9", SUCCES), "ACCORDEE": ("#E3F1E9", SUCCES),
    "ABANDON": ("#FBE4E2", DANGER), "EXCLU": ("#FBE4E2", DANGER), "REFUSEE": ("#FBE4E2", DANGER),
    "TRANSFERE": ("#E6EEF8", INFO), "REDOUBLE": ("#FDF0DF", ALERTE), "EN_ATTENTE": ("#FDF0DF", ALERTE),
    "OUI": ("#E3F1E9", SUCCES), "NON": ("#FBE4E2", DANGER),
}

QSS = f"""
* {{ font-family: "{POLICE}", "Source Sans 3", "Segoe UI", sans-serif; font-size: 10pt; color: {TEXTE}; }}
QMainWindow, QDialog, #page {{ background: {FOND}; }}
QToolTip {{ background: {TEXTE}; color: white; border: none; padding: 4px 6px; }}

#sidebar {{ background: {SIDEBAR}; }}
#sidebar QLabel {{ color: #E6F0EB; }}
#marque {{ color: white; font-size: 12pt; font-weight: 700; }}
#marqueSous {{ color: #A9C9BA; font-size: 8.5pt; }}
#menu {{ background: transparent; border: none; outline: none; }}
#menu::item {{ color: #DCEAE3; padding: 8px 12px; border-radius: 6px; margin: 1px 8px; }}
#menu::item:hover {{ background: {SIDEBAR_HOVER}; }}
#menu::item:selected {{ background: {PRIMAIRE}; color: white; border-left: 3px solid {ACCENT}; }}
#sidebarPied {{ color: #A9C9BA; font-size: 8.5pt; }}

#barre {{ background: {CARTE}; border-bottom: 1px solid {BORDURE}; }}
#titrePage {{ font-size: 15pt; font-weight: 700; }}
#sousTitre, .discret, QLabel[discret="true"] {{ color: {DISCRET}; }}
#badgeLicence {{ border-radius: 10px; padding: 2px 10px; font-size: 8.5pt; font-weight: 600; }}

QFrame#carte {{ background: {CARTE}; border: 1px solid {BORDURE}; border-radius: 8px; }}
QLabel#kpiValeur {{ font-size: 20pt; font-weight: 700; color: {PRIMAIRE_FONCE}; }}
QLabel#kpiTitre {{ color: {DISCRET}; font-size: 9pt; }}
QLabel#titreCarte {{ font-weight: 700; font-size: 10.5pt; }}

QPushButton {{ background: {CARTE}; border: 1px solid {BORDURE_FORTE}; border-radius: 6px; padding: 6px 14px; }}
QPushButton:hover {{ border-color: {PRIMAIRE}; }}
QPushButton:disabled {{ color: #9AA49F; background: #F0EFEA; }}
QPushButton[role="primaire"] {{ background: {PRIMAIRE}; color: white; border: 1px solid {PRIMAIRE}; font-weight: 600; }}
QPushButton[role="primaire"]:hover {{ background: {PRIMAIRE_FONCE}; }}
QPushButton[role="primaire"]:disabled {{ background: #8FB5A5; border-color: #8FB5A5; color: #EEF4F1; }}
QPushButton[role="accent"] {{ background: {ACCENT}; color: white; border: 1px solid {ACCENT}; font-weight: 600; }}
QPushButton[role="danger"] {{ color: {DANGER}; border-color: #E2B4AF; }}
QPushButton[role="danger"]:hover {{ background: #FBE4E2; }}

QLineEdit, QComboBox, QDateEdit, QSpinBox, QDoubleSpinBox, QPlainTextEdit, QTextEdit {{
    background: white; border: 1px solid {BORDURE_FORTE}; border-radius: 5px; padding: 4px 6px; }}
QLineEdit:focus, QComboBox:focus, QDateEdit:focus, QPlainTextEdit:focus, QTextEdit:focus,
QSpinBox:focus, QDoubleSpinBox:focus {{ border: 1px solid {PRIMAIRE}; }}
QComboBox {{ min-width: 7em; }}
QLineEdit[erreur="true"], QComboBox[erreur="true"], QDateEdit[erreur="true"] {{ border: 1px solid {DANGER}; background: #FFF6F5; }}

QTableView {{ background: white; border: 1px solid {BORDURE}; border-radius: 6px; gridline-color: #ECEBE5;
    selection-background-color: #D8EBE1; selection-color: {TEXTE}; alternate-background-color: #FAFAF7; }}
QHeaderView::section {{ background: #EEF3F0; color: {PRIMAIRE_FONCE}; font-weight: 600; border: none;
    border-right: 1px solid #DDE6E1; border-bottom: 1px solid {BORDURE}; padding: 5px 6px; }}
QTabWidget::pane {{ border: 1px solid {BORDURE}; border-radius: 6px; background: white; top: -1px; }}
QTabBar::tab {{ padding: 6px 14px; border: 1px solid transparent; color: {DISCRET}; }}
QTabBar::tab:selected {{ color: {PRIMAIRE_FONCE}; border-bottom: 2px solid {PRIMAIRE}; font-weight: 600; }}
QGroupBox {{ border: 1px solid {BORDURE}; border-radius: 6px; margin-top: 12px; padding-top: 8px; background: white; }}
QGroupBox::title {{ subcontrol-origin: margin; left: 10px; padding: 0 4px; color: {PRIMAIRE_FONCE}; font-weight: 600; }}
QScrollArea {{ border: none; background: transparent; }}
QProgressBar {{ border: 1px solid {BORDURE}; border-radius: 5px; background: white; text-align: center; height: 14px; }}
QProgressBar::chunk {{ background: {PRIMAIRE}; border-radius: 4px; }}
#bandeauEssai {{ background: #FDF0DF; border-bottom: 1px solid #F1D2A8; }}
#bandeauEssai QLabel {{ color: #7A4A12; }}
#bandeauArchive {{ background: #E6EEF8; border-bottom: 1px solid #C5D5EA; }}
#bandeauArchive QLabel {{ color: #1F4E79; }}
"""
