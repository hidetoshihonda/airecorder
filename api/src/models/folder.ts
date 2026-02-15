// Folder data model for Cosmos DB

export interface FolderDocument {
  id: string;
  userId: string;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  type: "folder";
}

// Frontend-compatible Folder type (without internal fields)
export interface Folder {
  id: string;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFolderRequest {
  userId: string;
  name: string;
  color?: string;
}

export interface UpdateFolderRequest {
  name?: string;
  color?: string;
  sortOrder?: number;
}
