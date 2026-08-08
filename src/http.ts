import { REQUEST_DELAY_MS, USER_AGENT } from "./config";

type FetchOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  retries?: number;
  validateUrl?: (url: string) => Promise<void> | void;
};

const lastRequestByHost = new Map<string, number>();

export class SourceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
  }
}

export const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function throttle(url: string) {
  const host = new URL(url).host;
  const lastRequest = lastRequestByHost.get(host) ?? 0;
  const waitFor = REQUEST_DELAY_MS - (Date.now() - lastRequest);
  if (waitFor > 0) await sleep(waitFor);
  lastRequestByHost.set(host, Date.now());
}

async function requestWithSafeRedirects(url: string, options: FetchOptions): Promise<Response> {
  let currentUrl = url;
  let method = options.method ?? "GET";
  let body = options.body;

  for (let redirect = 0; redirect <= 5; redirect += 1) {
    await options.validateUrl?.(currentUrl);
    await throttle(currentUrl);
    const response = await fetch(currentUrl, {
      method,
      headers: {
        accept: "text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "cs-CZ,cs;q=0.9,en;q=0.7",
        "user-agent": USER_AGENT,
        ...options.headers,
      },
      body,
      redirect: "manual",
      signal: options.signal ?? AbortSignal.timeout(25_000),
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error(`Redirect from ${currentUrl} did not include a location`);
    if (redirect === 5) throw new Error(`Too many redirects while fetching ${url}`);
    currentUrl = new URL(location, currentUrl).toString();
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && method === "POST")
    ) {
      method = "GET";
      body = undefined;
    }
  }

  throw new Error(`Unable to fetch ${url}`);
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const retries = options.retries ?? 2;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await requestWithSafeRedirects(url, options);

      if (response.ok) return response.text();

      if (response.status === 403 || response.status === 429) {
        throw new SourceHttpError(`Source returned HTTP ${response.status}`, response.status, url);
      }

      if (response.status < 500 || attempt === retries) {
        throw new SourceHttpError(`Source returned HTTP ${response.status}`, response.status, url);
      }
    } catch (error) {
      if (error instanceof SourceHttpError && (error.status === 403 || error.status === 429)) {
        throw error;
      }
      if (attempt === retries) throw error;
    }

    await sleep(500 * 2 ** attempt);
  }

  throw new Error(`Unable to fetch ${url}`);
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const payload = await fetchText(url, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...options.headers,
    },
  });
  return JSON.parse(payload) as T;
}
