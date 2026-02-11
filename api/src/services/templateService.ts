import { v4 as uuidv4 } from "uuid";
import { getTemplatesContainer } from "./cosmosService";
import {
  CustomTemplateDocument,
  CustomTemplate,
  CreateTemplateRequest,
  UpdateTemplateRequest,
} from "../models";

// Convert Cosmos document to API response format
function toCustomTemplate(doc: CustomTemplateDocument): CustomTemplate {
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    systemPrompt: doc.systemPrompt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * List all custom templates for a user
 */
export async function listTemplates(userId: string): Promise<CustomTemplate[]> {
  const container = await getTemplatesContainer();
  const { resources } = await container.items
    .query<CustomTemplateDocument>({
      query: "SELECT * FROM c WHERE c.userId = @userId AND c.type = @type ORDER BY c.createdAt DESC",
      parameters: [
        { name: "@userId", value: userId },
        { name: "@type", value: "custom-template" },
      ],
    })
    .fetchAll();
  return resources.map(toCustomTemplate);
}

/**
 * Create a new custom template
 */
export async function createTemplate(
  request: CreateTemplateRequest
): Promise<CustomTemplate> {
  const container = await getTemplatesContainer();
  const now = new Date().toISOString();

  const doc: CustomTemplateDocument = {
    id: uuidv4(),
    userId: request.userId,
    name: request.name,
    description: request.description || "",
    systemPrompt: request.systemPrompt,
    createdAt: now,
    updatedAt: now,
    type: "custom-template",
  };

  const { resource } = await container.items.create(doc);
  return toCustomTemplate(resource as CustomTemplateDocument);
}

/**
 * Get a single template by ID
 */
export async function getTemplate(
  id: string,
  userId: string
): Promise<CustomTemplate | null> {
  const container = await getTemplatesContainer();
  try {
    const { resource } = await container
      .item(id, userId)
      .read<CustomTemplateDocument>();
    return resource ? toCustomTemplate(resource) : null;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Update an existing template
 */
export async function updateTemplate(
  id: string,
  userId: string,
  updates: UpdateTemplateRequest
): Promise<CustomTemplate | null> {
  const container = await getTemplatesContainer();
  
  try {
    const { resource: doc } = await container
      .item(id, userId)
      .read<CustomTemplateDocument>();

    if (!doc) return null;

    const updated: CustomTemplateDocument = {
      ...doc,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const { resource } = await container.item(id, userId).replace(updated);
    return toCustomTemplate(resource as CustomTemplateDocument);
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a template
 */
export async function deleteTemplate(
  id: string,
  userId: string
): Promise<boolean> {
  const container = await getTemplatesContainer();
  try {
    await container.item(id, userId).delete();
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Bulk import templates (for migration from localStorage)
 */
export async function bulkImportTemplates(
  userId: string,
  templates: Array<{ name: string; description: string; systemPrompt: string }>
): Promise<CustomTemplate[]> {
  const results: CustomTemplate[] = [];
  for (const tmpl of templates) {
    const created = await createTemplate({
      userId,
      name: tmpl.name,
      description: tmpl.description,
      systemPrompt: tmpl.systemPrompt,
    });
    results.push(created);
  }
  return results;
}
