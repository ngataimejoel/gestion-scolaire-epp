/** Étape 10 : offres, essai, lecture seule, limites, paiement (simulation, CinetPay, Wave), rappels, administration. */
import { createHmac } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { baseDeTest, baseDisponible, viderBase } from "./aides/base";
import { ecoleDuClasseur } from "./aides/classeur";
import {
  ajouterJours,
  aLaFonction,
  ecritureBloquee,
  etatAbonnement,
  initialiserOffres,
  limiteAtteinte,
  majOffre,
  JOUR_MS,
} from "../src/lib/abonnement";
import { creerAdministrateur } from "../src/lib/abonnement/admin";
import { activerManuellement, actualiserPaiement, appliquerVerification, demanderPaiement, rappelsAbonnement, simulerPaiement } from "../src/lib/paiement";
import { fournisseursActifs, signatureWaveValide } from "../src/lib/paiement/fournisseurs";
import { inscrireEleve } from "../src/lib/eleves";

describe("Signature des notifications Wave", () => {
  const secret = "secret-de-test";
  const corps = '{"type":"checkout.session.completed","data":{"id":"cos-1","client_reference":"p1"}}';
  const t = 1_800_000_000;
  const sig = createHmac("sha256", secret).update(`${t}${corps}`).digest("hex");
  it("accepte une signature correcte et récente", () => {
    expect(signatureWaveValide(corps, `t=${t},v1=${sig}`, secret, t + 10)).toBe(true);
  });
  it("refuse un corps modifié, une mauvaise clé ou une signature trop ancienne", () => {
    expect(signatureWaveValide(corps.replace("p1", "p2"), `t=${t},v1=${sig}`, secret, t)).toBe(false);
    expect(signatureWaveValide(corps, `t=${t},v1=${sig}`, "autre", t)).toBe(false);
    expect(signatureWaveValide(corps, `t=${t},v1=${sig}`, secret, t + 3600)).toBe(false);
    expect(signatureWaveValide(corps, "", secret, t)).toBe(false);
  });
});

describe("Fournisseurs actifs", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("simulation par défaut, refusée en production sauf autorisation explicite", () => {
    vi.stubEnv("PAYMENT_PROVIDERS", "simulation,cinetpay,inconnu");
    expect(fournisseursActifs().map((f) => f.nom)).toEqual(["simulation", "cinetpay"]);
    vi.stubEnv("NODE_ENV", "production");
    expect(fournisseursActifs().map((f) => f.nom)).toEqual(["cinetpay"]);
    vi.stubEnv("AUTORISER_PAIEMENT_SIMULE", "oui");
    expect(fournisseursActifs().map((f) => f.nom)).toEqual(["simulation", "cinetpay"]);
  });
});

