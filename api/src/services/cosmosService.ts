import { CosmosClient, Container, Database } from "@azure/cosmos";

let client: CosmosClient | null = null;
let database: Database | null = null;
let recordingsContainer: Container | null = null;
let userSettingsContainer: Container | null = null;
let templatesContainer: Container | null = null;

const connectionString = process.env.COSMOS_CONNECTION_STRING || "";
const databaseName = process.env.COSMOS_DATABASE_NAME || "airecorder";
const containerName = process.env.COSMOS_CONTAINER_NAME || "recordings";

export function getCosmosClient(): CosmosClient {
  if (!client) {
    if (!connectionString) {
      throw new Error("COSMOS_CONNECTION_STRING is not configured");
    }
    client = new CosmosClient(connectionString);
  }
  return client;
}

export async function getDatabase(): Promise<Database> {
  if (!database) {
    const cosmosClient = getCosmosClient();
    const { database: db } = await cosmosClient.databases.createIfNotExists({
      id: databaseName,
    });
    database = db;
  }
  return database;
}

export async function getRecordingsContainer(): Promise<Container> {
  if (!recordingsContainer) {
    const db = await getDatabase();
    const { container } = await db.containers.createIfNotExists({
      id: containerName,
      partitionKey: { paths: ["/userId"] },
    });
    recordingsContainer = container;
  }
  return recordingsContainer;
}

export async function getUserSettingsContainer(): Promise<Container> {
  if (!userSettingsContainer) {
    const db = await getDatabase();
    const { container } = await db.containers.createIfNotExists({
      id: "userSettings",
      partitionKey: { paths: ["/userId"] },
    });
    userSettingsContainer = container;
  }
  return userSettingsContainer;
}

export async function getTemplatesContainer(): Promise<Container> {
  if (!templatesContainer) {
    const db = await getDatabase();
    const { container } = await db.containers.createIfNotExists({
      id: "templates",
      partitionKey: { paths: ["/userId"] },
    });
    templatesContainer = container;
  }
  return templatesContainer;
}
