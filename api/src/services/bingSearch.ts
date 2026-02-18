interface BingWebPage {
  name: string;
  url: string;
  snippet: string;
  dateLastCrawled?: string;
}

interface BingSearchResult {
  webPages?: {
    value: BingWebPage[];
    totalEstimatedMatches: number;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function searchBing(
  query: string,
  options: {
    count?: number;
    market?: string;
    freshness?: string;
  } = {}
): Promise<SearchResult[]> {
  const apiKey = process.env.BING_SEARCH_API_KEY;
  const endpoint =
    process.env.BING_SEARCH_ENDPOINT || "https://api.bing.microsoft.com";

  if (!apiKey) {
    throw new Error("BING_SEARCH_API_KEY is not configured");
  }

  const { count = 5, market = "ja-JP" } = options;

  const url = new URL(`${endpoint}/v7.0/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("mkt", market);
  url.searchParams.set("responseFilter", "Webpages");
  url.searchParams.set("safeSearch", "Moderate");

  if (options.freshness) {
    url.searchParams.set("freshness", options.freshness);
  }

  const response = await fetch(url.toString(), {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bing Search API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as BingSearchResult;

  return (data.webPages?.value || []).map((page) => ({
    title: page.name,
    url: page.url,
    snippet: page.snippet,
  }));
}
