import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;

export function creerClient(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DATABASE_URL n'est pas défini (voir .env.example).");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

// Un seul client par processus, y compris lors des rechargements à chaud en développement.
const globalPourPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function db(): PrismaClient {
  globalPourPrisma.prisma ??= creerClient();
  return globalPourPrisma.prisma;
}
