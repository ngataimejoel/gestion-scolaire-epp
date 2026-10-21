/* =====================================================================================
   Autorisations par rôle (rôles existants d'AKWA SCHOOL : directeur, enseignant,
   enseignant « espace seul » qui tient sa classe sans école rattachée).

   Les opérations métier appellent AK.perm.exiger(action, contexte) AVANT de modifier quoi que
   ce soit : masquer un bouton ne suffit pas. L'interface utilise AK.perm.peut() pour n'afficher
   que les actions permises.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const sess = () => AK.session;

  /* Contexte : { classe } pour les actions limitées aux classes de l'enseignant. */
  const saClasse = (ctx) => !ctx || !ctx.classe || sess().classes().includes(ctx.classe);
  const ENS = (ctx) => saClasse(ctx);
  const SOLO = (ctx) => sess().solo() && saClasse(ctx);
  const NON = () => false;

  /* Règle pour un enseignant (le directeur peut tout faire). */
  const REGLES = {
    'eleve.voir': ENS,
    'eleve.inscrire': SOLO,
    'eleve.modifier': SOLO,
    'eleve.supprimer': SOLO,
    'eleve.statut': SOLO,
    'eleve.importer': SOLO,
    'personnel.voir': NON,
    'personnel.gerer': NON,
    'classe.affecter': NON,
    'notes.saisir': ENS,
    'notes.corriger': NON,          // correction d'une note validée : directeur
    'notes.valider': NON,
    'notes.matieres': SOLO,
    'notes.periode': NON,
    'resultats.voir': ENS,
    'decision.modifier': NON,
    'annee.passer': NON,
    'appel.faire': ENS,
    'appel.lever': NON,             // effacer une absence déjà saisie
    'autorisation.demander': () => true,
    'autorisation.decider': NON,
    'autorisation.supprimer': NON,
    'vie.utiliser': ENS,
    'vie.supprimer': NON,
    'finances.gerer': NON,
    'services.utiliser': () => true,
    'liaison.gerer': NON,
    'rapports.officiels': NON,
    'rapports.generateur': NON,
    'stats.voir': NON,
    'document.imprimerClasse': ENS, // listes, bulletins et fiches de sa classe
    'document.ecole': SOLO,         // listes et rapports de toute l'école
    'document.emettre': NON,        // certificats, attestations, cartes : directeur
    'document.annuler': NON,
    'document.registre': NON,
    'modeles.gerer': NON,
    'cles.gerer': NON,
    'parametres.gerer': NON,
    'securite.gerer': NON,
    'comptes.gerer': NON,
    'messages.envoyer': NON,
    'donnees.sauvegarder': SOLO,
    'donnees.restaurer': SOLO,
    'donnees.exporter': SOLO,
    'donnees.rattacher': NON,
    'journal.voir': NON,
    'verification.utiliser': () => true
  };

  const perm = {
    peut(action, ctx) {
      const s = sess().courante();
      if (!s) return false;
      if (s.role === 'dir') return true;
      const r = REGLES[action];
      if (!r) {
        AK.diag.avert('Action sans règle de droits : ' + action);
        return false;
      }
      return !!r(ctx || null);
    },
    exiger(action, ctx) {
      if (!perm.peut(action, ctx)) throw new AK.ErreurDroits(MESSAGES[action] || undefined);
    },
    actions: () => Object.keys(REGLES)
  };
  const MESSAGES = {
    'eleve.inscrire': 'L’inscription des élèves est réservée au directeur.',
    'eleve.modifier': 'Seul le directeur peut modifier un élève.',
    'eleve.supprimer': 'Seul le directeur peut supprimer un élève.',
    'eleve.statut': 'Seul le directeur peut changer le statut d’un élève.',
    'personnel.gerer': 'Seul le directeur peut modifier le personnel.',
    'classe.affecter': 'Seul le directeur affecte les classes.',
    'notes.saisir': 'Vous ne pouvez saisir que les notes de votre classe.',
    'notes.corriger': 'Seul le directeur peut corriger une note validée.',
    'notes.matieres': 'Seul le directeur choisit les matières de la composition.',
    'autorisation.decider': 'Seul le directeur accorde ou refuse une demande.',
    'autorisation.supprimer': 'Seul le directeur peut supprimer une demande.',
    'appel.lever': 'Une absence enregistrée ne peut être levée que par le directeur.',
    'document.emettre': 'L’émission des documents officiels est réservée au directeur.',
    'document.annuler': 'Seul le directeur peut annuler un document.'
  };
  AK.perm = perm;
})(window.AK);
