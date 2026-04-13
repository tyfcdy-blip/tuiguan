import { cli } from "@jackwener/opencli/registry";

type CommandArgs = Record<string, unknown>;

type PostJsonArgs = {
  requestBody: Record<string, unknown>;
  requestPath: string;
  requestQuery: Record<string, string>;
};

type ReportMetric = {
  adPv?: number;
  alipayDirAmt?: number;
  alipayDirNum?: number;
  alipayIndirAmt?: number;
  alipayIndirNum?: number;
  alipayInshopAmt?: number;
  alipayInshopNum?: number;
  cartDirNum?: number;
  cartIndirNum?: number;
  cartInshopNum?: number;
  cartRate?: number;
  charge?: number;
  click?: number;
  ctr?: number;
  cvr?: number;
  ecpc?: number;
  roi?: number;
};

type CampaignMetric = ReportMetric & {
  campaignId?: number | string;
  condition?: {
    adzonePkgIdList?: string[];
    endTime?: string;
    isRt?: boolean;
    startTime?: string;
  };
};

type CampaignRow = {
  campaignId: number | string;
  campaignName: string;
  dayBudget: number | null;
  reportInfoList?: CampaignMetric[];
};

type FindPageResponse = {
  data?: {
    count?: number;
    list?: CampaignRow[];
  };
  info?: {
    message?: string | null;
    ok?: boolean;
  };
};

type SummaryResponse = {
  data?: {
    list?: ReportMetric[];
  };
  info?: {
    message?: string | null;
    ok?: boolean;
  };
};

type JsonEnvelope<T> = {
  ok: boolean;
  status: number;
  statusText: string;
  data?: T;
  text?: string;
};

type OutputRow = {
  rowType: "campaign" | "summary";
  itemId: string;
  capturedAt: string;
  date: string;
  campaignId: string;
  campaignName: string;
  budget: number | null;
  charge: number | null;
  roi: number | null;
  ecpc: number | null;
  ctr: number | null;
  cvr: number | null;
  cartRate: number | null;
  cartCost: number | null;
  totalDealCost: number | null;
  adPv: number | null;
  click: number | null;
  adzonePkgIdList: string;
};

type ScrapedTable = {
  headers: string[];
  rows: string[][];
};

const SITE_URL = "https://one.alimama.com/index.html#!/manage/search";
const BIZ_CODE = "onebpSearch";
const FIND_PAGE_PATH = "/campaign/horizontal/findPage.json";
const SUMMARY_PATH = "/report/query.json";

function extractTokensFromUrl(rawUrl: string): { csrfId: string; loginPointId: string | null } | null {
  try {
    const url = new URL(rawUrl);
    const csrfId = url.searchParams.get("csrfId");
    const loginPointId = url.searchParams.get("loginPointId");
    if (!csrfId) {
      return null;
    }
    return { csrfId, loginPointId };
  } catch {
    return null;
  }
}

