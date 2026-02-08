import { app, HttpRequest, HttpResponseInit } from "@azure/functions";

// Health check endpoint
app.http("healthCheck", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: async (): Promise<HttpResponseInit> => {
    return {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: "1.1.0",
      }),
    };
  },
});
