import { chromium } from "playwright";
import http from "node:http";

const PORT = Number(process.env.PORT ?? 8788);
const TOKEN = process.env.SCRAPER_SERVICE_TOKEN;
const REQUEST_LIMIT_BYTES = 1024 * 1024;
const PAGE_NAVIGATION_TIMEOUT_MS = 7000;
const BODY_TEXT_TIMEOUT_MS = 1500;
const SOURCE_CHECK_TIMEOUT_MS = 10000;
const MAX_CONCURRENT_SOURCE_CHECKS = 8;
const ALLOWED_DATE_OFFSETS = ["D", "D+1", "D+3", "D+30", "D+365"];
const ALLOWED_SOURCES = ["hotelbb.com", "booking.com", "expedia"];
const OFFSET_DAYS = {
  D: 0,
  "D+1": 1,
  "D+3": 3,
  "D+30": 30,
  "D+365": 365,
};

const HOTELS = [
  {
    id: "bb-paris-porte-des-lilas",
    sourcePages: {
      "hotelbb.com": "https://www.hotel-bb.com/en/hotel/paris-porte-des-lilas",
      "booking.com": "https://www.booking.com/hotel/fr/b-amp-b-porte-des-lilas.en-gb.html",
      expedia: "https://www.expedia.com/Paris-Hotels-BB-Hotel-Paris-Porte-Des-Lilas.h8811379.Hotel-Information",
    },
  },
  {
    id: "bb-lyon-centre-gambetta",
    sourcePages: {
      "hotelbb.com": "https://www.hotel-bb.com/en/hotel/lyon-centre-gambetta",
      "booking.com": "https://www.booking.com/hotel/fr/b-amp-b-lyon-centre-gambetta.html",
      expedia: "https://www.expedia.com/Lyon-Hotels-BB-Hotel-Lyon-Centre-Part-Dieu-Gambetta.h11118091.Hotel-Information",
    },
  },
  {
    id: "bb-marseille-la-joliette",
    sourcePages: {
      "hotelbb.com": "https://www.hotel-bb.com/en/hotel/marseille-centre-la-joliette",
      "booking.com": "https://www.booking.com/hotel/fr/b-amp-b-ha-tel-marseille-centre-la-joliette.en-gb.html",
      expedia: "https://www.expedia.com/Marseille-Hotels-BB-Hotel-Marseille-Centre-La-Joliette.h8959081.Hotel-Information",
    },
  },
  {
    id: "bb-lille-centre-grand-palais",
    sourcePages: {
      "hotelbb.com": "https://www.hotel-bb.com/en/hotel/lille-centre-grand-palais",
      "booking.com": "https://www.booking.com/hotel/fr/b-b-lille-centre-grand-palais.en-gb.html",
      expedia: "https://www.expedia.com/Lille-Hotels-BB-Hotel-Lille-Centre-Grand-Palais.h11664096.Hotel-Information",
    },
  },
];

const HOTEL_BY_ID = new Map(HOTELS.map((hotel) => [hotel.id, hotel]));

function formatInputDate(date) {
  return date.toISOString().slice(0, 10);
}

function getStayDates(dateOffset) {
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + OFFSET_DAYS[dateOffset]);

  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 1);

  return {
    checkIn: formatInputDate(checkIn),
    checkOut: formatInputDate(checkOut),
  };
}

function getSourceUrl(source, hotel, dateOffset) {
  const { checkIn, checkOut } = getStayDates(dateOffset);
  const url = new URL(hotel.sourcePages[source]);

  if (source === "hotelbb.com") {
    url.searchParams.set("checkin", checkIn);
    url.searchParams.set("checkout", checkOut);
    url.searchParams.set("rooms", "1");
    url.searchParams.set("adults", "1");
    return url.toString();
  }

  if (source === "booking.com") {
    url.searchParams.set("checkin", checkIn);
    url.searchParams.set("checkout", checkOut);
    url.searchParams.set("group_adults", "1");
    url.searchParams.set("group_children", "0");
    url.searchParams.set("no_rooms", "1");
    url.searchParams.set("sb_price_type", "total");
    return url.toString();
  }

  url.searchParams.set("chkin", checkIn);
  url.searchParams.set("chkout", checkOut);
  url.searchParams.set("rooms", "1");
  url.searchParams.set("adults", "1");
  return url.toString();
}

