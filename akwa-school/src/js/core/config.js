/* =====================================================================================
   Réglages métier (repris d'AKWA SCHOOL 1.7.0 sans changement de règle) :
   niveaux, grilles de notation, calendrier des évaluations, listes de choix, en-tête officiel.
   Les réglages propres à une école (nom, logos, année…) sont dans les données (S.school).
   ===================================================================================== */
(function (AK) {
  'use strict';
  const C = {};

  C.TOUS_NIVEAUX = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
  C.AGE_NORMAL = { CP1: 6, CP2: 7, CE1: 8, CE2: 9, CM1: 10, CM2: 11 };

  /* Grilles : COEF = note sur 10 avec coefficient ; BAREME = note sur le barème de la matière */
  C.CP_MATIERES = ['ECRITURE', 'E.D.H.C', 'EXPRESSION ECRITE', 'MATHEMATIQUE', 'ORTHOGRAPHE', 'DESSIN', 'CHANT ET POESIE', 'LECTURE'];
  C.GRILLES = {
    CP: { lib: 'CP1 et CP2', mode: 'COEF', echelle: 10, max: 10, mat: () => C.CP_MATIERES.map((m) => [m, 1]) },
    CE1: { lib: 'CE1', mode: 'BAREME', echelle: 10, mat: () => [['EXPLOITATION DE TEXTE', 50], ['EVEIL AU MILIEU', 40], ['MATHEMATIQUES', 40], ['DICTEE', 10]] },
    'CE2-CM1': { lib: 'CE2 et CM1', mode: 'BAREME', echelle: 10, mat: () => [['EXPLOITATION DE TEXTE', 50], ['EVEIL AU MILIEU', 50], ['MATHEMATIQUES', 50], ['DICTEE', 20]] },
    CM2: {
      lib: 'CM2', mode: 'BAREME', echelle: 20,
      mat: (n) => [['EXPLOITATION DE TEXTE', 50], ['EVEIL AU MILIEU', 50], ['MATHEMATIQUES', 50], ['DICTEE', 20], ...(n >= 3 ? [['EPREUVES PHYSIQUES', 20]] : [])]
    }
  };
  /* Classe : grille, seuil d'admission, barème de la MGA, calendrier, règle de la MGA */
  C.CLASSE_INFO = {
    CP1: { grille: 'CP', seuil: 5, bareme: 10, cal: 'STD', regle: 'STANDARD' },
    CP2: { grille: 'CP', seuil: 5, bareme: 10, cal: 'STD', regle: 'STANDARD' },
    CE1: { grille: 'CE1', seuil: 5, bareme: 10, cal: 'STD', regle: 'STANDARD' },
    CE2: { grille: 'CE2-CM1', seuil: 5, bareme: 10, cal: 'STD', regle: 'STANDARD' },
    CM1: { grille: 'CE2-CM1', seuil: 5, bareme: 10, cal: 'STD', regle: 'STANDARD' },
    CM2: { grille: 'CM2', seuil: 10, bareme: 20, cal: 'CM2', regle: 'MOYENNE4' }
  };
  C.EVALUATIONS = {
    STD: ['1re composition', '2e composition', '3e composition', 'Composition de passage'],
    CM2: ['1re composition', '2e composition', '1er examen blanc', '2e examen blanc']
  };
  /* mois, jour, années après la rentrée */
  C.EVAL_DATES = { STD: [[12, 9, 0], [3, 10, 1], [5, 26, 1], [6, 16, 1]], CM2: [[12, 9, 0], [3, 10, 1], [3, 4, 1], [4, 27, 1]] };
  C.EV_GEN = ['1re composition', '2e composition', '3e composition / 1er examen blanc (CM2)', 'Composition de passage / 2e examen blanc (CM2)'];
  C.evCourt = (n) => C.EV_GEN[n - 1].split(' /')[0];
  C.JOURS_MOIS = { 9: 13, 10: 22, 11: 21, 12: 17, 1: 20, 2: 15, 3: 23, 4: 15, 5: 21, 6: 22, 7: 12 };
  C.MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  C.JOURS_CLASSE = [1, 2, 4, 5]; // lundi, mardi, jeudi, vendredi (0 = dimanche, 3 = mercredi)

  C.MOTIFS = ['Maladie', 'Raison familiale', 'Décès d’un proche', 'Mariage', 'Naissance', 'Opération bancaire', 'Congé de maternité', 'Convocation IEPP', 'Formation', 'Autre'];
  C.DECISIONS = ['Admis', 'Redoublant', 'Abandon', 'Exclu', 'Transféré'];
  C.STATUTS = ['Inscrit', 'Abandon', 'Exclu', 'Transféré'];
  C.FONCTIONS = ['Directeur', 'Directrice', 'Adjoint au Directeur', 'Adjointe au Directeur', 'Instituteur', 'Institutrice', 'Instituteur adjoint', 'Institutrice adjointe', 'Agent', 'Autre'];
  C.GRADES = ['Instituteur ordinaire', 'Instituteur adjoint', 'Instituteur principal', 'Conseiller pédagogique', 'Bénévole'];
  C.FONCTS = [['simple', 'Simple'], ['jumelee', 'Jumelée'], ['multigrade', 'Multigrade'], ['autre', 'Autre']];
  C.CIVS = ['M.', 'Mme', 'Mlle'];
  C.PROF_P = ['Cultivateur', 'Commerçant', 'Planteur', 'Mécanicien', 'Éleveur', 'Enseignant', 'Transporteur', 'Menuisier', 'Infirmier', 'Tailleur'];
  C.PROF_M = ['Ménagère', 'Commerçante', 'Couturière', 'Cultivatrice', 'Coiffeuse', 'Enseignante', 'Restauratrice', 'Sage-femme'];
  C.SANG = ['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'];
  C.NAT_DEFAUT = 'IVOIRIENNE';
  C.STATUTS_ECOLE = [['publique', 'École publique'], ['privee', 'École privée']];

  /* En-tête officiel des documents (modifiable dans Paramètres) */
  C.ENTETE = {
    ministere: "MINISTERE DE L'EDUCATION NATIONALE, DE L'ALPHABETISATION ET DE L'ENSEIGNEMENT TECHNIQUE",
    direction: "DIRECTION REGIONALE DE L'EDUCATION NATIONALE, DE L'ALPHABETISATION ET DE L'ENSEIGNEMENT TECHNIQUE",
    inspection: "INSPECTION DE L'ENSEIGNEMENT PRESCOLAIRE ET PRIMAIRE",
    republique: "REPUBLIQUE DE CÔTE D'IVOIRE",
    devise: 'Union – Discipline – Travail'
  };
  /* École vierge : aucune valeur par défaut trompeuse (nom, DRENAET… demandés à la création) */
  C.ECOLE = {
    ...C.ENTETE, localite: '', sp: '', armoiries: '', name: '', statut: 'publique', iepp: '', drenaet: '',
    year: '', director: '', dirTel: '', secteur: '', inspNom: '', inspTel: '', cpNom: '', cpTel: '',
    evalCourante: 1, codedren: '', codeiep: '', codeecole: '', entete: '', adresse: '', telephone: '', email: '',
    accent: 'navy', theme: 'auto', logoEcole: '', logoIepp: '', niveaux: C.TOUS_NIVEAUX.slice(), validation: true, idLock: false
  };

  /* Téléphones : 10 chiffres commençant par 07 (Orange), 05 (MTN) ou 01 (Moov), indicatif +225 */
  C.TEL_ERR = '10 chiffres commençant par 07 (Orange), 05 (MTN) ou 01 (Moov), indicatif +225 facultatif.';

  /* Apparence : couleurs d'accent proposées (la structure reste bleu nuit) */
  C.ACCENTS = [
    ['navy', '#1F4E8C', 'Bleu AKWA'],
    ['green', '#1C6B4A', 'Vert'],
    ['amber', '#9A5212', 'Ambre'],
    ['plum', '#5E3A8C', 'Prune']
  ];

  /* ---------- Modules de gestion (vie scolaire, finances, services) ---------- */
  C.JOURS_EDT = [['1', 'Lundi'], ['2', 'Mardi'], ['4', 'Jeudi'], ['5', 'Vendredi']];
  C.CRENEAUX = ['07 h 30 – 08 h 30', '08 h 30 – 09 h 30', '09 h 30 – 10 h 00', '10 h 15 – 11 h 15', '11 h 15 – 12 h 00', '15 h 00 – 16 h 00', '16 h 00 – 17 h 00'];
  C.FAITS = ['Retards répétés', 'Bavardage en classe', 'Travail non fait', 'Insolence envers un enseignant', 'Bagarre dans la cour', 'Dégradation de matériel', 'Tricherie', 'Objet dangereux', 'Sortie sans autorisation', 'Autre'];
  C.SANCTIONS = ['Avertissement oral', 'Travail supplémentaire', 'Mot aux parents', 'Convocation des parents', 'Retenue', 'Exclusion temporaire (décision du conseil des maîtres)'];
  C.MAUX = ['Fièvre', 'Maux de tête', 'Maux de ventre', 'Blessure légère', 'Toux', 'Vomissements', 'Crise de paludisme suspectée', 'Saignement de nez', 'Autre'];
  C.SUITES_SOIN = ['Retour en classe', 'Repos à l’infirmerie', 'Parents prévenus', 'Remis aux parents', 'Orienté vers le centre de santé'];
  C.CAT_DEP = ['Fournitures scolaires', 'Entretien et réparations', 'Cantine', 'Équipement', 'Activités et fêtes', 'Hygiène et santé', 'Frais administratifs', 'Autre'];
  C.MODES_PAIE = ['Espèces', 'Mobile Money', 'Virement', 'Chèque'];
  C.OBJETS_PAIE = ['Cotisation COGES', 'Inscription', 'Tenue scolaire', 'Cantine', 'Autre'];
  C.PIECES_CEPE = [['extrait', 'Extrait de naissance'], ['photos', '4 photos d’identité'], ['certif', 'Certificat de scolarité'], ['frais', 'Frais d’examen réglés'], ['fiche', 'Fiche d’inscription signée']];
  C.GENRES = ['Manuel', 'Contes', 'Roman', 'Documentaire', 'Dictionnaire', 'Bande dessinée', 'Atlas'];
  C.SMS_MODELES = [
    ['Réunion des parents', 'Chers parents, une réunion se tiendra à l’école le [date] à [heure]. Votre présence est vivement souhaitée. La Direction.'],
    ['Absence de l’élève', 'Chers parents, votre enfant [élève] était absent(e) aujourd’hui. Merci de nous en indiquer le motif. La Direction.'],
    ['Rappel de cotisation', 'Chers parents, nous vous rappelons que la cotisation de [élève] reste à régler. Merci de passer à la direction. La Direction.'],
    ['Résultats de composition', 'Chers parents, les bulletins de la [composition] sont disponibles. Passez les retirer à l’école. La Direction.'],
    ['Message libre', '']
  ];

  /* ---------- Rapport d'infrastructures ---------- */
  C.INFRA0 = {
    bat: { agglo: '', prov: '' }, salles: { agglo: '', prov: '' },
    toil: { existe: '', eleves: { type: '', n: '', fonct: '', sep: '', nf: '', ng: '' }, ens: { type: '', n: '', fonct: '', sep: '' } },
    eau: { existe: '', forage: { n: '', fonct: '' }, puits: { n: '', fonct: '' }, robinet: { n: '', fonct: '' } },
    elec: { village: '', ecole: '', salles: '' }, loge: { existe: '', n: '' },
    mob: { tb: '', tbBon: '', bureaux: '', tableaux: '' }, cant: { existe: '', fonct: '', ration: '', partenaire: '' },
    locaux: { bureau: '', magasin: '', biblio: '', info: '', cloture: '', sport: '' }, manuels: {},
    acces: { dist: '', route: '', reseau: '', rampe: '', pharma: '' }, maj: ''
  };
  C.TOIL_T = ['Latrines simples', 'Latrines améliorées (VIP)', 'WC avec chasse d’eau', 'Autre'];
  C.EAUX = [['forage', 'Forage (pompe)'], ['puits', 'Puits'], ['robinet', 'Robinet']];
  C.LOCAUX = [['bureau', 'Bureau du directeur'], ['magasin', 'Magasin'], ['biblio', 'Bibliothèque'], ['info', 'Salle informatique'], ['cloture', 'Clôture', 1], ['sport', 'Terrain de sport']];
  C.ON = [['oui', 'Oui'], ['non', 'Non']];
  C.ONP = [...C.ON, ['partiel', 'En partie']];
  C.ROUTES = [['bonne', 'Bonne'], ['praticable', 'Praticable'], ['difficile', 'Difficile en saison des pluies']];
  C.RESEAUX = [['bon', 'Bon'], ['faible', 'Faible'], ['aucun', 'Aucun']];
  C.PARTS = ['État (DCS)', 'PAM', 'Communauté (COGES)', 'Autre'];

  /* ---------- Statistiques et import ---------- */
  C.BINS = ['≤5', '6', '7', '8', '9', '10', '11', '12', '≥13'];
  /* Colonnes de l'export national des élèves (fichier ELEVES), dans cet ordre */
  C.COLS_ELEVES = ['codedren', 'codeiep', 'iep', 'codeecole', 'ecole', 'matricule', 'nom', 'prenoms', 'sexe', 'jour', 'mois', 'annee', 'nationalite', 'localite', 'codesp', 'sp', 'pere', 'mere', 'nacte', 'lieuacte', 'residence', 'niveau'];
  C.MAT_COURT = { 'EXPLOITATION DE TEXTE': 'EXP. TEXTE', 'EVEIL AU MILIEU': 'EVEIL MILIEU', DICTEE: 'ORTH', MATHEMATIQUES: 'MATH', 'EPREUVES PHYSIQUES': 'EPS' };
  C.ORDRE_MAT = ['EXPLOITATION DE TEXTE', 'EVEIL AU MILIEU', 'DICTEE', 'MATHEMATIQUES', 'EPREUVES PHYSIQUES'];
  C.REPORTS = [['rentree', 'Rapport de rentrée'], ['compo', 'Rapport de composition'], ['mensuel', 'Rapport mensuel'], ['fin', 'Rapport de fin d’année'], ['cm2', 'Rapport CM2'], ['resultats', 'Rapport des notes par classe']];

  /* ---------- Sécurité ---------- */
  C.SECU = {
    PBKDF2_ITER: 310000,       // itérations PBKDF2-SHA-256 (empreintes de mots de passe)
    MDP_MIN: 8,                // longueur minimale d'un nouveau mot de passe
    VERROU_MIN: 15,            // verrouillage automatique après inactivité (minutes)
    GRACE_SEC: 180,            // délai pendant lequel une confirmation par mot de passe reste valable
    ALPHABET_CODE: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'  // codes lisibles : ni 0/O ni 1/I
  };

  AK.cfg = C;
})(window.AK);