describe.skipIf(!baseDisponible)("Abonnement et paiement", () => {
  const db = baseDeTest();
  let ecole: Awaited<ReturnType<typeof ecoleDuClasseur>>;
  const plan = (code: string) => db.plan.findUniqueOrThrow({ where: { code } });

  beforeAll(async () => {
    await viderBase(db);
    ecole = await ecoleDuClasseur(db);
  }, 60_000);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("offres chargées une seule fois depuis le fichier de départ, jamais écrasées", async () => {
    await initialiserOffres(db);
    expect(await db.plan.count()).toBe(3);
    await db.plan.update({ where: { code: "STANDARD" }, data: { priceXof: 12345 } });
    expect(await initialiserOffres(db)).toBe(0);
    expect((await plan("STANDARD")).priceXof).toBe(12345);
  });

  it("une école sans abonnement reçoit l'essai ; à l'échéance, lecture seule sans perte de données", async () => {
    const id = ecole.school.id;
    const e = await etatAbonnement(db, id);
    expect(e).toMatchObject({ actif: true, essai: true, lectureSeule: false, joursRestants: 30 });
    expect(await ecritureBloquee(db, ecole.directeur)).toBeNull();
    expect(await aLaFonction(db, id, "notes")).toBe(true);
    expect(await aLaFonction(db, id, "assistant")).toBe(false);
    const plusTard = ajouterJours(new Date(), 31);
    const expire = await etatAbonnement(db, id, plusTard);
    expect(expire).toMatchObject({ actif: false, lectureSeule: true, joursRestants: 0 });
    expect(await db.subscription.count({ where: { schoolId: id, status: "EXPIRED" } })).toBe(1);
    expect(await db.student.count({ where: { schoolId: id } })).toBe(64);
    // pas de nouvel essai après expiration
    expect((await etatAbonnement(db, id, plusTard)).actif).toBe(false);
    expect(await db.subscription.count({ where: { schoolId: id } })).toBe(1);
  });

  it("paiement simulé : montant de l'offre en base, contrôle du montant, activation unique, renouvellement à la suite", async () => {
    const id = ecole.school.id;
    await db.subscription.updateMany({ where: { schoolId: id }, data: { status: "EXPIRED", endsAt: new Date(Date.now() - JOUR_MS) } });
    expect(await ecritureBloquee(db, ecole.directeur)).toMatch(/lecture seule/);
    const standard = await plan("STANDARD");

    // Un enseignant ne peut pas payer ; l'essai ne se paie pas
    expect((await demanderPaiement(db, { ...ecole.directeur, role: "TEACHER" }, { planId: standard.id, fournisseur: "simulation" }, "http://x")).ok).toBe(false);
    expect((await demanderPaiement(db, ecole.directeur, { planId: (await plan("TRIAL")).id, fournisseur: "simulation" }, "http://x")).ok).toBe(false);

    const r = await demanderPaiement(db, ecole.directeur, { planId: standard.id, fournisseur: "simulation" }, "http://x");
    if (!r.ok) throw new Error(r.erreur);
    expect(r.urlPaiement).toBe(`/abonnement/simulation?paiement=${r.paymentId}`);
    expect((await db.payment.findUniqueOrThrow({ where: { id: r.paymentId } })).amountXof).toBe(12345);

    // Montant incohérent : refusé
    expect(await appliquerVerification(db, { reference: r.paymentId, statut: "SUCCEEDED", montant: 100 }, "test")).toBe("echec");
    expect((await etatAbonnement(db, id)).actif).toBe(false);

    // Montant correct : activé une seule fois même si la confirmation arrive deux fois
    const v = { reference: r.paymentId, statut: "SUCCEEDED" as const, montant: 12345, devise: "XOF" };
    const [a, b] = await Promise.all([appliquerVerification(db, v, "test"), appliquerVerification(db, v, "test")]);
    expect([a, b].sort()).toEqual(["active", "ignore"]);
    const e = await etatAbonnement(db, id);
    expect(e).toMatchObject({ actif: true, essai: false, lectureSeule: false });
    expect(e.plan?.code).toBe("STANDARD");
    expect(e.joursRestants).toBe(365);
    expect(await db.notification.count({ where: { schoolId: id, title: "Paiement reçu" } })).toBe(1);
    expect(await db.auditLog.count({ where: { schoolId: id, action: "abonnement_active" } })).toBe(1);

    // Renouvellement payé à l'avance : s'ajoute après la période en cours
    const r2 = await demanderPaiement(db, ecole.directeur, { planId: standard.id, fournisseur: "simulation" }, "http://x");
    if (!r2.ok) throw new Error(r2.erreur);
    expect((await simulerPaiement(db, ecole.directeur, r2.paymentId, true)).ok).toBe(true);
    expect((await etatAbonnement(db, id)).joursRestants).toBe(730);
    // Une autre école ne peut pas confirmer ce paiement
    expect((await simulerPaiement(db, { ...ecole.directeur, schoolId: "autre" }, r2.paymentId, true)).ok).toBe(false);
  });

  it("CinetPay : la page de retour relit le statut chez le fournisseur avant d'activer", async () => {
    vi.stubEnv("PAYMENT_PROVIDERS", "cinetpay");
    vi.stubEnv("CINETPAY_API_KEY", "cle");
    vi.stubEnv("CINETPAY_SITE_ID", "123");
    const appels: { url: string; corps: Record<string, unknown> }[] = [];
    let statut = "PENDING";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      appels.push({ url, corps: JSON.parse(String(init.body)) });
      if (url.endsWith("/payment")) return new Response(JSON.stringify({ code: "201", data: { payment_url: "https://checkout.cinetpay.com/x", payment_token: "tok" } }));
      return new Response(JSON.stringify({ code: "00", data: { status: statut, amount: "60000", currency: "XOF" } }));
    });
    const premium = await plan("PREMIUM");
    const r = await demanderPaiement(db, ecole.directeur, { planId: premium.id, fournisseur: "cinetpay" }, "https://ecole.ci");
    if (!r.ok) throw new Error(r.erreur);
    expect(r.urlPaiement).toBe("https://checkout.cinetpay.com/x");
    expect(appels[0].corps).toMatchObject({ amount: 60000, currency: "XOF", transaction_id: r.paymentId, notify_url: "https://ecole.ci/api/paiement/cinetpay" });
    expect(await actualiserPaiement(db, r.paymentId)).toBe("PENDING");
    statut = "ACCEPTED";
    expect(await actualiserPaiement(db, r.paymentId)).toBe("SUCCEEDED");
    expect(appels.at(-1)!.corps).toMatchObject({ transaction_id: r.paymentId, site_id: "123" });
  });

  it("échec du fournisseur au démarrage : paiement et abonnement marqués en échec", async () => {
    vi.stubEnv("PAYMENT_PROVIDERS", "wave");
    vi.stubEnv("WAVE_API_KEY", "cle");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: "unauthorized", message: "Clé invalide" }), { status: 401 }));
    const r = await demanderPaiement(db, ecole.directeur, { planId: (await plan("STANDARD")).id, fournisseur: "wave" }, "https://ecole.ci");
    expect(r).toMatchObject({ ok: false });
    const p = await db.payment.findFirstOrThrow({ where: { provider: "wave" } });
    expect(p.status).toBe("FAILED");
    expect((await db.subscription.findUniqueOrThrow({ where: { id: p.subscriptionId } })).status).toBe("PAYMENT_FAILED");
  });

  it("limites de l'offre : élèves", async () => {
    const autre = await ecoleDuClasseur(db, "0102030405", "AUTRE-ECOLE");
    // Requêtes simultanées : un seul essai est ouvert
    const t0 = Date.now();
    const etats = await Promise.all([0, 1, 2, 3].map((i) => etatAbonnement(db, autre.school.id, new Date(t0 + i))));
    expect(etats.every((e) => e.actif && e.essai)).toBe(true);
    expect(await db.subscription.count({ where: { schoolId: autre.school.id } })).toBe(1);
    await db.plan.update({ where: { code: "TRIAL" }, data: { maxStudents: 64 } });
    expect(await limiteAtteinte(db, autre.school.id, "eleves")).toMatch(/limitée à 64 élèves/);
    const classe = await db.classroom.findFirstOrThrow({ where: { schoolId: autre.school.id, name: "CP1" } });
    const r = await inscrireEleve(db, autre.directeur, {
      classroomId: classe.id, fullName: "TEST Limite", sex: "M", birthDate: "2020-01-01", nationality: "IVOIRIENNE",
    } as unknown as Parameters<typeof inscrireEleve>[2]);
    expect(r).toMatchObject({ ok: false, erreur: expect.stringMatching(/limitée/) });
    await db.plan.update({ where: { code: "TRIAL" }, data: { maxStudents: 100 } });
    expect(await limiteAtteinte(db, autre.school.id, "eleves")).toBeNull();
  });

  it("rappels J-15, J-7, J-1 : une seule fois chacun", async () => {
    const autre = await db.school.findUniqueOrThrow({ where: { code: "AUTRE-ECOLE" } });
    const essai = await db.subscription.findFirstOrThrow({ where: { schoolId: autre.id, status: "ACTIVE" } });
    const maintenant = new Date(essai.endsAt!.getTime() - 7 * JOUR_MS);
    expect(await rappelsAbonnement(db, maintenant)).toBeGreaterThanOrEqual(1);
    expect(await rappelsAbonnement(db, maintenant)).toBe(0);
    const n = await db.notification.findMany({ where: { schoolId: autre.id, title: "Abonnement : fin dans 7 jours" } });
    expect(n.map((x) => x.channel).sort()).toEqual(["IN_APP", "SMS"]);
  });

  it("administration : offres modifiables par l'administrateur seul, activation manuelle tracée", async () => {
    const admin = await creerAdministrateur(db, { telephone: "0700000001", motDePasse: "Admin2026!", nom: "Admin" });
    if (!admin.ok) throw new Error(admin.erreur);
    expect((await creerAdministrateur(db, { telephone: "0700000001", motDePasse: "Autre2026!", nom: "X" })).ok).toBe(false);
    const a = { id: admin.id, role: "PLATFORM_ADMIN" as const, schoolId: null };
    const standard = await plan("STANDARD");
    const donnees = { name: "Standard", priceXof: "35000", durationDays: "365", maxStudents: "", maxTeachers: "20", features: ["notes", "inconnue"], isActive: true, position: "1" };
    expect((await majOffre(db, ecole.directeur, standard.id, donnees)).ok).toBe(false);
    expect((await majOffre(db, a, standard.id, { ...donnees, priceXof: "-5" })).ok).toBe(false);
    expect((await majOffre(db, a, standard.id, donnees)).ok).toBe(true);
    expect(await plan("STANDARD")).toMatchObject({ priceXof: 35000, maxStudents: null, maxTeachers: 20, features: ["notes"] });
    expect((await majOffre(db, a, (await plan("TRIAL")).id, { ...donnees, priceXof: "100" })).ok).toBe(false);
    expect((await majOffre(db, a, null, donnees, "ecole_plus")).ok).toBe(true);
    expect(await db.auditLog.count({ where: { entity: "Plan" } })).toBe(2);

    const autre = await db.school.findUniqueOrThrow({ where: { code: "AUTRE-ECOLE" } });
    expect((await activerManuellement(db, a, autre.id, standard.id, "")).ok).toBe(false);
    expect((await activerManuellement(db, a, autre.id, standard.id, "Reçu n° 42")).ok).toBe(true);
    const e = await etatAbonnement(db, autre.id);
    expect(e).toMatchObject({ actif: true, essai: false });
    expect(e.plan?.code).toBe("STANDARD");
    expect(await db.payment.count({ where: { schoolId: autre.id, provider: "manuel", status: "SUCCEEDED", amountXof: 35000 } })).toBe(1);
  });
});
