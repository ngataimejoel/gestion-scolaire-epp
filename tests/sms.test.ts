/** Étape 12 : fournisseur SMS Orange (appels HTTP simulés, aucun envoi réel). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { adresseOrange, orange, oublierJetonOrange } from "../src/lib/sms/orange";
import { fournisseurSms } from "../src/lib/sms";

describe("SMS Orange", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    oublierJetonOrange();
  });

  it("numéros au format international", () => {
    expect(adresseOrange("07 30 90 80 35")).toBe("tel:+2250730908035");
    expect(adresseOrange("+225 0730908035")).toBe("tel:+2250730908035");
    expect(() => adresseOrange("123")).toThrow();
  });

  it("refuse d'envoyer sans configuration", async () => {
    await expect(orange.envoyer("0730908035", "x")).rejects.toThrow(/ORANGE_SMS_CLIENT_ID/);
  });

  it("jeton OAuth obtenu une fois, puis message envoyé à l'API", async () => {
    vi.stubEnv("SMS_PROVIDER", "orange");
    vi.stubEnv("ORANGE_SMS_CLIENT_ID", "id");
    vi.stubEnv("ORANGE_SMS_CLIENT_SECRET", "secret");
    vi.stubEnv("ORANGE_SMS_EXPEDITEUR", "0700000000");
    vi.stubEnv("SMS_SENDER", "GESTEPP");
    const appels: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      appels.push({ url, init });
      if (url.endsWith("/oauth/v3/token")) return new Response(JSON.stringify({ access_token: "jeton", expires_in: 3600 }), { status: 200 });
      return new Response("{}", { status: 201 });
    });
    expect(fournisseurSms().nom).toBe("orange");
    await fournisseurSms().envoyer("0730908035", "Votre code : 123456");
    await fournisseurSms().envoyer("0102030405", "Bonjour");
    expect(appels.map((a) => a.url)).toEqual([
      "https://api.orange.com/oauth/v3/token",
      "https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B2250700000000/requests",
      "https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B2250700000000/requests",
    ]);
    expect((appels[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    const corps = JSON.parse(String(appels[1].init.body));
    expect(corps.outboundSMSMessageRequest).toMatchObject({ address: "tel:+2250730908035", senderName: "GESTEPP", outboundSMSTextMessage: { message: "Votre code : 123456" } });
  });

  it("signale un envoi refusé", async () => {
    vi.stubEnv("ORANGE_SMS_CLIENT_ID", "id");
    vi.stubEnv("ORANGE_SMS_CLIENT_SECRET", "secret");
    vi.stubEnv("ORANGE_SMS_EXPEDITEUR", "0700000000");
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("/token") ? new Response(JSON.stringify({ access_token: "j", expires_in: 3600 }), { status: 200 }) : new Response("", { status: 403 }),
    );
    await expect(orange.envoyer("0730908035", "x")).rejects.toThrow("403");
  });
});
