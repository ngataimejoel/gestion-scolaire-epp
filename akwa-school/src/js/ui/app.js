/* =====================================================================================
   Démarrage : chargement des données, assistant de création, reprise des données 1.x,
   démonstration, connexion, verrouillage après inactivité, déconnexion.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw, $, $$ } = u, ic = AK.ic, ui = AK.ui, C = AK.cfg, V = AK.valid;
  const S = () => AK.store.etat;
  let coqueConstruite = false, minuterieVerrou = null;

  /* ---------- Écran plein (accueil, connexion, verrou) ---------- */
  function ecranPlein(contenu, { photo = true } = {}) {
    let el = $('#ecran-plein');
    if (!el) {
      el = document.createElement('section');
      el.id = 'ecran-plein';
      el.className = 'ecran-plein';
      document.body.appendChild(el);
    }
    const P = AK.assets.photos || {};
    u.poser(el, html`${photo ? html`<div class="ep-visuel" aria-hidden="true">${P.maitre ? html`<img src="${P.maitre}" alt="">` : ''}<div class="ep-legende"><b>L’école primaire, mieux organisée chaque jour.</b><span>Élèves, notes, bulletins, absences, documents officiels et rapports de l’IEPP — sur cet ordinateur, sans Internet.</span></div></div>` : ''}<div class="ep-panneau"><div class="ep-contenu">${contenu}</div><p class="ep-pied">${AK.NOM} ${AK.VERSION} · ${AK.hote.libelle} · données enregistrées sur cet appareil</p></div>`);
    el.classList.toggle('sans-photo', !photo);
    el.hidden = false;
    document.body.classList.add('a-ecran-plein');
    const app = $('#app');
    if (app) app.setAttribute('inert', '');
    return el;
  }
  function fermerEcranPlein() {
    const el = $('#ecran-plein');
    if (el) el.remove();
    document.body.classList.remove('a-ecran-plein');
    const app = $('#app');
    if (app) app.removeAttribute('inert');
  }
  const marque = (titre, sous) => html`<div class="ep-marque"><img src="${AK.assets.logo}" alt=""><div><b>AKWA SCHOOL</b><small>Gestion scolaire de l’école primaire · ${AK.VERSION}</small></div></div><h1>${titre}</h1>${sous ? html`<p class="ep-sous">${sous}</p>` : ''}`;

  /* ---------- Assistant de première ouverture ---------- */
  function assistant() {
    const ancien = AK.hote.type !== 'bureau' ? AK.stockage.ancienneVersion() : null;
    const el = ecranPlein(html`${marque('Bienvenue', 'Aucune école n’est encore enregistrée dans ce navigateur. Comment voulez-vous commencer ?')}
      <div class="ep-choix">
        ${ancien ? html`<button type="button" class="ep-option recommande" data-ep="ancien">${ic('history')}<span><b>Reprendre les données d’AKWA SCHOOL 1.x</b><small>${ancien.school && ancien.school.name ? ancien.school.name + ' · ' : ''}${u.pluriel(ancien.students.length, 'élève')} trouvés dans ce navigateur. Les anciennes données ne sont pas effacées.</small></span>${ic('chev')}</button>` : ''}
        <button type="button" class="ep-option${ancien ? '' : ' recommande'}" data-ep="creer">${ic('school')}<span><b>Créer mon école</b><small>Identité de l’école, niveaux ouverts, mot de passe du directeur.</small></span>${ic('chev')}</button>
        <label class="ep-option" tabindex="0">${ic('up')}<span><b>Restaurer une sauvegarde</b><small>Fichier .akwa.json, ou sauvegarde .json d’AKWA SCHOOL 1.x.</small></span>${ic('chev')}<input type="file" accept=".json,application/json" hidden data-ep-fichier></label>
        <button type="button" class="ep-option" data-ep="demo">${ic('eye')}<span><b>Découvrir avec une école de démonstration</b><small>Élèves et notes fictifs ; documents marqués SPÉCIMEN.</small></span>${ic('chev')}</button>
      </div>
      ${!AK.crypto.dispo() ? ui.encadre('La cryptographie du navigateur est indisponible : ouvrez ce fichier avec Chrome, Edge ou Firefox récent.', 'erreur') : ''}`);
    el.querySelector('[data-ep="creer"]').onclick = () => assistantEcole();
    el.querySelector('[data-ep="demo"]').onclick = () => lancerDemo();
    if (ancien) el.querySelector('[data-ep="ancien"]').onclick = () => reprendre1x(ancien);
    const lab = el.querySelector('label.ep-option');
    lab.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), lab.querySelector('input').click()));
    el.querySelector('[data-ep-fichier]').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const a = await AK.sauvegarde.analyser(await f.text());
        if (!a.valide) return ui.info('Sauvegarde refusée', html`<div class="pile">${a.notes.map((n) => ui.encadre(n, 'erreur'))}</div>`, { icone: 'alert' });
        const ok = await ui.confirmer({ titre: 'Restaurer cette sauvegarde ?', message: apercuSauvegarde(a), ok: 'Restaurer' });
        if (!ok) return;
        await installer(a.etat, a.notes);
      } catch (err) {
        ui.erreur(err);
      }
    };
    setTimeout(() => AK.ui.focusInitial(el.querySelector('.ep-option'), el), 50);
  }

  function apercuSauvegarde(a) {
    const c = a.infos.contenu || {};
    return html`<div class="pile-sm"><dl class="kv"><dt>École</dt><dd>${(a.infos.ecole && a.infos.ecole.nom) || '—'}</dd><dt>Année</dt><dd>${(a.infos.ecole && a.infos.ecole.annee) || '—'}</dd>${a.infos.creeLe ? html`<dt>Sauvegardée le</dt><dd>${u.fmtHorodatage(a.infos.creeLe)}</dd>` : ''}<dt>Contenu</dt><dd>${u.pluriel(c.eleves || 0, 'élève')}, ${u.pluriel(c.personnel || 0, 'membre')} du personnel, ${u.pluriel(c.notes || 0, 'note')}, ${u.pluriel(c.documents || 0, 'document')}</dd><dt>Intégrité</dt><dd>${a.integrite === 'ok' ? ui.tag('Empreinte SHA-256 vérifiée', 'ok', 'shieldCheck') : a.integrite === 'locale' ? ui.tag('Copie locale', 'pri') : ui.tag('Pas d’empreinte (ancien format)', 'avert')}</dd></dl>${(a.notes || []).map((n) => ui.encadre(n))}${(a.problemes || []).length ? ui.encadre(html`<b>${u.pluriel(a.problemes.length, 'incohérence')} détectée(s)</b> (affichée(s) dans Diagnostic après la restauration).`, 'avert') : ''}</div>`;
  }
  AK.app_apercuSauvegarde = apercuSauvegarde;

  async function reprendre1x(ancien) {
    try {
      const { etat, notes } = AK.schema.migrer(ancien);
      const ok = await ui.confirmer({
        titre: 'Reprendre les données 1.x',
        message: html`<div class="pile-sm"><p class="mb0">${u.pluriel(etat.students.length, 'élève')}, ${u.pluriel(etat.teachers.length, 'membre')} du personnel et ${u.pluriel(Object.keys(etat.grades).length, 'note')} seront repris. Les données d’origine restent intactes dans le navigateur.</p>${notes.map((n) => ui.encadre(n))}${ui.encadre(html`Pour cette première connexion, utilisez <b>votre ancien mot de passe administrateur</b> (par défaut « admin »). Il vous sera demandé d’en choisir un plus sûr.`, 'avert', 'key')}</div>`,
        ok: 'Reprendre les données'
      });
      if (ok) await installer(etat, notes);
    } catch (e) {
      ui.erreur(e);
    }
  }

  async function installer(etat, notes) {
    await AK.auth.migrerSecrets(etat);
    AK.store.installer(etat);
    const ok = await AK.store.maintenant();
    if (!ok) ui.toast('Les données sont chargées mais n’ont pas pu être enregistrées : vérifiez le stockage du navigateur.', { type: 'erreur', duree: 0 });
    else ui.toast((notes && notes[0]) || 'Données chargées.');
    // données reprises sans mot de passe administrateur (ex. application Android 1.x : mot de passe gardé par le téléphone)
    if (AK.hote.authentificationLocale && !AK.auth.aUnAdmin()) return choisirMdpAdmin();
    connexion();
  }

  /** Mot de passe du directeur pour des données qui n'en ont pas encore (reprise, restauration). */
  function choisirMdpAdmin() {
    ecranPlein(html`${marque('Mot de passe du directeur', 'Les données reprises ne contiennent pas de mot de passe administrateur utilisable sur cet appareil. Choisissez-en un.')}
      <form class="pile" novalidate data-ep-form>
        <div class="champ"><label for="ep-mdp">Mot de passe (${C.SECU.MDP_MIN} caractères au moins, lettres et chiffres)</label><input id="ep-mdp" class="inp" type="password" name="mdp" autocomplete="new-password" required data-force><div class="force" data-n="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>
        <div class="champ"><label for="ep-mdp2">Confirmez le mot de passe</label><input id="ep-mdp2" class="inp" type="password" name="mdp2" autocomplete="new-password" required></div>
        ${ui.encadre('Ce mot de passe n’est jamais conservé en clair. Un code de secours vous sera remis pour le cas où vous l’oublieriez.', '', 'lock')}
        <button class="btn btn-pri btn-lg">Enregistrer le mot de passe</button>
      </form>`);
    const f = $('[data-ep-form]');
    brancherForce(f);
    f.onsubmit = async (e) => {
      e.preventDefault();
      ui.effacerErreurs(f);
      const d = ui.lireFormulaire(f);
      const err = V.motDePasse(d.mdp);
      if (err) return ui.erreurChamp(f, 'mdp', err);
      if (d.mdp !== d.mdp2) return ui.erreurChamp(f, 'mdp2', 'Les deux mots de passe ne sont pas identiques.');
      const b = f.querySelector('.btn-pri');
      b.classList.add('occupe');
      try {
        const code = await AK.auth.configurerAdmin(d.mdp);
        await AK.store.maintenant();
        montrerCodeSecours(code, () => connexion());
      } catch (er) {
        b.classList.remove('occupe');
        ui.erreur(er);
      }
    };
  }

  function assistantEcole() {
    const brouillon = {};
    const etape1 = () => {
      ecranPlein(html`${marque('Votre école', 'Ces informations figurent dans l’en-tête des documents officiels. Elles restent modifiables dans Paramètres.')}
        <div class="etapes" aria-label="Étape 1 sur 3"><span class="fait"></span><span></span><span></span></div>
        <form class="pile" novalidate data-ep-form>
          ${ui.champ.radios({ nom: 'statut', lib: 'Statut', options: C.STATUTS_ECOLE, val: brouillon.statut || 'publique' })}
          <div class="form-grille">
            ${ui.champ.texte({ nom: 'name', lib: 'Nom de l’école', req: true, val: brouillon.name, plein: true, attrs: { placeholder: 'EPP … (école publique)', autocapitalize: 'characters', maxlength: 80 } })}
            ${ui.champ.texte({ nom: 'drenaet', lib: 'DRENAET', req: true, val: brouillon.drenaet, attrs: { placeholder: 'ex. TOUBA', autocapitalize: 'characters' } })}
            ${ui.champ.texte({ nom: 'iepp', lib: 'IEPP', val: brouillon.iepp, attrs: { placeholder: 'ex. IEPP OUANINOU' } })}
            ${ui.champ.texte({ nom: 'localite', lib: 'Localité', val: brouillon.localite })}
            ${ui.champ.tel({ nom: 'dirTel', lib: 'Contact du directeur', val: brouillon.dirTel })}
            ${ui.champ.choix({ nom: 'dirCiv', lib: 'Civilité du directeur', options: C.CIVS, val: brouillon.dirCiv || 'M.', req: true })}
            ${ui.champ.texte({ nom: 'director', lib: 'Directeur / directrice (nom et prénoms)', req: true, val: brouillon.director, attrs: { placeholder: 'ex. OUATTARA Siaka' } })}
          </div>
          <div class="ligne-entre"><button type="button" class="btn btn-ghost" data-ep-retour>${ic('chevL')}Retour</button><button class="btn btn-pri btn-lg">Continuer${ic('chev')}</button></div>
        </form>`);
      const f = $('[data-ep-form]');
      $('[data-ep-retour]').onclick = () => assistant();
      f.onsubmit = (e) => {
        e.preventDefault();
        ui.effacerErreurs(f);
        const d = ui.lireFormulaire(f);
        Object.assign(brouillon, d);
        const prive = d.statut === 'privee';
        if (!V.ecoleNom(d.name, prive)) return ui.erreurChamp(f, 'name', V.ECOLE_ERR(prive));
        if (!V.drenaetDe(d.drenaet)) return ui.erreurChamp(f, 'drenaet', 'Indiquez la DRENAET (ex. TOUBA).');
        const e2 = V.nom(d.director, 'Directeur') || V.tel(d.dirTel, 'Contact du directeur');
        if (e2) return ui.erreurChamp(f, /Contact/.test(e2) ? 'dirTel' : 'director', e2);
        etape2();
      };
      setTimeout(() => AK.ui.focusInitial(f.querySelector('[name=name]'), f), 50);
    };
    const etape2 = () => {
      const an = new Date().getMonth() < 7 ? new Date().getFullYear() - 1 : new Date().getFullYear();
      const annees = [an - 1, an, an + 1].map((y) => `${y}–${y + 1}`);
      ecranPlein(html`${marque('Organisation de l’année', 'Niveaux ouverts dans l’école et année scolaire en cours.')}
        <div class="etapes" aria-label="Étape 2 sur 3"><span class="fait"></span><span class="fait"></span><span></span></div>
        <form class="pile" novalidate data-ep-form>
          ${ui.champ.choix({ nom: 'year', lib: 'Année scolaire', options: annees, val: brouillon.year || `${an}–${an + 1}`, req: true })}
          ${ui.champ.cases({ nom: 'niveaux', lib: 'Niveaux ouverts dans l’école', options: C.TOUS_NIVEAUX, valeurs: brouillon.niveaux || C.TOUS_NIVEAUX })}
          ${ui.champ.choix({ nom: 'evalCourante', lib: 'Évaluation en cours', options: [1, 2, 3, 4].map((n) => [n, C.EV_GEN[n - 1]]), val: brouillon.evalCourante || 1 })}
          <div class="ligne-entre"><button type="button" class="btn btn-ghost" data-ep-retour>${ic('chevL')}Retour</button><button class="btn btn-pri btn-lg">Continuer${ic('chev')}</button></div>
        </form>`);
      const f = $('[data-ep-form]');
      $('[data-ep-retour]').onclick = etape1;
      f.onsubmit = (e) => {
        e.preventDefault();
        ui.effacerErreurs(f);
        const d = ui.lireFormulaire(f);
        if (!d.niveaux.length) return ui.erreurChamp(f, 'niveaux', 'Cochez au moins un niveau.');
        Object.assign(brouillon, d);
        etape3();
      };
    };
    const etape3 = () => {
      ecranPlein(html`${marque('Mot de passe du directeur', 'Il protège les opérations sensibles : corrections de notes, suppressions, restauration, signature des documents.')}
        <div class="etapes" aria-label="Étape 3 sur 3"><span class="fait"></span><span class="fait"></span><span class="fait"></span></div>
        <form class="pile" novalidate data-ep-form>
          <div class="champ"><label for="ep-mdp">Mot de passe (${C.SECU.MDP_MIN} caractères au moins, lettres et chiffres)</label><input id="ep-mdp" class="inp" type="password" name="mdp" autocomplete="new-password" required data-force><div class="force" data-n="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>
          <div class="champ"><label for="ep-mdp2">Confirmez le mot de passe</label><input id="ep-mdp2" class="inp" type="password" name="mdp2" autocomplete="new-password" required></div>
          ${ui.encadre('Ce mot de passe n’est jamais conservé en clair. Un code de secours vous sera remis pour le cas où vous l’oublieriez.', '', 'lock')}
          <div class="ligne-entre"><button type="button" class="btn btn-ghost" data-ep-retour>${ic('chevL')}Retour</button><button class="btn btn-pri btn-lg">Créer l’école</button></div>
        </form>`);
      const f = $('[data-ep-form]');
      $('[data-ep-retour]').onclick = etape2;
      brancherForce(f);
      f.onsubmit = async (e) => {
        e.preventDefault();
        ui.effacerErreurs(f);
        const d = ui.lireFormulaire(f);
        const err = V.motDePasse(d.mdp);
        if (err) return ui.erreurChamp(f, 'mdp', err);
        if (d.mdp !== d.mdp2) return ui.erreurChamp(f, 'mdp2', 'Les deux mots de passe ne sont pas identiques.');
        const b = f.querySelector('.btn-pri');
        b.classList.add('occupe');
        try {
          const etat = AK.schema.vierge();
          const prive = brouillon.statut === 'privee';
          const dr = V.drenaetDe(brouillon.drenaet);
          Object.assign(etat.school, {
            statut: prive ? 'privee' : 'publique', name: V.ecoleNom(brouillon.name, prive), drenaet: dr.drenaet, direction: dr.direction,
            iepp: String(brouillon.iepp || '').trim().toUpperCase(), localite: String(brouillon.localite || '').trim().toUpperCase(),
            director: V.civ.avec(brouillon.dirCiv, brouillon.director), dirTel: V.telPropre(brouillon.dirTel),
            year: brouillon.year, niveaux: C.TOUS_NIVEAUX.filter((c) => brouillon.niveaux.includes(c)), evalCourante: Number(brouillon.evalCourante) || 1, idLock: true
          });
          if (etat.school.iepp && !/^IEPP/.test(etat.school.iepp)) etat.school.iepp = 'IEPP ' + etat.school.iepp;
          if (etat.school.iepp) etat.school.inspection = C.ENTETE.inspection + ' DE ' + etat.school.iepp.replace(/^IEPP\s+/, '');
          AK.store.installer(etat);
          AK.store.journaliser('École créée : ' + etat.school.name);
          const code = await AK.auth.configurerAdmin(d.mdp);
          const ok = await AK.store.maintenant();
          montrerCodeSecours(code, () => {
            AK.session.ouvrir({ role: 'dir' });
            AK.cles.deverrouiller(d.mdp).catch(() => {});
            ouvrirApplication();
            if (!ok) ui.toast('L’école est créée mais l’enregistrement a échoué : vérifiez le stockage du navigateur.', { type: 'erreur', duree: 0 });
            else ui.toast('Votre école est créée. Commencez par inscrire les élèves ou importer le fichier Excel de l’IEPP.');
          });
        } catch (er) {
          b.classList.remove('occupe');
          ui.erreur(er);
        }
      };
      setTimeout(() => AK.ui.focusInitial(f.querySelector('[name=mdp]'), f), 50);
    };
    etape1();
  }

  function brancherForce(racine) {
    $$('[data-force]', racine).forEach((i) => {
      const barre = i.parentElement.querySelector('.force');
      i.addEventListener('input', () => barre.setAttribute('data-n', i.value ? String(Math.max(1, V.forceMotDePasse(i.value))) : '0'));
    });
  }
  AK.ui.brancherForce = brancherForce;

  /** Code de secours : affiché une seule fois, l'utilisateur confirme l'avoir noté. */
  function montrerCodeSecours(code, suite) {
    ui.fenetre({
      titre: 'Votre code de secours', icone: 'key', taille: 'sm', ok: 'J’ai noté le code', annuler: false, proteger: false,
      corps: html`<div class="pile"><p class="mb0">Il permet de choisir un nouveau mot de passe si vous oubliez le vôtre, sans Internet. <b>Notez-le sur papier et rangez-le en lieu sûr</b> : il ne sera plus affiché.</p>
        <p class="code-secours" aria-label="Code de secours">${code}</p>
        <label class="coche"><input type="checkbox" name="note" required> J’ai noté ce code et je l’ai rangé en lieu sûr.</label></div>`,
      surValider(d) {
        if (!d.note) throw new AK.ErreurMetier('Cochez la case pour confirmer que vous avez noté le code.', 'note');
      },
      surFermer: suite
    });
  }
  AK.ui.montrerCodeSecours = montrerCodeSecours;

  async function lancerDemo() {
    try {
      const etat = AK.demo.creer();
      await AK.demo.comptes(etat);
      AK.store.installer(etat);
      await AK.store.maintenant();
      connexion();
    } catch (e) {
      ui.erreur(e);
    }
  }

  /* ---------- Connexion ---------- */
  function connexion() {
    if (AK.hote.type === 'bureau') return sessionBureau();
    const sc = S().school;
    const profils = [['', S().school.solo ? 'Mon espace (enseignant)' : 'Directeur (administrateur)', sc.director || 'Toute l’école', null]];
    if (!sc.solo) S().teachers.filter((t) => t.compte && t.compte.actif && t.actif !== false).forEach((t) => profils.push([t.compte.login, t.nom, 'Enseignant · ' + (AK.calc.clsTxt(t) || 'sans classe'), t]));
    let choix = '';
    const el = ecranPlein(html`${marque(sc.name || 'Connexion', [sc.iepp, sc.drenaet, sc.year ? 'Année ' + sc.year : ''].filter(Boolean).join(' · '))}
      <form class="pile" novalidate data-ep-form>
        <div class="champ"><span class="lib">Profil</span><div class="ep-profils" role="radiogroup" aria-label="Profil">${profils.map(([v, l, s, t], i) => html`<button type="button" class="ep-profil" role="radio" aria-checked="${i === 0}" data-v="${v}">${t ? ui.avatar(t) : html`<span class="av">${ic('key')}</span>`}<span><b>${l}</b><small>${s}</small></span><span class="ck"></span></button>`)}</div></div>
        <div class="champ"><label for="ep-mdp">Mot de passe</label><input id="ep-mdp" class="inp" type="password" name="mdp" autocomplete="current-password" required></div>
        <button class="btn btn-pri btn-lg" type="submit">${ic('unlock')}Se connecter</button>
        <div class="ligne-entre petit"><button type="button" class="lien mut" data-ep-oubli>Mot de passe oublié ?</button><span class="mut">${ic('shield', 'i-sm')} Accès protégé sur cet appareil</span></div>
        ${S().meta.demo ? ui.encadre(html`<b>Démonstration</b> — directeur : <code>${AK.demo.DEMO_MDP}</code> · enseignants : <code>${AK.demo.DEMO_MDP_ENS}</code>`, 'avert', 'info') : ''}
      </form>`);
    const f = $('[data-ep-form]', el);
    $$('.ep-profil', el).forEach((b) => {
      b.onclick = () => {
        choix = b.dataset.v;
        $$('.ep-profil', el).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        f.mdp.focus();
      };
      b.onkeydown = (e) => {
        const B = $$('.ep-profil', el), i = B.indexOf(b);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const n = B[(i + (e.key === 'ArrowDown' ? 1 : -1) + B.length) % B.length];
          n.focus();
          n.click();
        }
      };
    });
    $('[data-ep-oubli]', el).onclick = () => (choix ? ui.info('Mot de passe oublié', 'Demandez au directeur de vous donner un nouveau mot de passe provisoire (Personnel › Comptes enseignants).', { icone: 'key' }) : motDePasseOublie());
    f.onsubmit = async (e) => {
      e.preventDefault();
      ui.effacerErreurs(f);
      const b = f.querySelector('.btn-pri');
      b.classList.add('occupe');
      try {
        const r = await AK.auth.connecter(choix, f.mdp.value);
        if (r.role === 'dir' && S().school.solo) {
          r.role = 'ens';
          r.tid = S().school.solo.tid;
        }
        AK.session.ouvrir(r);
        AK.store.journaliser(r.role === 'dir' ? 'Connexion du directeur' : 'Connexion enseignant');
        ouvrirApplication();
        if (r.provisoire && r.role === 'ens' && !S().school.solo) setTimeout(() => changerMdpEnseignant(true), 100);
      } catch (err) {
        b.classList.remove('occupe');
        if (err.name === 'ErreurMetier') {
          ui.erreurChamp(f, 'mdp', err.message);
          f.mdp.select();
          await u.attendre(600); // ralentit les essais au hasard
        } else ui.erreur(err);
      }
    };
    setTimeout(() => AK.ui.focusInitial(f.mdp, f), 60);
  }

  function sessionBureau() {
    const s = AK.hote.session || { role: 'dir' };
    AK.session.ouvrir(s.role === 'ens' ? { role: 'ens', tid: s.tid, login: s.login } : { role: 'dir' });
    ouvrirApplication();
  }

  function ouvrirApplication() {
    fermerEcranPlein();
    if (!coqueConstruite) {
      AK.shell.construire();
      AK.shell.demarrer();
      coqueConstruite = true;
    } else AK.shell.dessiner();
    armerVerrou();
    const pb = AK.schema.verifier(S()).filter((p) => p.gravite === 'erreur');
    if (pb.length && AK.session.estDirecteur()) ui.toast(`${u.pluriel(pb.length, 'incohérence')} dans les données : voir Paramètres › Diagnostic.`, { type: 'avert', action: { lib: 'Voir', f: () => AK.shell.aller('parametres/diagnostic') } });
  }

  /* ---------- Verrouillage après inactivité ---------- */
  function armerVerrou() {
    clearInterval(minuterieVerrou);
    if (!AK.hote.authentificationLocale) return;
    minuterieVerrou = setInterval(() => {
      const min = Number(S().securite.verrouMin) || 0;
      if (min > 0 && AK.session.ouverte() && AK.session.inactifDepuis() > min * 60000 && !$('#ecran-plein')) verrouiller();
    }, 20000);
  }
  function verrouiller() {
    if (!AK.session.ouverte()) return;
    document.querySelectorAll('dialog[open]').forEach((d) => d.querySelector('[data-fermer]') && d.close());
    AK.cles.oublier();
    AK.auth.oublierConfirmation();
    const s = AK.session.courante();
    const el = ecranPlein(html`${marque('Session verrouillée', AK.session.libelle())}
      <form class="pile" novalidate data-ep-form><div class="champ"><label for="ep-mdp">Mot de passe</label><input id="ep-mdp" class="inp" type="password" name="mdp" autocomplete="current-password" required></div>
      <button class="btn btn-pri btn-lg">${ic('unlock')}Déverrouiller</button><button type="button" class="btn btn-ghost" data-ep-sortir>${ic('logout')}Changer d’utilisateur</button></form>`, { photo: false });
    const f = $('[data-ep-form]', el);
    $('[data-ep-sortir]', el).onclick = () => deconnecter();
    f.onsubmit = async (e) => {
      e.preventDefault();
      ui.effacerErreurs(f);
      try {
        const login = s.role === 'ens' && !S().school.solo ? s.login : '';
        await AK.auth.connecter(login, f.mdp.value);
        AK.session.activite();
        fermerEcranPlein();
      } catch (err) {
        ui.erreurChamp(f, 'mdp', err.message || 'Mot de passe incorrect.');
        await u.attendre(600);
      }
    };
    setTimeout(() => AK.ui.focusInitial(f.mdp, f), 60);
  }
  async function deconnecter() {
    await AK.store.maintenant();
    AK.store.journaliser('Déconnexion');
    AK.session.fermer();
    AK.cles.oublier();
    AK.ui.fermerTiroir();
    document.querySelectorAll('dialog[open]').forEach((d) => d.remove());
    connexion();
  }

  /* ---------- Mots de passe ---------- */
  function motDePasseOublie() {
    if (AK.hote.type === 'bureau') return ui.info('Mot de passe oublié', 'Fermez l’application et utilisez « Mot de passe oublié » sur la fenêtre de connexion de l’application Windows.');
    ui.fenetre({
      titre: 'Mot de passe oublié', icone: 'key', taille: 'sm', ok: 'Valider', proteger: false,
      corps: html`<div class="pile"><p class="mut mb0">Saisissez le code de secours remis à la création de l’école, puis choisissez un nouveau mot de passe.</p>
        ${ui.champ.texte({ nom: 'code', lib: 'Code de secours', req: true, attrs: { placeholder: 'XXXX-XXXX-XXXX', autocomplete: 'off', autocapitalize: 'characters', autofocus: true } })}
        <div class="champ"><label for="mo-nw">Nouveau mot de passe</label><input id="mo-nw" class="inp" type="password" name="nw" autocomplete="new-password" required data-force><div class="force" data-n="0"><i></i><i></i><i></i><i></i></div></div>
        ${ui.encadre('Pour des raisons de sécurité, la clé de signature des documents protégée par l’ancien mot de passe sera retirée : vous en créerez une nouvelle. Les documents déjà émis restent vérifiables.', 'avert')}</div>`,
      apres: (r) => brancherForce(r),
      async surValider(d) {
        const code = await AK.auth.recupererAdmin(d.code, d.nw);
        AK.session.ouvrir({ role: 'dir' });
        setTimeout(() => montrerCodeSecours(code, () => ouvrirApplication()), 50);
      }
    });
  }
  ui.motDePasseOublie = motDePasseOublie;

  function changerMdpAdmin() {
    ui.fenetre({
      titre: 'Changer le mot de passe administrateur', icone: 'key', taille: 'sm', proteger: false,
      corps: html`<div class="pile">
        <div class="champ"><label for="cm-old">Mot de passe actuel</label><input id="cm-old" class="inp" type="password" name="old" autocomplete="current-password" required autofocus></div>
        <div class="champ"><label for="cm-nw">Nouveau mot de passe</label><input id="cm-nw" class="inp" type="password" name="nw" autocomplete="new-password" required data-force><div class="force" data-n="0"><i></i><i></i><i></i><i></i></div><div class="aide">${C.SECU.MDP_MIN} caractères au moins, lettres et chiffres.</div></div>
        <div class="champ"><label for="cm-nw2">Confirmez</label><input id="cm-nw2" class="inp" type="password" name="nw2" autocomplete="new-password" required></div></div>`,
      apres: (r) => brancherForce(r),
      async surValider(d) {
        if (d.nw !== d.nw2) throw new AK.ErreurMetier('Les deux mots de passe ne sont pas identiques.', 'nw2');
        await AK.auth.changerAdmin(d.old, d.nw);
        ui.toast('Mot de passe changé.');
      }
    });
  }
  function changerMdpEnseignant(premier) {
    const s = AK.session.courante();
    ui.fenetre({
      titre: premier ? 'Choisissez votre mot de passe' : 'Changer mon mot de passe', icone: 'key', taille: 'sm', proteger: false, annuler: premier ? false : 'Annuler',
      corps: html`<div class="pile">${premier ? ui.encadre('Votre mot de passe actuel est provisoire : choisissez-en un personnel.', 'avert') : ''}
        <div class="champ"><label for="ce-old">Mot de passe ${premier ? 'provisoire' : 'actuel'}</label><input id="ce-old" class="inp" type="password" name="old" required autofocus></div>
        <div class="champ"><label for="ce-nw">Nouveau mot de passe</label><input id="ce-nw" class="inp" type="password" name="nw" required data-force><div class="force" data-n="0"><i></i><i></i><i></i><i></i></div></div>
        <div class="champ"><label for="ce-nw2">Confirmez</label><input id="ce-nw2" class="inp" type="password" name="nw2" required></div></div>`,
      apres: (r) => brancherForce(r),
      async surValider(d) {
        if (d.nw !== d.nw2) throw new AK.ErreurMetier('Les deux mots de passe ne sont pas identiques.', 'nw2');
        if (S().school.solo) await AK.auth.changerAdmin(d.old, d.nw);
        else await AK.auth.changerMotDePasseEnseignant(s.tid, d.old, d.nw);
        ui.toast('Mot de passe changé.');
      }
    });
  }
  AK.actions.def({
    'changer-mdp-admin': changerMdpAdmin,
    'changer-mdp-ens': () => changerMdpEnseignant(false),
    async 'nouveau-secours'() {
      const mdp = await ui.saisirMotDePasse('Créer un nouveau code de secours ? L’ancien ne servira plus.');
      if (!mdp) return;
      const code = await AK.auth.nouveauSecours(mdp);
      montrerCodeSecours(code, () => AK.shell.redessiner());
    },
    async 'quitter-demo'() {
      const ok = await ui.confirmer({ titre: 'Quitter la démonstration', message: 'Les données fictives de démonstration seront effacées de ce navigateur, puis l’assistant de création de votre école s’ouvrira.', ok: 'Effacer la démonstration', danger: true });
      if (!ok) return;
      await AK.stockage.actif.effacerTout();
      location.reload();
    },
    'lire-messages'() {
      const a = AK.session.agent();
      if (!a) return;
      const L = S().messages.filter((m) => !m.dest || m.dest === a.id);
      ui.fenetre({
        titre: 'Messages du directeur', icone: 'mail', ok: 'Fermer', annuler: false, proteger: false,
        corps: L.length ? html`<div class="liste">${L.map((m) => html`<div style="display:block"><b>${m.titre}</b> <span class="mut petit">· ${u.fmtHorodatage(m.t)}</span><div style="white-space:pre-wrap">${m.texte}</div></div>`)}</div>` : ui.vide('Aucun message'),
        surFermer: () => AK.personnel.marquerLus(a.id)
      });
    }
  });

  /* ---------- Démarrage ---------- */
  async function demarrer() {
    try {
      const etatHote = await AK.hote.demarrer();
      let etat = null, notes = [];
      if (etatHote) ({ etat, notes } = AK.schema.migrer(etatHote));
      else if (AK.hote.type !== 'bureau') {
        const r = await AK.stockage.actif.charger();
        if (r) {
          ({ etat, notes } = AK.schema.migrer(r.S));
          if (r.manquantes.length) notes.push(`${u.pluriel(r.manquantes.length, 'image')} introuvable(s) dans le stockage : remplacée(s) par un emplacement vide.`);
        }
      } else if (AK.hote.type === 'bureau') {
        etat = AK.schema.vierge();
      }
      if (!etat) return assistant();
      await AK.auth.migrerSecrets(etat);
      AK.store.installer(etat);
      if (notes.length && etat.meta.migreDe) await AK.store.maintenant();
      connexion();
      AK.diag.info('Démarrage : ' + AK.stockage.description());
    } catch (e) {
      AK.diag.erreur(e, 'démarrage');
      ecranPlein(html`${marque('Démarrage impossible', '')}${ui.encadre(html`Les données n’ont pas pu être chargées : <b>${e.message || e}</b>. Rien n’a été effacé. Essayez de recharger la page ; si le problème persiste, restaurez une sauvegarde.`, 'erreur')}<button class="btn btn-pri" onclick="location.reload()">${ic('refresh')}Recharger</button>`);
    }
  }

  AK.app = { demarrer, verrouiller, deconnecter, connexion, montrerCodeSecours, installer };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else setTimeout(demarrer, 0);
})(window.AK);
