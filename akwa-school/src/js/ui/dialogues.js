/* =====================================================================================
   Notifications, fenêtres, confirmations, mot de passe, menus et bulles.

   Fenêtres : une balise <dialog> par fenêtre (elles peuvent s'empiler) ; Échap et la croix
   ferment toujours ; une saisie non enregistrée est protégée par une confirmation ;
   une erreur de validation s'affiche sous le champ concerné SANS effacer la saisie.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, $, $$ } = u, ic = AK.ic;
  const ui = (AK.ui = AK.ui || {});

  /* ---------- Notifications ---------- */
  let zoneToasts = null;
  /**
   * Focus initial différé d'un écran ou d'une fenêtre : ne vole jamais le focus si l'utilisateur a déjà
   * commencé à saisir ailleurs dans le même cadre (sur un poste lent, sa frappe irait dans le premier champ).
   */
  ui.focusInitial = (el, cadre) => {
    const a = document.activeElement;
    if (!el || !el.isConnected) return;
    if (a && a !== document.body && a !== el && cadre && cadre.contains(a) && /INPUT|TEXTAREA|SELECT|BUTTON/.test(a.tagName)) return;
    el.focus();
  };
  ui.toast = function (message, o = {}) {
    if (!zoneToasts) {
      zoneToasts = document.createElement('div');
      zoneToasts.className = 'toasts';
      zoneToasts.setAttribute('aria-live', 'polite');
      document.body.appendChild(zoneToasts);
    }
    const type = o.type || 'ok';
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', type === 'erreur' ? 'alert' : 'status');
    u.poser(el, html`${ic(type === 'erreur' ? 'alert' : type === 'avert' ? 'warn' : type === 'attente' ? 'clock' : 'checkCircle')}<span class="tx">${message}</span>${o.action ? html`<button type="button" class="act">${o.action.lib}</button>` : ''}<button type="button" class="fermer" aria-label="Fermer la notification">×</button>`);
    zoneToasts.appendChild(el);
    while (zoneToasts.children.length > 4) zoneToasts.firstChild.remove();
    let t = null;
    const fermer = () => {
      clearTimeout(t);
      el.classList.add('sortie');
      setTimeout(() => el.remove(), 180);
    };
    el.querySelector('.fermer').onclick = fermer;
    if (o.action) el.querySelector('.act').onclick = () => {
      fermer();
      o.action.f();
    };
    const duree = o.duree ?? (type === 'erreur' ? 9000 : Math.min(8000, 3200 + String(message).length * 35));
    if (duree > 0) t = setTimeout(fermer, duree);
    el.addEventListener('mouseenter', () => clearTimeout(t));
    el.addEventListener('mouseleave', () => duree > 0 && (t = setTimeout(fermer, 2500)));
    return { fermer };
  };

  /** Affiche une erreur : message métier clair, ou erreur technique journalisée. */
  ui.erreur = function (e, contexte) {
    if (e && (e.name === 'ErreurMetier' || e.name === 'ErreurDroits')) {
      ui.toast(e.message, { type: 'erreur' });
      return;
    }
    AK.diag.erreur(e, contexte);
    ui.toast('Une erreur inattendue est survenue. L’opération n’a pas été effectuée. (Détail dans Paramètres › Diagnostic.)', { type: 'erreur' });
  };

  /* ---------- Formulaires ---------- */
  /** Valeurs d'un formulaire : cases à cocher multiples → tableau, case seule → booléen. */
  ui.lireFormulaire = function (form) {
    const o = {};
    const noms = new Set([...form.elements].map((x) => x.name).filter(Boolean));
    noms.forEach((n) => {
      const els = [...form.elements].filter((x) => x.name === n);
      const t = els[0].type;
      if (t === 'checkbox') o[n] = els.length > 1 || els[0].dataset.multiple != null ? els.filter((x) => x.checked).map((x) => x.value) : els[0].checked;
      else if (t === 'radio') o[n] = (els.find((x) => x.checked) || {}).value || '';
      else if (t === 'file') return;
      else o[n] = els[0].value;
    });
    return o;
  };
  ui.effacerErreurs = function (form) {
    $$('.erreur-champ', form).forEach((x) => x.remove());
    $$('[aria-invalid="true"]', form).forEach((x) => x.removeAttribute('aria-invalid'));
    $$('.err-pt', form).forEach((x) => x.remove());
    const g = $('.erreur-form', form);
    if (g) g.remove();
  };
  /** Erreur sous le champ « champ » (ou en tête du formulaire), avec bascule d'onglet si besoin. */
  ui.erreurChamp = function (form, champ, message) {
    const el = champ ? form.querySelector(`[name="${CSS.escape(champ)}"]`) : null;
    if (el) {
      const panneau = el.closest('[role="tabpanel"]');
      if (panneau && panneau.hidden) {
        const b = form.querySelector(`[role="tab"][aria-controls="${panneau.id}"]`);
        if (b) b.click();
      }
      if (panneau) {
        const b = form.querySelector(`[role="tab"][aria-controls="${panneau.id}"]`);
        if (b && !b.querySelector('.err-pt')) b.insertAdjacentHTML('beforeend', '<span class="err-pt" aria-hidden="true"></span>');
      }
      el.setAttribute('aria-invalid', 'true');
      const id = 'err-' + u.uid();
      const box = el.closest('.champ') || el.parentElement;
      box.insertAdjacentHTML('beforeend', String(html`<div class="erreur-champ" id="${id}">${ic('alert')}<span>${message}</span></div>`));
      el.setAttribute('aria-describedby', id);
      el.focus({ preventScroll: false });
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      const corps = $('.dlg-corps', form) || form;
      corps.insertAdjacentHTML('afterbegin', String(html`<div class="erreur-form" role="alert">${ic('alert')}<span>${message}</span></div>`));
      corps.scrollTop = 0;
    }
  };
  /** Onglets d'un formulaire (role="tablist") : bascule simple et accessible. */
  ui.activerOnglets = function (racine) {
    $$('[role="tablist"]', racine).forEach((liste) => {
      const onglets = $$('[role="tab"]', liste);
      const choisir = (b) => {
        onglets.forEach((x) => {
          const sel = x === b;
          x.setAttribute('aria-selected', String(sel));
          x.tabIndex = sel ? 0 : -1;
          const p = document.getElementById(x.getAttribute('aria-controls'));
          if (p) p.hidden = !sel;
        });
      };
      onglets.forEach((b) => {
        b.addEventListener('click', () => choisir(b));
        b.addEventListener('keydown', (e) => {
          const i = onglets.indexOf(b);
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const n = onglets[(i + (e.key === 'ArrowRight' ? 1 : -1) + onglets.length) % onglets.length];
            n.focus();
            choisir(n);
          }
        });
      });
    });
  };

  /* ---------- Fenêtres ---------- */
  /**
   * Ouvre une fenêtre.
   * o = { titre, icone, taille: 'sm'|''|'lg'|'xl'|'plein', corps (Html), pied (Html, remplace les boutons),
   *       ok: 'Enregistrer', annuler: 'Annuler', okStyle: 'pri'|'dng', sansPied, proteger (défaut : vrai si champs),
   *       surValider(donnees, form, fenetre) → false pour garder ouverte ; peut lever ErreurMetier(message, champ),
   *       apres(racine, fenetre), surFermer() }
   */
  ui.fenetre = function (o) {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg ' + (o.taille || '');
    dlg.setAttribute('aria-labelledby', 'tdlg-' + u.uid());
    const idTitre = dlg.getAttribute('aria-labelledby');
    const boutons = o.sansPied
      ? ''
      : o.pied || html`<span class="modif">Modifications non enregistrées</span><span class="espace"></span>${o.annuler === false ? '' : html`<button type="button" class="btn" data-fermer>${o.annuler || 'Annuler'}</button>`}${o.ok === false ? '' : html`<button type="submit" class="btn ${o.okStyle === 'dng' ? 'btn-dng-plein' : 'btn-pri'}">${o.ok || 'Enregistrer'}</button>`}`;
    u.poser(dlg, html`<form class="dlg-f" novalidate autocomplete="off"><div class="dlg-tete${o.danger ? ' danger' : ''}"><h2 id="${idTitre}">${o.icone ? ic(o.icone) : ''}<span class="tronque">${o.titre}</span></h2><button type="button" class="btn-ic" data-fermer aria-label="Fermer">${ic('x')}</button></div><div class="dlg-corps">${o.corps || ''}</div>${o.sansPied ? '' : html`<div class="dlg-pied">${boutons}</div>`}</form>`);
    document.body.appendChild(dlg);
    const form = $('form', dlg);
    let ferme = false;
    const champs = () => [...form.elements].filter((x) => x.name && x.type !== 'password' && x.type !== 'hidden');
    const proteger = o.proteger ?? champs().length >= 2;
    const fenetre = {
      dlg, form,
      fermer(force) {
        if (ferme) return;
        if (!force && proteger && form.classList.contains('modifie')) {
          ui.confirmer({ titre: 'Modifications non enregistrées', message: 'Les informations saisies dans cette fenêtre ne sont pas enregistrées. Voulez-vous vraiment la fermer ?', ok: 'Fermer sans enregistrer', annuler: 'Continuer la saisie', danger: true }).then((ok) => ok && fenetre.fermer(true));
          return;
        }
        ferme = true;
        if (dlg.open) dlg.close();
        dlg.remove();
        if (o.surFermer) o.surFermer();
      },
      occuper(oui) {
        const b = $('[type="submit"]', form);
        if (b) b.classList.toggle('occupe', !!oui);
      }
    };
    if (proteger) {
      form.addEventListener('input', () => form.classList.add('modifie'));
      form.addEventListener('change', () => form.classList.add('modifie'));
    }
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      fenetre.fermer();
    });
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-fermer]')) {
        e.preventDefault();
        fenetre.fermer();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!o.surValider) return fenetre.fermer(true);
      ui.effacerErreurs(form);
      fenetre.occuper(true);
      try {
        const r = await o.surValider(ui.lireFormulaire(form), form, fenetre);
        if (r !== false) fenetre.fermer(true);
      } catch (err) {
        if (err && (err.name === 'ErreurMetier' || err.name === 'ErreurDroits')) ui.erreurChamp(form, err.champ, err.message);
        else ui.erreur(err, 'fenêtre ' + o.titre);
      } finally {
        fenetre.occuper(false);
      }
    });
    ui.activerOnglets(dlg);
    dlg.showModal();
    if (o.apres) o.apres(dlg, fenetre);
    const premier = $('[autofocus]', dlg) || $('.dlg-corps input:not([type=hidden]):not([disabled]), .dlg-corps select, .dlg-corps textarea', dlg);
    if (premier) setTimeout(() => ui.focusInitial(premier, dlg), 30);
    return fenetre;
  };

  /** Confirmation explicite ; « saisie » oblige à recopier un mot (actions très destructrices). */
  ui.confirmer = function ({ titre = 'Confirmation', message, ok = 'Confirmer', annuler = 'Annuler', danger = false, saisie = null, icone } = {}) {
    return new Promise((res) => {
      let rep = false;
      ui.fenetre({
        titre, icone: icone || (danger ? 'warn' : 'help'), taille: 'sm', danger, ok, annuler, okStyle: danger ? 'dng' : 'pri', proteger: false,
        corps: html`<div class="pile"><div>${message}</div>${saisie ? html`<div class="champ"><label for="cf-saisie">Pour confirmer, tapez <b>${saisie}</b></label><input id="cf-saisie" class="inp" name="saisie" autocomplete="off" autofocus></div>` : ''}</div>`,
        surValider(d) {
          if (saisie && String(d.saisie || '').trim().toUpperCase() !== saisie.toUpperCase()) throw new AK.ErreurMetier(`Tapez exactement ${saisie} pour confirmer.`, 'saisie');
          rep = true;
        },
        surFermer: () => res(rep)
      });
    });
  };

  /** Information simple (une seule action « Fermer »). */
  ui.info = function (titre, corps, o = {}) {
    return ui.fenetre({ titre, corps, ok: o.ok || 'Fermer', annuler: false, taille: o.taille || 'sm', icone: o.icone || 'info', proteger: false });
  };

  function fenetreMotDePasse(message, renvoyerSecret) {
    return new Promise((res) => {
      let rep = renvoyerSecret ? null : false;
      const f = ui.fenetre({
        titre: 'Mot de passe administrateur', icone: 'lock', taille: 'sm', ok: 'Valider', proteger: false,
        corps: html`<div class="pile"><p class="mb0">${message}</p>
          <div class="champ"><label for="mdp-admin">Mot de passe du directeur</label><input id="mdp-admin" class="inp" type="password" name="pwd" autocomplete="current-password" autofocus required></div>
          ${AK.hote.authentificationLocale ? html`<button type="button" class="lien petit" data-mdp-oublie>Mot de passe oublié ?</button>` : ''}</div>`,
        async surValider(d) {
          if (!d.pwd) throw new AK.ErreurMetier('Saisissez le mot de passe.', 'pwd');
          if (!(await AK.auth.verifierAdmin(d.pwd))) {
            AK.store.journaliser('Mot de passe administrateur refusé');
            throw new AK.ErreurMetier('Mot de passe incorrect. Réessayez.', 'pwd');
          }
          rep = renvoyerSecret ? d.pwd : true;
        },
        surFermer: () => res(rep),
        apres(racine) {
          const l = $('[data-mdp-oublie]', racine);
          if (l) l.onclick = () => {
            f.fermer(true);
            ui.motDePasseOublie && ui.motDePasseOublie();
          };
        }
      });
    });
  }
  /** Vérifie le mot de passe administrateur : true / false. */
  ui.demanderMotDePasse = (message) => fenetreMotDePasse(message, false);
  /** Demande et vérifie le mot de passe, puis le renvoie (déverrouillage de la clé de signature) ou null. */
  ui.saisirMotDePasse = (message) => fenetreMotDePasse(message, true);

  /* ---------- Menus déroulants ---------- */
  let menuOuvert = null;
  ui.fermerMenu = () => {
    if (menuOuvert) {
      menuOuvert.el.remove();
      if (menuOuvert.ancre) menuOuvert.ancre.setAttribute('aria-expanded', 'false');
      menuOuvert = null;
    }
  };
  /** items : [{ lib, sous, icone, f, danger }] | 'sep' | Html ; titre facultatif */
  ui.menu = function (ancre, items, titre) {
    if (menuOuvert && menuOuvert.ancre === ancre) return ui.fermerMenu();
    ui.fermerMenu();
    const el = document.createElement('div');
    el.className = 'menu';
    el.setAttribute('role', 'menu');
    const fonctions = [];
    u.poser(el, html`${titre ? html`<h4>${titre}</h4>` : ''}${items.map((it) => {
      if (it === 'sep') return html`<hr>`;
      if (it instanceof u.Html) return it;
      fonctions.push(it.f);
      return html`<button type="button" role="menuitem" data-i="${fonctions.length - 1}" class="${it.danger ? 'dng' : ''}">${it.icone ? ic(it.icone) : it.avant || ''}<span class="flex1">${it.lib}${it.sous ? html`<small>${it.sous}</small>` : ''}</span></button>`;
    })}`);
    document.body.appendChild(el);
    const r = ancre.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
    el.style.top = (r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    ancre.setAttribute('aria-expanded', 'true');
    menuOuvert = { el, ancre };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const f = fonctions[+b.dataset.i];
      ui.fermerMenu();
      if (f) Promise.resolve().then(f).catch((err) => ui.erreur(err));
    });
    el.addEventListener('keydown', (e) => {
      const B = $$('button[data-i]', el), i = B.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        B[(i + (e.key === 'ArrowDown' ? 1 : -1) + B.length) % B.length].focus();
      }
      if (e.key === 'Escape') {
        ui.fermerMenu();
        ancre.focus();
      }
    });
    const b0 = $('button[data-i]', el);
    if (b0) b0.focus();
  };
  document.addEventListener('pointerdown', (e) => {
    if (menuOuvert && !menuOuvert.el.contains(e.target) && !menuOuvert.ancre.contains(e.target)) ui.fermerMenu();
  });
  addEventListener('resize', ui.fermerMenu);

  /* ---------- Bulles d'information (data-bulle) ---------- */
  let bulle = null;
  const montrerBulle = (t, x, y) => {
    if (!bulle) {
      bulle = document.createElement('div');
      bulle.className = 'bulle';
      bulle.setAttribute('role', 'tooltip');
      document.body.appendChild(bulle);
    }
    bulle.textContent = t;
    bulle.hidden = false;
    bulle.style.left = Math.max(8, Math.min(x + 12, innerWidth - bulle.offsetWidth - 8)) + 'px';
    bulle.style.top = Math.min(y + 16, innerHeight - bulle.offsetHeight - 8) + 'px';
  };
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-bulle]');
    if (!t || !t.dataset.bulle) {
      if (bulle) bulle.hidden = true;
      return;
    }
    montrerBulle(t.dataset.bulle, e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', (e) => {
    if (bulle && !bulle.hidden && e.target.closest('[data-bulle]')) montrerBulle(bulle.textContent, e.clientX, e.clientY);
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest && e.target.closest('[data-bulle]');
    if (!t || !t.dataset.bulle) {
      if (bulle) bulle.hidden = true;
      return;
    }
    const r = t.getBoundingClientRect();
    montrerBulle(t.dataset.bulle, r.left, r.bottom - 8);
  });
  document.addEventListener('scroll', () => bulle && (bulle.hidden = true), true);
})(window.AK);