async function waitForSettledPage(page: any, milliseconds: number): Promise<void> {
  if (typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(milliseconds);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseNumberFromText(value: string): number | null {
  const cleaned = value.replace(/,/g, "");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function pickValue(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    if (row[key]) {
      return row[key];
    }
  }
  return "";
}

function mapScrapedRow(
  itemId: string,
  capturedAt: string,
  date: string,
  row: Record<string, string>
): OutputRow | null {
  const planCell = pickValue(row, ["计划", "计划 "]);
  const campaignName = normalizeText(planCell.split("计划组：")[0] || planCell);
  const campaignIdText = pickValue(row, ["计划ID"]);
  const isSummary = campaignName.includes("合计") || campaignIdText === "-" || campaignIdText === "";

  if (!isSummary && !campaignIdText) {
    return null;
  }

  return {
    rowType: isSummary ? "summary" : "campaign",
    itemId,
    capturedAt,
    date,
    campaignId: isSummary ? "SUMMARY" : normalizeText(campaignIdText),
    campaignName: isSummary ? "summary" : campaignName,
    budget: parseNumberFromText(pickValue(row, ["预算"])),
    charge: parseNumberFromText(pickValue(row, ["花费"])),
    roi: parseNumberFromText(pickValue(row, ["投入产出比"])),
    ecpc: parseNumberFromText(pickValue(row, ["平均点击花费", "平均点击花费(元)"])),
    ctr: parseNumberFromText(pickValue(row, ["点击率"])),
    cvr: parseNumberFromText(pickValue(row, ["点击转化率"])),
    cartRate: parseNumberFromText(pickValue(row, ["加购率"])),
    cartCost: parseNumberFromText(pickValue(row, ["加购成本", "加购成本(元)"])),
    totalDealCost: parseNumberFromText(pickValue(row, ["总成交成本", "总成交成本(元)"])),
    adPv: parseNumberFromText(pickValue(row, ["展现量"])),
    click: parseNumberFromText(pickValue(row, ["点击量"])),
    adzonePkgIdList: ""
  };
}

async function scrapeCampaignTable(page: any): Promise<ScrapedTable | null> {
  return await page.evaluate(() => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    const tables = Array.from(document.querySelectorAll("table"));

    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll("thead th"))
        .map((node) => normalize((node as HTMLElement).innerText || ""))
        .filter(Boolean);

      if (!headers.length) {
        continue;
      }

      const joined = headers.join("|");
      const looksLikeCampaignTable =
        joined.includes("计划ID") &&
        joined.includes("预算") &&
        joined.includes("花费") &&
        joined.includes("投入产出比");

      if (!looksLikeCampaignTable) {
        continue;
      }

      const rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => normalize((td as HTMLElement).innerText || ""))
      );

      return { headers, rows };
    }

    return null;
  });
}

function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function todayInChina(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function buildCapturedAt(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date()).replace(" ", "T");
}

function getMetric(row?: ReportMetric): Required<ReportMetric> {
  return {
    adPv: asNumber(row?.adPv) ?? 0,
    alipayDirAmt: asNumber(row?.alipayDirAmt) ?? 0,
    alipayDirNum: asNumber(row?.alipayDirNum) ?? 0,
    alipayIndirAmt: asNumber(row?.alipayIndirAmt) ?? 0,
    alipayIndirNum: asNumber(row?.alipayIndirNum) ?? 0,
    alipayInshopAmt: asNumber(row?.alipayInshopAmt) ?? 0,
    alipayInshopNum: asNumber(row?.alipayInshopNum) ?? 0,
    cartDirNum: asNumber(row?.cartDirNum) ?? 0,
    cartIndirNum: asNumber(row?.cartIndirNum) ?? 0,
    cartInshopNum: asNumber(row?.cartInshopNum) ?? 0,
    cartRate: asNumber(row?.cartRate) ?? 0,
    charge: asNumber(row?.charge) ?? 0,
    click: asNumber(row?.click) ?? 0,
    ctr: asNumber(row?.ctr) ?? 0,
    cvr: asNumber(row?.cvr) ?? 0,
    ecpc: asNumber(row?.ecpc) ?? 0,
    roi: asNumber(row?.roi) ?? 0
  };
}

function computeCartCost(metric: ReportMetric): number | null {
  const m = getMetric(metric);
  return safeDivide(m.charge, m.cartInshopNum + m.cartDirNum + m.cartIndirNum);
}

function computeTotalDealCost(metric: ReportMetric): number | null {
  const m = getMetric(metric);
  return safeDivide(m.charge, m.alipayInshopNum + m.alipayDirNum + m.alipayIndirNum);
}