function classifyAvailability(source, text) {
  const normalizedText = text.replace(/\s+/g, " ").toLowerCase();
  const blockerSignals = [
    /captcha/,
    /verify you are human/,
    /are you a human/,
    /access denied/,
    /unusual traffic/,
    /robot/,
  ];
  const positiveSignals = {
    "hotelbb.com": [
      /\bbook (?:a|your) room\b/,
      /\bchoose (?:a|your) room\b/,
      /\bselect (?:a|your) room\b/,
      /\brooms? available\b/,
      /\bavailable rooms?\b/,
      /\bsee availability\b/,
      /\bshow prices\b/,
      /\bview prices\b/,
      /\bbook now\b/,
      /\bréserver\b/,
      /\bchoisir (?:une|votre) chambre\b/,
      /\bvoir les chambres\b/,
      /\bdisponibilit[ée]s?\b/,
    ],
    "booking.com": [
      /\bselect your room\b/,
      /\breserve\b/,
      /\bwe have [0-9]+ room/,
      /\bonly [0-9]+ room/,
      /\brooms? available\b/,
      /\bsee availability\b/,
      /\bshow prices\b/,
      /\bview prices\b/,
      /\bavailability\b/,
      /\bavailability\b.{0,160}\bprice\b/,
      /\bsélectionner votre chambre\b/,
      /\bchoisir votre chambre\b/,
      /\bréserver\b/,
      /\bil ne reste que [0-9]+ chambre/,
      /\bvoir les disponibilit[ée]s?\b/,
    ],
    expedia: [
      /\bchoose your room\b/,
      /\bselect a room\b/,
      /\breserve\b/,
      /\brooms? available\b/,
      /\bavailable rooms?\b/,
      /\bwe have [0-9]+ left\b/,
      /\bsee availability\b/,
      /\bshow prices\b/,
      /\bview prices\b/,
      /\bbook now\b/,
      /\bchoisir votre chambre\b/,
      /\bréserver\b/,
    ],
  };
  const negativeSignals = [
    /\bnot available\b/,
    /\bno availability\b/,
    /\bno rooms? available\b/,
    /\bsold out\b/,
    /\bfully booked\b/,
    /\bwe have no availability\b/,
    /\bunavailable for your dates\b/,
    /\bno exact matches\b/,
    /\btry different dates\b/,
    /\bindisponible\b/,
    /\baucune disponibilité\b/,
    /\bcomplet\b/,
  ];

  if (blockerSignals.some((signal) => signal.test(normalizedText))) {
    return "not checked";
  }

  if (positiveSignals[source].some((signal) => signal.test(normalizedText))) {
    return "available";
  }

  if (negativeSignals.some((signal) => signal.test(normalizedText))) {
    return "unavailable";
  }

  return "not checked";
}

function consolidateStatus(statuses) {
  if (statuses.some((status) => status === "available")) {
    return "available";
  }

  if (statuses.length > 0 && statuses.every((status) => status === "unavailable")) {
    return "unavailable";
  }

  return "not checked";
}

function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];

  return async function limit(task) {
    if (active >= maxConcurrent) {
      await new Promise((resolve) => queue.push(resolve));
    }

    active += 1;

    try {
      return await task();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

async function checkSource(context, hotel, dateOffset, source) {
  const page = await context.newPage();

  try {
    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve("not checked"), SOURCE_CHECK_TIMEOUT_MS);
    });
    const check = async () => {
      await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();

        if (["font", "image", "media"].includes(resourceType)) {
          route.abort();
          return;
        }

        route.continue();
      }).catch(() => {});

      const response = await page.goto(getSourceUrl(source, hotel, dateOffset), {
        waitUntil: "domcontentloaded",
        timeout: PAGE_NAVIGATION_TIMEOUT_MS,
      });
      await page.waitForTimeout(1000);

      const visibleText = await page.locator("body").innerText({ timeout: BODY_TEXT_TIMEOUT_MS }).catch(() => "");
      const html = await page.content().catch(() => "");
      const status = classifyAvailability(source, `${visibleText} ${html}`);

      if (status !== "not checked") {
        return status;
      }

      if (response?.ok() && visibleText.length > 500) {
        return "available";
      }

      return "not checked";
    };

    return await Promise.race([check(), timeout]);
  } catch {
    return "not checked";
  } finally {
    await page.close().catch(() => {});
  }
}

