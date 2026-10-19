import { MongoClient } from "mongodb";
import { ensureSchema } from "../lib/db-schema.ts";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set. Run with: npm run db:setup");
  process.exit(1);
}

const client = new MongoClient(uri, { appName: "openstate-setup" });

try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB ?? "openstate");
  console.log(`setting up ${db.databaseName}`);
  await ensureSchema(db, (line) => console.log(`  ${line}`));
  console.log("done. Search indexes build asynchronously; rerun to see status.");
} finally {
  await client.close();
}