async function readRuntimeTokens(
  page: any,
  observedUrls: string[] = []
): Promise<{ csrfId: string; loginPointId: string | null }> {
  for (const observedUrl of observedUrls) {
    const token = extractTokensFromUrl(observedUrl);
    if (token?.csrfId) {
      return token;
    }
  }

  const direct = await page.evaluate(() => {
    const getValue = (key: string): string | null => {
      try {
        const fromStorage = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
        if (fromStorage) {
          return fromStorage;
        }
      } catch {
        // Ignore storage access errors and keep checking fallbacks.
      }

      const win = window as any;
      const globalValue = win[key];
      if (typeof globalValue === "string" && globalValue) {
        return globalValue;
      }

      const cookieMatch = document.cookie.match(new RegExp(`${key}=([^;]+)`));
      return cookieMatch?.[1] ?? null;
    };

    const win = window as any;
    const state = win.__INITIAL_STATE__ || {};
    const globalState = state.global || {};

    const csrfId =
      getValue("csrfId") ||
      globalState.csrfId ||
      state.csrfId ||
      win.csrfId ||
      "";

    const loginPointId =
      getValue("loginPointId") ||
      globalState.loginPointId ||
      state.loginPointId ||
      win.loginPointId ||
      null;

    return { csrfId, loginPointId };
  });

  if (direct?.csrfId) {
    return direct;
  }

  const fromPerformance = await page.evaluate(() => {
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];

    for (const entry of entries) {
      try {
        const url = new URL(entry.name);
        const csrfId = url.searchParams.get("csrfId");
        const loginPointId = url.searchParams.get("loginPointId");

        if (csrfId) {
          return { csrfId, loginPointId };
        }
      } catch {
        // Ignore malformed resource URLs.
      }
    }

    return { csrfId: "", loginPointId: null };
  });

  if (fromPerformance?.csrfId) {
    return fromPerformance;
  }

  return { csrfId: "", loginPointId: null };
}

async function postJson<T>(
  page: any,
  path: string,
  query: Record<string, string>,
  body: Record<string, unknown>
): Promise<JsonEnvelope<T>> {
  const result = await page.evaluate(
    async ({ requestPath, requestQuery, requestBody }: PostJsonArgs) => {
      try {
        const url = new URL(requestPath, "https://one.alimama.com");
        Object.entries(requestQuery).forEach(([key, value]) => url.searchParams.set(key, value));

        const response = await fetch(url.toString(), {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-requested-with": "XMLHttpRequest"
          },
          body: JSON.stringify(requestBody)
        });

        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = undefined;
        }

        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          data,
          text
        };
      } catch {
        return {
          ok: false,
          status: 0,
          statusText: "FETCH_ERROR",
          data: undefined,
          text: "fetch failed inside page.evaluate"
        };
      }
    },
    { requestPath: path, requestQuery: query, requestBody: body }
  );

  return result || {
    ok: false,
    status: 0,
    statusText: "EMPTY_RESULT",
    data: undefined,
    text: "page.evaluate returned undefined"
  };
}

function collectCampaignIds(rows: CampaignRow[]): Array<number | string> {
  return rows
    .map((row) => row.campaignId)
    .filter((value): value is number | string => value !== null && value !== undefined);
}

function collectAdzonePkgIds(rows: CampaignRow[]): string[] {
  const pkgIds = new Set<string>();
  for (const row of rows) {
    for (const info of row.reportInfoList ?? []) {
      for (const pkgId of info.condition?.adzonePkgIdList ?? []) {
        pkgIds.add(pkgId);
      }
    }
  }
  return [...pkgIds];
}

function toOutputRow(itemId: string, capturedAt: string, date: string, row: CampaignRow): OutputRow {
  const metric = row.reportInfoList?.[0];
  return {
    rowType: "campaign",
    itemId,
    capturedAt,
    date,
    campaignId: String(row.campaignId ?? ""),
    campaignName: row.campaignName ?? "",
    budget: asNumber(row.dayBudget),
    charge: asNumber(metric?.charge),
    roi: asNumber(metric?.roi),
    ecpc: asNumber(metric?.ecpc),
    ctr: asNumber(metric?.ctr),
    cvr: asNumber(metric?.cvr),
    cartRate: asNumber(metric?.cartRate),
    cartCost: computeCartCost(metric ?? {}),
    totalDealCost: computeTotalDealCost(metric ?? {}),
    adPv: asNumber(metric?.adPv),
    click: asNumber(metric?.click),
    adzonePkgIdList: (metric?.condition?.adzonePkgIdList ?? []).join(",")
  };
}

function toSummaryRow(itemId: string, capturedAt: string, date: string, metric?: ReportMetric): OutputRow {
  return {
    rowType: "summary",
    itemId,
    capturedAt,
    date,
    campaignId: "SUMMARY",
    campaignName: "summary",
    budget: null,
    charge: asNumber(metric?.charge),
    roi: asNumber(metric?.roi),
    ecpc: asNumber(metric?.ecpc),
    ctr: asNumber(metric?.ctr),
    cvr: asNumber(metric?.cvr),
    cartRate: asNumber(metric?.cartRate),
    cartCost: computeCartCost(metric ?? {}),
    totalDealCost: computeTotalDealCost(metric ?? {}),
    adPv: asNumber(metric?.adPv),
    click: asNumber(metric?.click),
    adzonePkgIdList: ""
  };
}

