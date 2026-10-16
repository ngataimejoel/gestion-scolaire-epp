// Serveur local (stockage en mémoire) pour les tests de l'application et du générateur.
// Usage : node dev/serveur-local.mjs <port> <cle_privee_pkcs8_base64> <jeton_admin>
import http from "node:http";
import { clePrivee, memoire, traiter } from "../lib/core.mjs";

const [port, cle, jeton] = process.argv.slice(2);
const ctx = { store: memoire(), privateKey: clePrivee(cle), jetonAdmin: jeton };
http.createServer(async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux);
  const r = await traiter(new Request(`http://localhost${req.url}`, {
    method: req.method, headers: req.headers, body: req.method === "POST" ? corps : undefined,
  }), ctx);
  res.writeHead(r.status, { "content-type": "application/json" });
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(Number(port), "127.0.0.1", () => console.log("pret"));
