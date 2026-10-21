/* =====================================================================================
   Élèves & classes : registre des élèves (filtres, tri, pagination, sélection, export),
   formulaire d'inscription par onglets (contrôle des doublons), fiche élève (tiroir),
   départ et statut, suppression vers la corbeille, classes, import Excel avec aperçu.
   Les droits sont vérifiés par les fonctions métier (AK.eleves) : masquer un bouton n'est
   qu'un confort d'affichage.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, F = AK.ui.champ;
  const S = () => AK.store.etat;
  const X = () => AK.calc;
  const peut = (a, ctx) => AK.perm.peut(a, ctx);

  const DOSSIERS = [['sans', 'Sans extrait'], ['avec', 'Avec extrait'], ['age', 'Âge à vérifier'], ['photo', 'Sans photo']];
  const filtreDossier = (s, d) => (d === 'sans' ? !s.extrait : d === 'avec' ? s.extrait : d === 'age' ? X().ageAnormal(s) : d === 'photo' ? !s.photo : true);

  function elevesFiltres(p) {
    const cl = AK.session.classes();
    const st = p.statut == null ? 'Inscrit' : p.statut;
    return S().students.filter((s) => cl.includes(s.classe) && (!p.classe || s.classe === p.classe) && (!st || s.statut === st) && (!p.dossier || filtreDossier(s, p.dossier)));
  }

  /* ---------- Registre des élèves ---------- */
  function rendreListe(p) {
    const x = X(), L = elevesFiltres(p);
    const dir = AK.session.estDirecteur();
    const filtres = html`<select class="inp inp-sm" data-change="eleves-filtre" data-f="classe" aria-label="Classe">${ui.options(AK.session.classes(), p.classe, 'Toutes les classes')}</select>
      <select class="inp inp-sm" data-change="eleves-filtre" data-f="statut" aria-label="Statut">${ui.options([['', 'Tous les statuts'], ...C.STATUTS.map((s) => [s, s])], p.statut == null ? 'Inscrit' : p.statut)}</select>
      <select class="inp inp-sm" data-change="eleves-filtre" data-f="dossier" aria-label="Dossier">${ui.options(DOSSIERS, p.dossier, 'Tous les dossiers')}</select>
      ${p.classe || p.dossier || (p.statut != null && p.statut !== 'Inscrit') ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="aller" data-route="eleves/liste">${ic('x')}Effacer les filtres</button>` : ''}`;
    const colonnes = [
      { cle: 'nom', lib: 'Élève', tri: (s) => x.nomComplet(s), rendu: (s) => ui.quiEleve(s), csv: (s) => x.nomComplet(s) },
      { cle: 'mat', lib: 'Matricule', tri: (s) => x.matOf(s), rendu: (s) => html`<span class="mono">${x.matOf(s)}</span>` },
      { cle: 'classe', lib: 'Classe', tri: (s) => C.TOUS_NIVEAUX.indexOf(s.classe), csv: (s) => s.classe, rendu: (s) => html`${ui.lienClasse(s.classe)}${s.redoublant ? html` <span class="tag" data-bulle="Redoublant">RED</span>` : ''}` },
      { cle: 'sexe', lib: 'Sexe', tri: (s) => s.sexe, rendu: (s) => (s.sexe === 'Masculin' ? 'G' : s.sexe === 'Féminin' ? 'F' : '—'), csv: (s) => s.sexe },
      { cle: 'age', lib: 'Âge', tri: (s) => x.ageDe(s), csv: (s) => x.ageDe(s) ?? '', rendu: (s) => html`${x.ageDe(s) ?? '—'} ans${x.ageAnormal(s) ? html` ${ui.tag('âge', 'avert')}` : ''}${s.ageEstime ? html` <span class="mut petit">(estimé)</span>` : ''}` },
      { cle: 'extrait', lib: 'Extrait de naissance', tri: (s) => (s.extrait ? 1 : 0), csv: (s) => (s.extrait ? `N° ${(s.acte && s.acte.num) || '?'} du ${u.fmtDate(s.acte && s.acte.date)}` : 'Non'), rendu: (s) => (s.extrait ? ui.tag(`N° ${(s.acte && s.acte.num) || '?'}`, 'ok', 'check') : ui.tag('Sans extrait', 'avert')) },
      { cle: 'statut', lib: 'Statut', tri: (s) => s.statut, rendu: (s) => ui.tagStatut(s.statut), csv: (s) => s.statut },
      { cle: 'act', lib: '', cls: 'droite', csv: false, rendu: (s) => html`<div class="ligne" style="justify-content:flex-end;flex-wrap:nowrap"><button type="button" class="btn-ic" data-action="eleve-documents" data-id="${s.id}" aria-label="Documents de ${x.nomComplet(s)}" data-bulle="Documents">${ic('file')}</button>${peut('eleve.modifier', { classe: s.classe }) ? html`<button type="button" class="btn-ic" data-action="eleve-modifier" data-id="${s.id}" aria-label="Modifier ${x.nomComplet(s)}" data-bulle="Modifier">${ic('edit')}</button>` : ''}<button type="button" class="btn-ic" data-action="eleve-plus" data-id="${s.id}" aria-label="Autres actions pour ${x.nomComplet(s)}" aria-haspopup="menu">${ic('more')}</button></div>` }
    ];
    const actionsSel = (ids) => html`<button type="button" class="btn btn-sm" data-action="eleves-sel-doc" data-modele="fiche-scolaire">${ic('file')}Fiches scolaires</button>${peut('document.emettre') ? html`<button type="button" class="btn btn-sm" data-action="eleves-sel-doc" data-modele="certificat-scolarite">${ic('fileCheck')}Certificats</button><button type="button" class="btn btn-sm" data-action="eleves-sel-cartes">${ic('idCard')}Cartes (${ids.length})</button>` : ''}`;
    const titre = p.classe ? `Classe de ${p.classe}` : 'Registre des élèves';
    const g = L.filter((s) => s.sexe === 'Masculin').length;
    return html`${ui.pageTete(titre, `${u.pluriel(L.length, 'élève')} · ${g} garçons · ${L.length - g} filles. Cliquez sur un nom pour ouvrir la fiche (notes, absences, documents).`,
      html`${p.classe ? html`<button type="button" class="btn" data-action="doc-classe" data-modele="liste-classe" data-classe="${p.classe}">${ic('print')}Liste de la classe</button>` : dir ? html`<button type="button" class="btn" data-action="doc-ecole" data-modele="registre-eleves">${ic('print')}Registre général</button>` : ''}
      ${peut('eleve.inscrire', { classe: p.classe || AK.session.classes()[0] }) ? html`<button type="button" class="btn btn-pri" data-action="eleve-nouveau" data-classe="${p.classe || ''}">${ic('userPlus')}Inscrire un élève</button>` : ''}`)}
      ${ui.tableau({
        id: 'eleves', lignes: L, colonnes, filtres, recherche: (s) => x.nomComplet(s) + ' ' + s.prenoms + ' ' + s.nom + ' ' + s.mat + ' ' + (s.matNat || ''),
        placeholder: 'Nom, prénom ou matricule…', unite: 'élève', parPage: 50, selection: true, actionsSelection: actionsSel, exporter: 'eleves', triDefaut: { cle: 'classe', sens: 'asc' },
        legende: 'Registre des élèves',
        vide: S().students.length ? ui.vide('Aucun élève', 'Aucun élève ne correspond à ces filtres.') : ui.vide('Aucun élève inscrit', 'Inscrivez vos élèves un par un ou importez une liste Excel.', peut('eleve.inscrire', { classe: AK.session.classes()[0] }) ? html`<div class="ligne" style="justify-content:center"><button type="button" class="btn btn-pri" data-action="eleve-nouveau">${ic('userPlus')}Inscrire un élève</button><a class="btn" href="#eleves/import">${ic('down')}Importer un fichier Excel</a></div>` : '')
      })}`;
  }

  /* ---------- Formulaire élève ---------- */
  const listeDonnees = (id, L) => html`<datalist id="${id}">${L.map((v) => html`<option value="${v}">`)}</datalist>`;
  function formulaire(s, classeDefaut) {
    const neuf = !s;
    s = s || { pere: {}, mere: {}, acte: {}, nationalite: C.NAT_DEFAUT, classe: classeDefaut || '' };
    const a = s.acte || {}, ex = neuf ? false : !!s.extrait, tut = !!(s.parent || s.tel);
    const classes = X().niveaux().filter((c) => AK.session.classes().includes(c) && peut(neuf ? 'eleve.inscrire' : 'eleve.modifier', { classe: c }));
    const cls = s.classe || (classes.length === 1 ? classes[0] : '');
    const parent = (k, lib, p = {}) => html`<section class="section-form"><h3>${ic('user')}${lib}</h3><div class="form-grille">
      ${F.texte({ lib: 'Nom', nom: k + '_nom', val: p.nom, attrs: { 'data-input': 'maj-nom', autocomplete: 'off', maxlength: 40 } })}
      ${F.texte({ lib: 'Prénoms', nom: k + '_prenoms', val: p.prenoms, attrs: { 'data-input': 'maj-prenoms', autocomplete: 'off', maxlength: 60 } })}
      ${F.texte({ lib: 'Profession', nom: k + '_profession', val: p.profession, attrs: { list: 'dl-prof-' + k, maxlength: 60 } })}
      ${F.tel({ lib: 'Contact', nom: k + '_tel', val: p.tel })}
      ${F.texte({ lib: 'Domicile', nom: k + '_domicile', val: p.domicile, plein: true, attrs: { placeholder: 'Ex. : Ouaninou, quartier Commerce', maxlength: 80 } })}</div></section>`;
    const identite = html`<div class="pile">
      <div class="ligne-entre"><span class="puce">${ic('hash')}Matricule école : <b>${neuf ? AK.eleves.prochainMatricule() + ' (attribué à l’enregistrement)' : s.mat}</b></span></div>
      <div class="form-grille">
        ${F.texte({ lib: 'Nom', nom: 'nom', val: s.nom, req: true, attrs: { 'data-input': 'maj-nom', autocomplete: 'off', autocapitalize: 'characters', maxlength: 40, autofocus: true } })}
        ${F.texte({ lib: 'Prénoms', nom: 'prenoms', val: s.prenoms, req: true, attrs: { 'data-input': 'maj-prenoms', autocomplete: 'off', maxlength: 60 } })}
        ${F.radios({ lib: 'Sexe *', nom: 'sexe', val: s.sexe, options: [['Masculin', 'Masculin'], ['Féminin', 'Féminin']] })}
        ${F.texte({ lib: 'Nationalité', nom: 'nationalite', val: s.nationalite, attrs: { list: 'dl-nat', maxlength: 40 }, aide: 'Liste officielle ; par défaut : ivoirienne.' })}
        ${F.texte({ lib: 'Matricule national (DESPS)', nom: 'matNat', val: s.matNat, attrs: { maxlength: 12, autocomplete: 'off', placeholder: 'Ex. : 12345678A', autocapitalize: 'characters' }, aide: 'Facultatif. De 6 à 12 lettres et chiffres. Il remplace le matricule école sur les documents.' })}
        ${F.image({ lib: 'Photo', nom: 'photo', val: s.photo, bouton: 'Choisir une photo', max: 360, aide: 'Facultative. Réduite automatiquement (JPEG).' })}
      </div></div>`;
    const naissance = html`<div class="pile">
      ${F.case({ lib: 'L’enfant a un extrait d’acte de naissance (ou un jugement supplétif)', nom: 'extrait', coche: ex, attrs: { 'data-change': 'eleve-bascule' } })}
      <div class="form-grille" data-si="extrait"${ex ? '' : raw(' hidden')}>
        ${F.date({ lib: 'Date de naissance', nom: 'naissance', val: s.ageEstime ? '' : s.naissance, req: true, attrs: { max: u.aujourdhui() } })}
        ${F.texte({ lib: 'Lieu de naissance (localité)', nom: 'lieu', val: s.lieu, attrs: { list: 'dl-sp', maxlength: 60 } })}
        ${F.texte({ lib: 'N° de l’acte', nom: 'acte_num', val: a.num, req: true, attrs: { maxlength: 20, placeholder: 'Ex. : 245' } })}
        ${F.date({ lib: 'Date de l’acte (établi le)', nom: 'acte_date', val: a.date, req: true, attrs: { max: u.aujourdhui() } })}
        ${F.texte({ lib: 'Centre d’état civil', nom: 'acte_centre', val: a.centre, attrs: { maxlength: 80, placeholder: 'Ex. : Centre d’état civil de Ouaninou' } })}
        ${F.texte({ lib: 'Sous-préfecture', nom: 'acte_sp', val: a.sp, attrs: { list: 'dl-sp', maxlength: 60 } })}
        ${F.image({ lib: 'Photo de l’extrait (facultatif)', nom: 'extraitPhoto', val: s.extraitPhoto, bouton: 'Photographier l’extrait', max: 1200, plein: true })}
      </div>
      <div class="form-grille" data-si="sansExtrait"${ex ? raw(' hidden') : ''}>
        ${F.nombre({ lib: 'Âge de l’enfant (en années)', nom: 'age', val: s.ageEstime && X().ageDe(s) != null ? X().ageDe(s) : '', req: true, attrs: { min: 2, max: 20, step: 1, inputmode: 'numeric' } })}
        <div class="champ">${ui.encadre('Sans extrait, l’âge est estimé (1er janvier) et le nom de l’un des parents ou du tuteur est obligatoire. Le dossier apparaîtra dans « Dossiers à régulariser ».', 'avert')}</div>
      </div></div>`;
    const parents = html`<div class="pile">${parent('pere', 'Père', s.pere)}${parent('mere', 'Mère', s.mere)}
      ${F.case({ lib: 'Tuteur ou tutrice (personne à contacter si ce n’est ni le père ni la mère)', nom: 'tuteur', coche: tut, attrs: { 'data-change': 'eleve-bascule' } })}
      <div class="form-grille" data-si="tuteur"${tut ? '' : raw(' hidden')}>
        ${F.texte({ lib: 'Nom et prénoms du tuteur', nom: 'parent', val: s.parent, attrs: { 'data-input': 'maj-nom-complet', maxlength: 80, autocomplete: 'off' } })}
        ${F.tel({ lib: 'Contact du tuteur', nom: 'tel', val: s.tel })}
      </div></div>`;
    const scolarite = html`<div class="form-grille">
      ${F.choix({ lib: 'Classe', nom: 'classe', val: cls, req: true, options: classes, vide: 'Choisir…', attrs: { 'data-change': 'eleve-classe' } })}
      ${F.date({ lib: 'Entré(e) à l’école le', nom: 'entree', val: cls === 'CP1' && neuf ? u.aujourdhui() : s.entree, attrs: { max: u.ajouterJours(u.aujourdhui(), 31), readonly: cls === 'CP1' && neuf }, aide: 'Inscription au CP1 : date du jour. Autres classes : date d’arrivée dans l’école.' })}
      ${F.case({ lib: 'Redoublant(e) cette année', nom: 'redoublant', coche: !!s.redoublant })}
      <span></span>
      ${F.choix({ lib: 'Groupe sanguin', nom: 'sang', val: s.sang, options: C.SANG, vide: 'Non renseigné' })}
      ${F.texte({ lib: 'Allergies / handicap', nom: 'allergies', val: s.allergies, attrs: { maxlength: 120, placeholder: 'Aucun' }, aide: 'Donnée de santé : visible par la direction et l’enseignant de la classe, jamais dans un QR code.' })}
    </div>`;
    return html`${ui.ongletsForm([['id', 'Identité', identite], ['nais', 'Naissance', naissance], ['par', 'Parents & tuteur', parents], ['sco', 'Scolarité & santé', scolarite]])}
      ${listeDonnees('dl-nat', AK.ref.NATIONALITES.map((n) => n[1]))}${listeDonnees('dl-sp', AK.ref.SOUS_PREFECTURES)}${listeDonnees('dl-prof-pere', C.PROF_P)}${listeDonnees('dl-prof-mere', C.PROF_M)}`;
  }

  function ouvrirFormulaire(s, classeDefaut) {
    const neuf = !s;
    ui.fenetre({
      titre: neuf ? 'Inscrire un élève' : `Modifier le dossier · ${X().nomComplet(s)}`, icone: neuf ? 'userPlus' : 'edit', taille: 'lg',
      ok: neuf ? 'Inscrire l’élève' : 'Enregistrer les modifications', corps: formulaire(s, classeDefaut),
      async surValider(d) {
        if (neuf) {
          let e;
          try {
            e = AK.eleves.inscrire(d);
          } catch (err) {
            if (!err.doublons) throw err;
            const ok = await ui.confirmer({
              titre: 'Élève peut-être déjà inscrit', icone: 'users',
              message: html`<p>${err.message}</p><p class="mb0">S’il s’agit d’un <b>autre enfant</b> (homonyme), confirmez. Sinon, annulez et ouvrez la fiche existante.</p>`,
              ok: 'C’est un autre enfant : inscrire', annuler: 'Annuler'
            });
            if (!ok) return false;
            e = AK.eleves.inscrire(d, { accepterDoublon: true });
          }
          ui.toast(`${X().nomComplet(e)} inscrit(e) en ${e.classe} · matricule ${e.mat}`, { action: { lib: 'Ouvrir la fiche', f: () => ui.ouvrirTiroir('eleve', e.id) } });
        } else {
          AK.eleves.modifier(s.id, d);
          ui.toast('Dossier mis à jour.');
        }
      }
    });
  }

  /* ---------- Fiche élève (tiroir) ---------- */
  function fiche(id) {
    const s = AK.eleves.trouver(id);
    if (!s || !AK.session.classes().includes(s.classe)) return null;
    const x = X(), a = s.acte || {}, dir = AK.session.estDirecteur();
    const kv = (L) => html`<dl class="kv">${L.filter(Boolean).map(([k, v]) => html`<dt>${k}</dt><dd>${v || '—'}</dd>`)}</dl>`;
    const par = (lib, p) => (p && (p.nom || p.prenoms) ? html`<div><b>${lib} :</b> ${[p.nom, p.prenoms].filter(Boolean).join(' ')}${p.profession ? html` <span class="mut">· ${p.profession}</span>` : ''}${p.tel ? html`<br><a href="tel:${p.tel}">${p.tel}</a>` : ''}${p.domicile ? html` <span class="mut">· ${p.domicile}</span>` : ''}</div>` : '');
    const evals = AK.notes.EVALS.map((n) => {
      const abs = x.estAbsent(s.id, n), m = x.moyEval(s, n), cl = x.classement(s.classe, n).all.find((r) => r.s === s);
      return html`<tr><td>${x.evalLabel(s.classe, n)}</td><td class="num">${abs ? 'Absent' : m == null ? '—' : u.fmtNote(m) + ' / ' + x.echelle(s.classe)}</td><td class="num">${cl && cl.rank ? x.rangTxt(cl.rank) : '—'}</td></tr>`;
    });
    const mg = x.mga(s);
    const absL = x.absencesDe(s.id);
    const docs = AK.registre.duSujet(s.id).slice(-6).reverse();
    const fin = dir && AK.pro ? { du: AK.pro.duDe(s), paye: AK.pro.payeDe(s) } : null;
    return html`<div class="pile">
      <div class="fiche-hero">${ui.avatar(s, 'xl')}<div class="flex1"><h2>${x.nomComplet(s)}</h2><div class="ligne mt0">${ui.lienClasse(s.classe)}${ui.tagStatut(s.statut)}${s.redoublant ? ui.tag('Redoublant') : ''}<span class="mono petit mut">${x.matOf(s)}</span></div></div></div>
      <div class="ligne">${peut('eleve.modifier', { classe: s.classe }) ? html`<button type="button" class="btn btn-sm" data-action="eleve-modifier" data-id="${s.id}">${ic('edit')}Modifier</button>` : ''}
        ${peut('eleve.statut', { classe: s.classe }) ? html`<button type="button" class="btn btn-sm" data-action="eleve-statut" data-id="${s.id}">${ic('flag')}${s.statut === 'Inscrit' ? 'Départ' : 'Statut : ' + s.statut}</button>` : ''}
        <button type="button" class="btn btn-sm btn-pri" data-action="eleve-documents" data-id="${s.id}">${ic('file')}Documents</button>
        <a class="btn btn-sm" href="#notes/saisie?classe=${s.classe}">${ic('award')}Notes</a><a class="btn btn-sm" href="#absences/appel?classe=${s.classe}">${ic('clip')}Appel</a></div>
      ${!s.extrait ? ui.encadre(html`Extrait de naissance non fourni : âge estimé. ${peut('eleve.modifier', { classe: s.classe }) ? html`<button type="button" class="lien" data-action="eleve-modifier" data-id="${s.id}" data-onglet="nais">Saisir l’extrait</button>` : ''}`, 'avert') : ''}
      ${ui.carte('Résultats', html`<div class="tab-cadre"><table class="tab"><thead><tr><th>Évaluation</th><th class="num">Moyenne</th><th class="num">Rang</th></tr></thead><tbody>${evals}</tbody><tfoot><tr><th>MGA</th><th class="num">${mg == null ? '—' : u.fmtNote(mg)}</th><th class="num">${ui.tagDecision(x.decision(s) === s.statut ? null : x.decision(s))}</th></tr></tfoot></table></div>`)}
      ${ui.carte('Identité', kv([['Né(e) le', html`${x.fmtNaissance(s)}${s.lieu ? ' à ' + s.lieu : ''}`], ['Âge', x.ageDe(s) != null ? x.ageDe(s) + ' ans' : null], ['Sexe', s.sexe], ['Nationalité', u.capitale(s.nationalite)], ['Matricule école', s.mat], ['Matricule national', s.matNat], s.extrait ? ['Acte de naissance', `N° ${a.num || '?'} du ${u.fmtDate(a.date)}${a.centre ? ' · ' + a.centre : ''}${a.sp ? ' · ' + a.sp : ''}`] : null, ['Entré(e) le', u.fmtDate(s.entree)], s.statut !== 'Inscrit' ? ['Départ', `${s.statut}${s.departLe ? ' le ' + u.fmtDate(s.departLe) : ''}${s.motifDepart ? ' · ' + s.motifDepart : ''}`] : null]))}
      ${ui.carte('Parents et contacts', html`<div class="pile-sm">${par('Père', s.pere)}${par('Mère', s.mere)}${s.parent || s.tel ? html`<div><b>Tuteur :</b> ${s.parent || '—'}${s.tel ? html`<br><a href="tel:${s.tel}">${s.tel}</a>` : ''}</div>` : ''}${!(s.pere && s.pere.nom) && !(s.mere && s.mere.nom) && !s.parent ? html`<span class="mut">Aucun parent renseigné.</span>` : ''}</div>`)}
      ${ui.carte('Santé', kv([['Groupe sanguin', s.sang], ['Allergies / handicap', s.allergies || 'Aucun']]), { sous: 'Données confidentielles' })}
      ${ui.carte(`Absences (${absL.length})`, absL.length ? html`<div class="liste">${absL.slice(0, 8).map((z) => html`<div><span class="dt"><b>${z.d.slice(8)}</b>${C.MOIS[+z.d.slice(5, 7) - 1].slice(0, 4)}</span><span class="flex1">${u.fmtJour(z.d)}</span><span class="m">${z.v === 'J' ? ui.tag('Justifiée', 'ok') : ui.tag('Non justifiée', 'avert')}</span></div>`)}</div>` : html`<p class="mut mb0">Aucune absence enregistrée.</p>`)}
      ${fin ? ui.carte('Scolarité (frais)', kv([['Montant dû', u.fcfa(fin.du)], ['Versé', u.fcfa(fin.paye)], ['Reste', u.fcfa(Math.max(0, fin.du - fin.paye))]]), { actions: html`<a class="btn btn-sm" href="#finances/paiements?eleve=${s.id}">${ic('coin')}Versements</a>` }) : ''}
      ${docs.length ? ui.carte('Documents émis', html`<div class="liste">${docs.map((d) => html`<a href="#documents/registre?ref=${d.ref}"><span class="flex1"><b>${AK.registre.libelleType(d.type)}</b><br><span class="mono petit mut">${d.ref}</span></span><span class="m">${u.fmtDate(d.emisLe.slice(0, 10))}</span></a>`)}</div>`) : ''}
      ${peut('eleve.supprimer', { classe: s.classe }) ? html`<div class="ligne"><span class="espace"></span><button type="button" class="btn btn-sm btn-dng" data-action="eleve-supprimer" data-id="${s.id}">${ic('trash')}Supprimer (corbeille)</button></div>` : ''}
    </div>`;
  }
  ui.defTiroir('eleve', fiche);

  /* ---------- Départ / statut ---------- */
  function fenetreStatut(s) {
    ui.fenetre({
      titre: `Statut de ${X().nomComplet(s)}`, icone: 'flag', taille: 'sm', ok: 'Enregistrer',
      corps: html`<div class="pile">${F.choix({ lib: 'Statut', nom: 'statut', val: s.statut === 'Inscrit' ? 'Transféré' : s.statut, options: C.STATUTS })}
        ${F.zone({ lib: 'Motif / précision', nom: 'motif', val: s.motifDepart, lignes: 2, attrs: { maxlength: 200, placeholder: 'Ex. : transfert vers EPP Touba 2, déménagement des parents' } })}
        ${ui.encadre('L’élève reste dans le registre (statut et date de départ). Ses notes sont conservées. Après un transfert, vous pouvez délivrer un certificat de transfert.', 'info')}</div>`,
      surValider(d) {
        AK.eleves.changerStatut(s.id, d.statut, d.motif);
        ui.toast(`Statut enregistré : ${d.statut}.`, d.statut === 'Transféré' && peut('document.emettre') ? { action: { lib: 'Certificat de transfert', f: () => AK.docs.ouvrir('certificat-transfert', [{ eleve: s }]) } } : {});
      }
    });
  }

  /* ---------- Documents d'un élève ---------- */
  function menuDocuments(el, s) {
    const L = AK.modeles.liste().filter((d) => d.sujet === 'eleve' && d.categorie !== 'carte');
    const items = L.filter((d) => !d.emission || peut('document.emettre') || (d.emission.politique === 'unique' && peut('document.imprimerClasse', { classe: s.classe }))).map((d) => ({
      icone: d.icone || 'file', lib: d.lib, sous: d.emission ? (d.emission.politique === 'unique' ? 'Référence unique, QR vérifiable' : 'Inscrit au registre, QR vérifiable') : '',
      f: () => documentEleve(d.id, s)
    }));
    if (peut('document.emettre')) items.push('sep', { icone: 'idCard', lib: 'Carte d’identité scolaire', sous: 'Format carte bancaire', f: () => AK.docsUi.cartes('carte-eleve', [s.id]) });
    ui.menu(el, items, X().nomComplet(s));
  }
  async function documentEleve(id, s) {
    if (id === 'bulletin') return AK.docsUi.bulletins([s]);
    return AK.docs.ouvrir(id, [{ eleve: s }], { nomFichier: `${id}-${X().nomComplet(s)}` });
  }

  async function supprimer(s) {
    AK.perm.exiger('eleve.supprimer', { classe: s.classe });
    const nDocs = AK.registre.duSujet(s.id).filter((d) => d.statut === 'valide').length;
    const ok = await ui.confirmer({
      titre: 'Supprimer un élève', danger: true, ok: 'Mettre à la corbeille',
      message: html`<p><b>${X().nomComplet(s)}</b> (${s.classe}) et ses notes, absences et dossiers seront placés dans la <b>corbeille</b> (Données › Corbeille), d’où ils peuvent être restaurés.</p>${s.statut === 'Inscrit' ? html`<p>Pour un élève qui quitte l’école, préférez <b>« Départ »</b> : il reste au registre.</p>` : ''}${nDocs ? html`<p class="mb0">${ic('warn')} ${u.pluriel(nDocs, 'document émis reste', 'documents émis restent')} valide(s) au registre ; annulez-les si nécessaire.</p>` : ''}`
    });
    if (!ok) return;
    if (AK.session.estDirecteur() && !(await AK.auth.confirmer(`Supprimer ${X().nomComplet(s)} (corbeille).`))) return;
    AK.eleves.supprimer(s.id);
    ui.fermerTiroir();
    ui.toast('Élève placé dans la corbeille.', { action: { lib: 'Voir la corbeille', f: () => AK.shell.aller('donnees/corbeille') } });
  }

  /* ---------- Classes ---------- */
  function rendreClasses() {
    const x = X(), ev = S().school.evalCourante || 1, auj = u.aujourdhui(), dir = AK.session.estDirecteur();
    const classes = AK.session.classes();
    if (!classes.length) return html`${ui.pageTete('Classes')}${ui.vide('Aucune classe', 'Aucune classe ne vous est affectée. Le directeur affecte les classes dans Personnel.')}`;
    return html`${ui.pageTete('Classes', 'Effectifs, enseignant, avancement des notes et appel du jour pour chaque classe ouverte.', dir ? html`<button type="button" class="btn" data-action="doc-ecole" data-modele="effectifs">${ic('print')}Tableau des effectifs</button><a class="btn" href="#parametres/ecole">${ic('settings')}Classes ouvertes</a>` : '')}
      <div class="grille gauto">${classes.map((c) => {
        const L = x.actifsDe(c), g = L.filter((s) => s.sexe === 'Masculin').length, t = x.enseignantDe(c), mo = x.moyClasse(c, ev), manq = x.notesManquantes(c, ev), appel = (S().appel[auj] || {})[c];
        return html`<section class="carte pile">
          <div class="ligne-entre"><h2 style="font-size:22px">${c}</h2>${x.estJourClasse(auj) ? ui.tag(appel ? 'Appel fait' : 'Appel à faire', appel ? 'ok' : 'avert') : ui.tag('Pas classe aujourd’hui')}</div>
          <div><span class="kpi-v" style="font-size:26px">${L.length}</span> <span class="mut">élèves · ${g} G · ${L.length - g} F</span></div>
          <div class="repartition" aria-hidden="true">${g ? html`<i class="g-col" style="flex:${g}"></i>` : ''}${L.length - g ? html`<i class="f-col" style="flex:${L.length - g}"></i>` : ''}</div>
          <div class="petit mut">Grille ${x.grille(c).lib} · seuil ${x.info(c).seuil}/${x.echelle(c)} · ${x.evalLabel(c, ev)} : <b style="color:var(--ink)">${mo == null ? '—' : u.fmtNote(mo)}</b> · notes manquantes : <b style="color:var(--ink)">${manq}</b></div>
          ${dir ? html`<div class="champ"><label for="ens-${c}">Enseignant(e)</label><select class="inp" id="ens-${c}" data-change="classe-affecter" data-classe="${c}">${ui.options(S().teachers.filter((z) => z.actif !== false).map((z) => [z.id, z.nom]), t && t.id, '— À affecter —')}</select></div>` : html`<div class="petit">Enseignant(e) : <b>${t ? t.nom : '—'}</b></div>`}
          <div class="ligne"><a class="btn btn-sm" href="#eleves/liste?classe=${c}">${ic('users')}Liste</a><a class="btn btn-sm" href="#notes/saisie?classe=${c}">${ic('edit')}Notes</a><a class="btn btn-sm" href="#absences/appel?classe=${c}">${ic('clip')}Appel</a><a class="btn btn-sm" href="#notes/resultats?classe=${c}">${ic('award')}Classement</a></div>
        </section>`;
      })}</div>`;
  }

  /* ---------- Import Excel ---------- */
  let analyseImport = null;
  function rendreImport() {
    const A = analyseImport;
    const n = A && A.items ? { ok: A.items.filter((i) => i.etat === 'ok').length, dbl: A.items.filter((i) => i.etat === 'doublon').length, err: A.items.filter((i) => i.etat === 'erreur').length } : null;
    return html`${ui.pageTete('Import d’une liste d’élèves', 'Fichier Excel (.xlsx, .xls) ou CSV. Rien n’est enregistré avant votre confirmation ; une copie de sécurité est faite juste avant.')}
      <div class="grille g-2-1">
        ${ui.carte('1. Choisir le fichier', html`<div class="pile">
          <label class="btn btn-pri" style="justify-self:start">${ic('folder')}Choisir un fichier Excel ou CSV<input type="file" hidden accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-change="import-fichier"></label>
          ${A && A.nom ? html`<p class="mb0">${ic('file')} <b>${A.nom}</b> · ${u.pluriel((A.items || []).length, 'ligne')} lue(s)</p>` : ''}
          ${A && A.erreur ? ui.encadre(A.erreur, 'erreur') : ''}</div>`)}
        ${ui.carte('Colonnes reconnues', html`<p class="petit mb0"><b>Obligatoires :</b> nom, prénoms, niveau (ou classe), sexe.<br><b>Facultatives :</b> naissance (ou jour, mois, année), matricule, parent, téléphone, extrait, n° acte, date acte, centre, nationalité, lieu, sous-préfecture, père, mère, domicile.</p><p class="petit mut mb0">Les doublons (même matricule, ou même nom et même naissance qu’un élève existant) ne sont jamais importés.</p>`)}
      </div>
      ${n ? html`<div class="titre-section mt"><h2>2. Vérifier</h2><span class="ligne">${ui.tag(`${n.ok} à importer`, 'ok')}${n.dbl ? ui.tag(`${n.dbl} doublon(s) ignoré(s)`, 'avert') : ''}${n.err ? ui.tag(`${n.err} ligne(s) en erreur`, 'mauvais') : ''}</span></div>
        ${ui.tableau({
          id: 'import', lignes: A.items, cleId: (i) => String(i.ligne), parPage: 100, unite: 'ligne', recherche: (i) => i.s.nom + ' ' + i.s.prenoms + ' ' + i.motif,
          filtres: html``, colonnes: [
            { cle: 'l', lib: 'Ligne', tri: (i) => i.ligne, rendu: (i) => i.ligne },
            { cle: 'etat', lib: 'État', tri: (i) => i.etat, rendu: (i) => (i.etat === 'ok' ? ui.tag('À importer', 'ok') : i.etat === 'doublon' ? ui.tag('Doublon', 'avert') : ui.tag('Erreur', 'mauvais')) },
            { cle: 'nom', lib: 'Nom et prénoms', tri: (i) => i.s.nom + i.s.prenoms, rendu: (i) => `${i.s.nom} ${i.s.prenoms}` },
            { cle: 'c', lib: 'Classe', tri: (i) => i.s.classe, rendu: (i) => i.s.classe || '—' },
            { cle: 'sx', lib: 'Sexe', rendu: (i) => i.s.sexe || '—' },
            { cle: 'n', lib: 'Naissance', rendu: (i) => (i.s.naissance ? u.fmtDate(i.s.naissance) : '—') },
            { cle: 'm', lib: 'Remarque', rendu: (i) => i.motif || '' }
          ]
        })}
        <div class="ligne mt"><span class="espace"></span><button type="button" class="btn" data-action="import-annuler">Annuler</button><button type="button" class="btn btn-pri" data-action="import-confirmer"${n.ok ? '' : raw(' disabled')}>${ic('check')}Importer ${u.pluriel(n.ok, 'élève')}</button></div>` : ''}`;
  }

  /* ---------- Écrans ---------- */
  AK.ecrans.def('eleves/liste', { rendu: rendreListe, droit: 'eleve.voir' });
  AK.ecrans.def('eleves/classes', { rendu: rendreClasses, droit: 'eleve.voir' });
  AK.ecrans.def('eleves/import', { rendu: rendreImport, droit: 'eleve.importer' });

  /* ---------- Actions ---------- */
  const eleveDe = (el) => {
    const s = AK.eleves.trouver(el.dataset.id);
    if (!s) throw new AK.ErreurMetier('Élève introuvable (peut-être supprimé).');
    return s;
  };
  AK.actions.def({
    'fiche-eleve': (el) => ui.ouvrirTiroir('eleve', el.dataset.id),
    'eleve-nouveau': (el) => ouvrirFormulaire(null, el.dataset.classe || AK.shell.params().classe),
    async 'eleve-modifier'(el) {
      const s = eleveDe(el);
      AK.perm.exiger('eleve.modifier', { classe: s.classe });
      if (AK.session.estDirecteur() && !(await AK.auth.confirmer(`Modifier le dossier déjà enregistré de ${X().nomComplet(s)}.`))) return;
      ouvrirFormulaire(s);
      if (el.dataset.onglet) setTimeout(() => {
        const t = [...document.querySelectorAll('dialog[open] [role=tab]')].find((b) => b.id.endsWith('-t-' + el.dataset.onglet));
        if (t) t.click();
      }, 40);
    },
    'eleve-statut': (el) => {
      const s = eleveDe(el);
      AK.perm.exiger('eleve.statut', { classe: s.classe });
      fenetreStatut(s);
    },
    'eleve-documents': (el) => menuDocuments(el, eleveDe(el)),
    'eleve-plus'(el) {
      const s = eleveDe(el);
      const items = [{ icone: 'user', lib: 'Ouvrir la fiche', f: () => ui.ouvrirTiroir('eleve', s.id) }];
      if (peut('eleve.statut', { classe: s.classe })) items.push({ icone: 'flag', lib: s.statut === 'Inscrit' ? 'Enregistrer un départ' : 'Changer le statut', f: () => fenetreStatut(s) });
      if (peut('autorisation.demander', { classe: s.classe })) items.push({ icone: 'cal', lib: 'Demande d’autorisation d’absence', f: () => AK.ecransAbsences.demande('eleve', s.id) });
      if (peut('eleve.supprimer', { classe: s.classe })) items.push('sep', { icone: 'trash', lib: 'Supprimer (corbeille)', danger: true, f: () => supprimer(s) });
      ui.menu(el, items, X().nomComplet(s));
    },
    'eleve-supprimer': (el) => supprimer(eleveDe(el)),
    'eleves-sel-doc'(el) {
      const ids = ui.tableauChoix('eleves');
      const L = ids.map((id) => AK.eleves.trouver(id)).filter(Boolean).sort(X().parClasse);
      if (!L.length) return;
      AK.docs.ouvrir(el.dataset.modele, L.map((s) => ({ eleve: s })));
    },
    'eleves-sel-cartes'() {
      AK.docsUi.cartes('carte-eleve', ui.tableauChoix('eleves'));
    },
    'doc-classe': (el) => AK.docs.ouvrir(el.dataset.modele, [{ classe: el.dataset.classe }]),
    'doc-ecole': (el) => AK.docs.ouvrir(el.dataset.modele, [{}]),
    'import-annuler'() {
      analyseImport = null;
      AK.shell.redessiner();
    },
    async 'import-confirmer'() {
      if (!analyseImport || !analyseImport.items) return;
      const n = await AK.imports.importer(analyseImport);
      analyseImport = null;
      ui.toast(`${u.pluriel(n, 'élève importé', 'élèves importés')}. Copie de sécurité faite avant l’import.`);
      AK.shell.aller('eleves/liste');
    }
  });
  AK.actions.defChange({
    'eleves-filtre'(el) {
      const p = { ...AK.shell.params() };
      p[el.dataset.f] = el.value;
      if (el.dataset.f === 'statut' && el.value === 'Inscrit') delete p.statut;
      Object.keys(p).forEach((k) => p[k] === '' && k !== 'statut' && delete p[k]);
      ui.tableauEtat('eleves').page = 1;
      AK.shell.aller('eleves/liste', p);
    },
    'eleve-bascule'(el) {
      const f = el.form;
      if (el.name === 'extrait') {
        f.querySelector('[data-si="extrait"]').hidden = !el.checked;
        f.querySelector('[data-si="sansExtrait"]').hidden = el.checked;
      } else f.querySelector('[data-si="tuteur"]').hidden = !el.checked;
    },
    'eleve-classe'(el) {
      const e = el.form.elements.entree;
      if (!e) return;
      const cp1 = el.value === 'CP1' && /Inscrire/.test(el.form.querySelector('[type=submit]').textContent);
      e.readOnly = cp1;
      if (cp1) e.value = u.aujourdhui();
    },
    'classe-affecter'(el) {
      try {
        AK.personnel.affecter(el.dataset.classe, el.value);
        ui.toast(el.value ? `Classe ${el.dataset.classe} affectée.` : `Classe ${el.dataset.classe} sans enseignant.`);
      } catch (err) {
        if (err.ficheAgent) ui.toast(err.message, { type: 'erreur', action: { lib: 'Ouvrir la fiche', f: () => ui.ouvrirTiroir('agent', err.ficheAgent) } });
        else ui.erreur(err);
        AK.shell.redessiner();
      }
    },
    async 'import-fichier'(el) {
      const f = el.files && el.files[0];
      el.value = '';
      if (!f) return;
      try {
        const rows = await AK.imports.lireTableur(f);
        analyseImport = { nom: f.name, ...AK.imports.analyser(rows) };
      } catch (err) {
        analyseImport = { nom: f.name, erreur: err.message || 'Fichier illisible.' };
      }
      AK.shell.redessiner();
    }
  });
  /* Saisie : majuscules du nom, majuscule à chaque prénom (curseur conservé) */
  const majChamp = (el, f) => {
    const p = el.selectionStart, v = f(el.value);
    if (v !== el.value) {
      el.value = v;
      try {
        el.setSelectionRange(p, p);
      } catch (e) { /* champ sans curseur */ }
    }
  };
  AK.actions.defSaisie({
    'maj-nom': (el) => majChamp(el, (v) => v.toUpperCase()),
    'maj-prenoms': (el) => majChamp(el, u.majPrenoms),
    'maj-nom-complet': (el) => majChamp(el, u.majNomComplet)
  });

  AK.ecransEleves = { elevesFiltres, ouvrirFormulaire };
})(window.AK);
