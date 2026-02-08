const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

interface UploadSasResponse {
  blobUrl: string;
  sasToken: string;
  fullUrl: string;
  expiresOn: string;
}

interface DownloadSasResponse {
  fullUrl: string;
  expiresOn: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

class BlobApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  /**
   * Get SAS token for uploading a file
   */
  async getUploadSas(fileName: string): Promise<ApiResponse<UploadSasResponse>> {
    try {
      const response = await fetch(
        `${this.baseUrl}/blob/upload-sas?fileName=${encodeURIComponent(fileName)}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const text = await response.text();
      if (!text) {
        return { success: false, error: 'Empty response from server' };
      }
      
      try {
        const data = JSON.parse(text);
        return data;
      } catch (parseError) {
        console.error('[BlobAPI] JSON parse error in getUploadSas:', parseError);
        return { success: false, error: 'Invalid JSON response' };
      }
    } catch (error) {
      console.error('[BlobAPI] getUploadSas error:', error);
      return {
        success: false,
        error: (error as Error).message || "Network error",
      };
    }
  }

  /**
   * Get SAS token for downloading/playing a file
   */
  async getDownloadSas(blobUrl: string): Promise<ApiResponse<DownloadSasResponse>> {
    try {
      const response = await fetch(
        `${this.baseUrl}/blob/download-sas?blobUrl=${encodeURIComponent(blobUrl)}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const text = await response.text();
      if (!text) {
        return { success: false, error: 'Empty response from server' };
      }
      
      try {
        const data = JSON.parse(text);
        return data;
      } catch (parseError) {
        console.error('[BlobAPI] JSON parse error in getDownloadSas:', parseError);
        return { success: false, error: 'Invalid JSON response' };
      }
    } catch (error) {
      console.error('[BlobAPI] getDownloadSas error:', error);
      return {
        success: false,
        error: (error as Error).message || "Network error",
      };
    }
  }

  /**
   * Upload audio blob to Azure Blob Storage
   */
  async uploadAudio(
    audioBlob: Blob,
    fileName: string,
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse<{ blobUrl: string }>> {
    try {
      // Get SAS token
      const sasResponse = await this.getUploadSas(fileName);
      if (!sasResponse.success || !sasResponse.data) {
        return {
          success: false,
          error: sasResponse.error || "Failed to get upload URL",
        };
      }

      const { fullUrl, blobUrl } = sasResponse.data;

      // Upload using PUT with SAS token
      const response = await fetch(fullUrl, {
        method: "PUT",
        headers: {
          "x-ms-blob-type": "BlockBlob",
          "Content-Type": audioBlob.type || "audio/webm",
        },
        body: audioBlob,
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Upload failed: ${response.status} ${response.statusText}`,
        };
      }

      onProgress?.(100);

      return {
        success: true,
        data: { blobUrl },
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message || "Upload error",
      };
    }
  }

  /**
   * Get playable URL for audio file
   */
  async getPlayableUrl(blobUrl: string): Promise<string | null> {
    const response = await this.getDownloadSas(blobUrl);
    if (response.success && response.data) {
      return response.data.fullUrl;
    }
    return null;
  }
}

export const blobApi = new BlobApiService();
