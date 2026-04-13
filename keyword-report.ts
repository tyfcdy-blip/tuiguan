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

const SITE_URL = "https://one.alimama.com/index.html#!/manage/search";
const BIZ_CODE = "onebpSearch";
const FIND_PAGE_PATH = "/campaign/horizontal/findPage.json";
const SUMMARY_PATH = "/report/query.json";

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

async function readRuntimeTokens(page: any): Promise<{ csrfId: string; loginPointId: string | null }> {
  return await page.evaluate(() => {
    const getValue = (key: string): string | null => {
      try {
        const fromStorage = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
        if (fromStorage) {
          return fromStorage;
        }
      } catch {
        return null;
      }

      const globalValue = (window as any)[key];
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
}

async function postJson<T>(
  page: any,
  path: string,
  query: Record<string, string>,
  body: Record<string, unknown>
): Promise<T> {
  return await page.evaluate(
    async ({ requestPath, requestQuery, requestBody }: PostJsonArgs) => {
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

      return await response.json();
    },
    { requestPath: path, requestQuery: query, requestBody: body }
  );
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
    { name: "status", type: "string", required: false, help: "Campaign status filter. Defaults to start." }
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
    const capturedAt = buildCapturedAt();

    await page.goto(
      `${SITE_URL}?offset=0&statusList=${encodeURIComponent(status)}&searchKey=itemId&searchValue=${encodeURIComponent(itemId)}&pageSize=${pageSize}`,
      { waitUntil: "domcontentloaded" }
    );

    const tokens = await readRuntimeTokens(page);
    if (!tokens.csrfId) {
      throw new Error("Failed to read csrfId from the Wanxiangtai page. Ensure Chrome is logged in and the page is fully loaded.");
    }

    const findPageBody = {
      itemId: Number(itemId),
      offset: 0,
      pageSize,
      statusList: [status],
      searchDetentTypeList: ["first_place"],
      queryRuleAuto: "1",
      rptQuery: {
        fields: "charge,roi,adPv,click,ctr,ecpc,cartInshopNum,cartRate,cartCost,alipayInshopAmt,cvr,alipayDirAmt,cartDirNum,alipayInshopNum,alipayDirNum,alipayIndirAmt,alipayIndirNum,cartIndirNum",
        conditionList: [
          {
            sourceList: ["scene", "campaign_list"],
            startTime: date,
            endTime: date,
            isRt: true
          }
        ]
      }
    };

    const findPage = await postJson<FindPageResponse>(
      page,
      FIND_PAGE_PATH,
      { csrfId: tokens.csrfId, bizCode: BIZ_CODE },
      findPageBody
    );

    if (findPage.info?.ok === false) {
      throw new Error(findPage.info.message || "findPage.json returned a failed status.");
    }

    const campaignRows = findPage.data?.list ?? [];
    const campaignIds = collectCampaignIds(campaignRows);
    const adzonePkgIds = collectAdzonePkgIds(campaignRows);

    let summaryMetric: ReportMetric | undefined;
    if (campaignIds.length > 0 && adzonePkgIds.length > 0) {
      const summaryBody: Record<string, unknown> = {
        bizCode: BIZ_CODE,
        byPage: false,
        fromRealTime: true,
        startTime: date,
        endTime: date,
        splitType: "sum",
        computeType: "sum",
        sourceList: ["scene", "campaign_list"],
        queryDomains: [],
        queryFieldIn: [
          "charge",
          "roi",
          "adPv",
          "click",
          "ctr",
          "ecpc",
          "cartInshopNum",
          "cartRate",
          "cartCost",
          "alipayInshopAmt",
          "cvr",
          "alipayDirAmt",
          "cartDirNum",
          "alipayInshopNum",
          "alipayDirNum",
          "alipayIndirAmt",
          "alipayIndirNum",
          "cartIndirNum"
        ],
        adzonePkgIdIn: adzonePkgIds,
        strategyCampaignIdIn: campaignIds,
        csrfId: tokens.csrfId
      };

      if (tokens.loginPointId) {
        summaryBody.loginPointId = tokens.loginPointId;
      }

      const summary = await postJson<SummaryResponse>(
        page,
        SUMMARY_PATH,
        { csrfId: tokens.csrfId, bizCode: BIZ_CODE },
        summaryBody
      );

      if (summary.info?.ok === false) {
        throw new Error(summary.info.message || "report/query.json returned a failed status.");
      }

      summaryMetric = summary.data?.list?.[0];
    }

    const rows = campaignRows.map((row) => toOutputRow(itemId, capturedAt, date, row));
    if (summaryMetric) {
      rows.push(toSummaryRow(itemId, capturedAt, date, summaryMetric));
    }

    return rows;
  }
});
