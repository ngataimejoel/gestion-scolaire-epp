/* =====================================================================================
   Primitives cryptographiques : uniquement l'API Web Crypto du navigateur (implémentation
   éprouvée du navigateur ; aucun algorithme maison).
     - Empreintes de mots de passe : PBKDF2-SHA-256 (sel aléatoire de 16 octets).
     - Chiffrement de la clé privée de signature : AES-GCM 256 bits, clé dérivée par PBKDF2.
     - Signature des documents : ECDSA P-256 / SHA-256.
     - Empreintes de contrôle : SHA-256.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const enc = new TextEncoder();

  const dispo = () => !!(window.crypto && crypto.subtle && window.isSecureContext !== false);
  const exiger = () => {
    if (!dispo()) throw new AK.ErreurMetier('La cryptographie du navigateur (Web Crypto) est indisponible ici : ouvrez AKWA SCHOOL dans Chrome, Edge ou Firefox récent.');
  };

  /* ---------- Encodages ---------- */
  const b64 = (buf) => {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const deB64url = (s) => deB64(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const b32 = (buf) => {
    const b = new Uint8Array(buf);
    let bits = 0, val = 0, out = '';
    for (const x of b) {
      val = (val << 8) | x;
      bits += 8;
      while (bits >= 5) {
        out += B32[(val >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += B32[(val << (5 - bits)) & 31];
    return out;
  };
  const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const aleatoire = (n) => crypto.getRandomValues(new Uint8Array(n));
  /** Comparaison à temps constant de deux tableaux d'octets. */
  const egaux = (a, b) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  };

  async function sha256(texte) {
    exiger();
    return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof texte === 'string' ? enc.encode(texte) : texte));
  }

  /* ---------- Mots de passe ---------- */
  async function pbkdf2(secret, sel, iterations, octets = 32) {
    const cle = await crypto.subtle.importKey('raw', enc.encode(String(secret).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations }, cle, octets * 8));
  }
  /** Empreinte d'un mot de passe (ou d'un code de secours) : { algo, iter, sel, empreinte }. */
  async function empreinteSecret(secret) {
    exiger();
    const sel = aleatoire(16), iter = AK.cfg.SECU.PBKDF2_ITER;
    const h = await pbkdf2(secret, sel, iter);
    return { algo: 'PBKDF2-SHA256', iter, sel: b64(sel), empreinte: b64(h) };
  }
  async function verifierSecret(secret, rec) {
    if (!rec || rec.algo !== 'PBKDF2-SHA256') return false;
    exiger();
    const h = await pbkdf2(secret, deB64(rec.sel), rec.iter);
    return egaux(h, deB64(rec.empreinte));
  }

  /* ---------- Chiffrement d'une donnée par un secret (clé privée de signature) ---------- */
  async function cleDeSecret(secret, sel, iter) {
    const bits = await pbkdf2(secret, sel, iter);
    return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async function chiffrer(octets, secret) {
    exiger();
    const sel = aleatoire(16), iv = aleatoire(12), iter = AK.cfg.SECU.PBKDF2_ITER;
    const k = await cleDeSecret(secret, sel, iter);
    const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, octets);
    return { algo: 'PBKDF2-AESGCM', iter, sel: b64(sel), iv: b64(iv), donnees: b64(c) };
  }
  async function dechiffrer(paquet, secret) {
    exiger();
    try {
      const k = await cleDeSecret(secret, deB64(paquet.sel), paquet.iter);
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(paquet.iv) }, k, deB64(paquet.donnees)));
    } catch (e) {
      return null; // secret incorrect ou donnée altérée
    }
  }

  /* ---------- Signature ECDSA P-256 ---------- */
  const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
  const SIG = { name: 'ECDSA', hash: 'SHA-256' };
  async function nouvellePaire() {
    exiger();
    const p = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const pub = await crypto.subtle.exportKey('jwk', p.publicKey);
    const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', p.privateKey));
    return { pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, priv };
  }
  async function importerPrivee(pkcs8) {
    return crypto.subtle.importKey('pkcs8', pkcs8, ALG, false, ['sign']);
  }
  async function importerPublique(jwk) {
    return crypto.subtle.importKey('jwk', { ...jwk, ext: true }, ALG, false, ['verify']);
  }
  async function signer(clePrivee, message) {
    return b64url(await crypto.subtle.sign(SIG, clePrivee, enc.encode(message)));
  }
  async function verifierSignature(jwk, message, signature) {
    exiger();
    try {
      const k = await importerPublique(jwk);
      return await crypto.subtle.verify(SIG, k, deB64url(signature), enc.encode(message));
    } catch (e) {
      return false;
    }
  }
  /** Empreinte lisible d'une clé publique : 4 groupes de 4 caractères (à comparer à voix haute). */
  async function empreinteCle(jwk) {
    const h = await sha256(`${jwk.crv}|${jwk.x}|${jwk.y}`);
    return b32(h.slice(0, 10)).match(/.{4}/g).join('-');
  }
  /** Code aléatoire lisible (ni 0/O ni 1/I) : XXXX-XXXX-XXXX… */
  function codeLisible(groupes = 3) {
    const A = AK.cfg.SECU.ALPHABET_CODE;
    const r = aleatoire(groupes * 4);
    let s = '';
    for (let i = 0; i < r.length; i++) s += A[r[i] % A.length];
    return s.match(/.{4}/g).join('-');
  }
  const normCode = (c) => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

  AK.crypto = {
    dispo, sha256, b64, deB64, b64url, deB64url, b32, hex, aleatoire, egaux,
    empreinteSecret, verifierSecret, chiffrer, dechiffrer,
    nouvellePaire, importerPrivee, importerPublique, signer, verifierSignature, empreinteCle,
    codeLisible, normCode
  };
})(window.AK);
