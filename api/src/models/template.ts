// Custom Template data model for Cosmos DB

export interface CustomTemplateDocument {
  id: string;
  userId: string;
  name: string;
  description: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
  type: "custom-template";
}

export interface CreateTemplateRequest {
  userId: string;
  name: string;
  description: string;
  systemPrompt: string;
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  systemPrompt?: string;
}

// Frontend-compatible CustomTemplate type (without internal fields)
export interface CustomTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}