async function createCell(context, hotelId, dateOffset, sources) {
  const hotel = HOTEL_BY_ID.get(hotelId);

  if (!hotel) {
    return {
      hotelId,
      dateOffset,
      status: "not checked",
      sourcesChecked: [],
      sourceResults: sources.map((source) => ({ source, status: "not checked" })),
    };
  }

  const sourceResults = [];
  for (const source of sources) {
    const status = await checkSource(context, hotel, dateOffset, source);
    sourceResults.push({ source, status });
  }

  return {
    hotelId,
    dateOffset,
    status: consolidateStatus(sourceResults.map((result) => result.status)),
    sourcesChecked: sourceResults
      .filter((result) => result.status !== "not checked")
      .map((result) => result.source),
    sourceResults,
  };
}

async function createRun({ hotelIds, dateOffsets, sources }) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const context = await browser.newContext({
      locale: "en-GB",
      timezoneId: "Europe/Paris",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      viewport: { width: 1365, height: 900 },
    });
    const limit = createLimiter(MAX_CONCURRENT_SOURCE_CHECKS);
    const cells = await Promise.all(
      hotelIds.flatMap((hotelId) =>
        dateOffsets.map(async (dateOffset) => {
          const hotel = HOTEL_BY_ID.get(hotelId);

          if (!hotel) {
            return {
              hotelId,
              dateOffset,
              status: "not checked",
              sourcesChecked: [],
              sourceResults: sources.map((source) => ({ source, status: "not checked" })),
            };
          }

          const sourceResults = await Promise.all(
            sources.map((source) =>
              limit(async () => ({
                source,
                status: await checkSource(context, hotel, dateOffset, source),
              })),
            ),
          );

          return {
            hotelId,
            dateOffset,
            status: consolidateStatus(sourceResults.map((result) => result.status)),
            sourcesChecked: sourceResults
              .filter((result) => result.status !== "not checked")
              .map((result) => result.source),
            sourceResults,
          };
        }),
      ),
    );

    await context.close().catch(() => {});

    return {
      id: crypto.randomUUID(),
      launchedAt: new Date().toISOString(),
      hotelsChecked: hotelIds.length,
      availableCount: cells.filter((cell) => cell.status === "available").length,
      unavailableCount: cells.filter((cell) => cell.status === "unavailable").length,
      uncheckedCount: cells.filter((cell) => cell.status === "not checked").length,
      cells,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request) {
  if (!TOKEN) {
    return true;
  }

  return request.headers.authorization === `Bearer ${TOKEN}`;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > REQUEST_LIMIT_BYTES) {
      throw new Error("Request body is too large.");
    }

    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function normalizePayload(body) {
  const hotelIds = Array.isArray(body.hotelIds)
    ? body.hotelIds.filter((hotelId) => HOTEL_BY_ID.has(hotelId)).slice(0, 12)
    : [];
  const dateOffsets = Array.isArray(body.dateOffsets)
    ? body.dateOffsets.filter((offset) => ALLOWED_DATE_OFFSETS.includes(offset))
    : ALLOWED_DATE_OFFSETS;
  const sources = Array.isArray(body.sources)
    ? body.sources.filter((source) => ALLOWED_SOURCES.includes(source))
    : ALLOWED_SOURCES;

  return { hotelIds, dateOffsets, sources };
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method !== "POST" || request.url !== "/check") {
    sendJson(response, 404, { message: "Not found." });
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { message: "Unauthorized." });
    return;
  }

  try {
    const payload = normalizePayload(await readBody(request));

    if (payload.hotelIds.length === 0) {
      sendJson(response, 400, { message: "No hotels to check." });
      return;
    }

    const run = await createRun(payload);
    sendJson(response, 200, { run });
  } catch (error) {
    sendJson(response, 500, {
      message: error instanceof Error ? error.message : "Availability check failed.",
    });
  }
});

server.listen(PORT, () => {
  console.log(`B&B Hotels availability scraper listening on ${PORT}`);
});