cli({
  site: "wanxiangtai",
  name: "keyword-report",
  description: "Fetch Wanxiangtai keyword promotion campaign rows and a summary row by item ID.",
  browser: true,
  args: [
    { name: "itemId", type: "string", required: true, help: "Target item ID." },
    { name: "date", type: "string", required: false, help: "Report date in YYYY-MM-DD. Defaults to today in Asia/Shanghai." },
    { name: "pageSize", type: "int", required: false, help: "Campaign page size. Defaults to 100." },
    { name: "status", type: "string", required: false, help: "Campaign status filter. Defaults to start." },
    { name: "csrfId", type: "string", required: false, help: "Optional manual csrfId override." },
    { name: "loginPointId", type: "string", required: false, help: "Optional manual loginPointId override." }
  ],
  columns: [
    "rowType",
    "itemId",
    "capturedAt",
    "date",
    "campaignId",
    "campaignName",
    "budget",
    "charge",
    "roi",
    "ecpc",
    "ctr",
    "cvr",
    "cartRate",
    "cartCost",
    "totalDealCost",
    "adPv",
    "click",
    "adzonePkgIdList"
  ],
  func: async (page: any, kwargs: CommandArgs) => {
    const itemId = String(kwargs.itemId ?? "");
    if (!itemId) {
      throw new Error("itemId is required.");
    }

    const date = typeof kwargs.date === "string" && kwargs.date ? kwargs.date : todayInChina();
    const pageSize = typeof kwargs.pageSize === "number" ? kwargs.pageSize : Number(kwargs.pageSize ?? 100);
    const status = typeof kwargs.status === "string" && kwargs.status ? kwargs.status : "start";
    const manualCsrfId = typeof kwargs.csrfId === "string" ? kwargs.csrfId : "";
    const manualLoginPointId = typeof kwargs.loginPointId === "string" ? kwargs.loginPointId : null;
    const capturedAt = buildCapturedAt();
    const observedUrls: string[] = [];

    if (typeof page.on === "function") {
      page.on("response", (response: any) => {
        try {
          const url = typeof response?.url === "function" ? response.url() : response?.url;
          if (typeof url === "string") {
            observedUrls.push(url);
          }
        } catch {
          // Ignore network listener errors.
        }
      });
    }

    await page.goto(
      `${SITE_URL}?offset=0&statusList=${encodeURIComponent(status)}&searchKey=itemId&searchValue=${encodeURIComponent(itemId)}&pageSize=${pageSize}`,
      { waitUntil: "domcontentloaded" }
    );

    let tokens = { csrfId: manualCsrfId, loginPointId: manualLoginPointId };
    if (!tokens.csrfId) {
      for (const delay of [1500, 2500, 4000]) {
        await waitForSettledPage(page, delay);
        tokens = (await readRuntimeTokens(page, observedUrls)) || { csrfId: "", loginPointId: null };
        if (tokens.csrfId) {
          break;
        }
      }
    }

    if (!tokens.csrfId) {
      throw new Error("Failed to read csrfId from the Wanxiangtai page. Ensure Chrome is logged in and the page is fully loaded.");
    }

    await waitForSettledPage(page, 3000);
    const scraped = await scrapeCampaignTable(page);
    if (!scraped) {
      throw new Error("Failed to locate the campaign table in the rendered page.");
    }

    const rows: OutputRow[] = [];
    for (const cells of scraped.rows) {
      if (cells.length < scraped.headers.length || cells.every((cell) => !cell)) {
        continue;
      }

      const row = Object.fromEntries(scraped.headers.map((header, index) => [header, cells[index] || ""]));
      const mapped = mapScrapedRow(itemId, capturedAt, date, row);
      if (mapped) {
        rows.push(mapped);
      }
    }

    if (!rows.length) {
      throw new Error("Campaign table was found, but no usable rows were parsed.");
    }

    return rows;
  }
});
