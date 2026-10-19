import { MongoClient, type Db } from "mongodb";

const globalMongo = globalThis as typeof globalThis & {
  __openstateMongo?: Promise<MongoClient>;
};

function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  // One long-lived dev/demo server with a few dashboards, ingest calls and
  // change streams, so the driver's default pool (max 100) is ample.
  return new MongoClient(uri, { appName: "openstate" }).connect();
}

function mongoClient() {
  globalMongo.__openstateMongo ??= connect().catch((error) => {
    globalMongo.__openstateMongo = undefined;
    throw error;
  });
  return globalMongo.__openstateMongo;
}

export async function db(): Promise<Db> {
  return (await mongoClient()).db(process.env.MONGODB_DB ?? "openstate");
}
