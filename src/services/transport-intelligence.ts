import fs from "fs";
import path from "path";

export type TransportIntelRow = {
  type: string;
  distanceKm: number | null;
  stop: string;
  route: string;
  destination: string;
  provider: string;
  source: string;
};

type CachedTransportItem = {
  type: string;
  stop: string;
  route: string;
  destination: string;
  provider: string;
  lat: number;
  lng: number;
  source: string;
};

type TransportCacheFile = {
  generatedAt?: string;
  source?: string;
  count?: number;
  items?: CachedTransportItem[];
};

let cachedItems: CachedTransportItem[] | null = null;

function safeText(v: any): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) *
      Math.cos(toRad(bLat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function loadTransportCache(): CachedTransportItem[] {
  if (cachedItems) return cachedItems;

  const filePath = path.join(process.cwd(), "data", "transport-cache.json");

  if (!fs.existsSync(filePath)) {
    console.warn("TRANSPORT_CACHE_MISSING:", filePath);
    cachedItems = [];
    return cachedItems;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as TransportCacheFile;
    const items = Array.isArray(parsed.items) ? parsed.items : [];

    cachedItems = items
      .map((item) => ({
        type: safeText(item.type) || "Transport",
        stop: safeText(item.stop) || "Nearby stop",
        route: safeText(item.route) || "—",
        destination: safeText(item.destination) || "—",
        provider: safeText(item.provider) || "Transport operator",
        lat: Number(item.lat),
        lng: Number(item.lng),
        source: safeText(item.source) || "Transport cache",
      }))
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));

    console.log("TRANSPORT_CACHE_LOADED:", {
      filePath,
      items: cachedItems.length,
      generatedAt: parsed.generatedAt || null,
    });

    return cachedItems;
  } catch (err: any) {
    console.warn("TRANSPORT_CACHE_LOAD_FAILED:", err?.message || err);
    cachedItems = [];
    return cachedItems;
  }
}

function dedupeTransportRows(rows: TransportIntelRow[]): TransportIntelRow[] {
  const seen = new Set<string>();

  return rows.filter((row) => {
    const key = [
      row.type,
      row.stop,
      row.route,
      row.destination,
      row.provider,
    ]
      .join("|")
      .toLowerCase();

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classifyTransport(row: TransportIntelRow): string {
  const type = safeText(row.type).toLowerCase();
  const route = safeText(row.route).toLowerCase();
  const provider = safeText(row.provider).toLowerCase();

  if (type === "tram" && provider.includes("luas")) return "LUAS";
  if (type === "rail" && route === "dart") return "DART";
  if (type === "rail") return "RAIL";

  if (provider.includes("dublin bus") || provider.includes("bus átha cliath") || provider.includes("bus atha cliath")) {
    return "DUBLIN_BUS";
  }

  if (provider.includes("bus éireann") || provider.includes("bus eireann")) return "BUS_EIREANN";
  if (provider.includes("local link")) return "LOCAL_LINK";
  if (provider.includes("citylink")) return "CITYLINK";

  if (type === "bus") return "OTHER_BUS";
  if (type === "ferry") return "FERRY";

  return "OTHER";
}

function pickBalancedTransportRows(rows: TransportIntelRow[], limit: number): TransportIntelRow[] {
  const cleanLimit = Math.max(1, Math.min(80, Number(limit) || 30));
  const selected: TransportIntelRow[] = [];
  const seen = new Set<string>();

  function rowKey(row: TransportIntelRow): string {
    return [
      row.type,
      row.stop,
      row.route,
      row.destination,
      row.provider,
      row.distanceKm,
    ]
      .join("|")
      .toLowerCase();
  }

  function add(row: TransportIntelRow): void {
    if (selected.length >= cleanLimit) return;
    const key = rowKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(row);
  }

  function addBucket(kind: string, maxRows: number): void {
    rows
      .filter((row) => classifyTransport(row) === kind)
      .slice(0, maxRows)
      .forEach(add);
  }

  /*
    Important:
    Do not simply take the first 30 closest rows.
    In dense Dublin areas, Dublin Bus can fill all 30 slots and hide LUAS/DART.
    These buckets preserve first-class transport modes when they are actually nearby.
  */
  addBucket("LUAS", 8);
  addBucket("DART", 8);
  addBucket("RAIL", 6);
  addBucket("DUBLIN_BUS", 12);
  addBucket("BUS_EIREANN", 8);
  addBucket("LOCAL_LINK", 8);
  addBucket("CITYLINK", 4);
  addBucket("OTHER_BUS", 6);
  addBucket("FERRY", 3);
  addBucket("OTHER", 4);

  rows.forEach(add);

  return selected
    .slice(0, cleanLimit)
    .sort((a, b) => {
      const ad = Number.isFinite(Number(a.distanceKm)) ? Number(a.distanceKm) : 9999;
      const bd = Number.isFinite(Number(b.distanceKm)) ? Number(b.distanceKm) : 9999;
      return ad - bd;
    });
}

export async function getTransportIntelligence(
  lat: number,
  lng: number,
  limit = 30
): Promise<TransportIntelRow[]> {
  try {
    const items = loadTransportCache();

    const rows = items
      .map((item) => {
        const dist = distanceKm(lat, lng, item.lat, item.lng);

        return {
          type: item.type,
          stop: item.stop,
          route: item.route,
          destination: item.destination,
          provider: item.provider,
          source: item.source,
          distanceKm: Number(dist.toFixed(2)),
        };
      })
      .filter((item) => {
        if (!Number.isFinite(Number(item.distanceKm))) return false;

        if (item.type === "Rail") return Number(item.distanceKm) <= 12;
        if (item.type === "Bus") return Number(item.distanceKm) <= 6;
        if (item.type === "Tram") return Number(item.distanceKm) <= 6;
        if (item.type === "Ferry") return Number(item.distanceKm) <= 10;

        return Number(item.distanceKm) <= 6;
      })
      .sort((a, b) => {
        const ad = Number.isFinite(Number(a.distanceKm)) ? Number(a.distanceKm) : 9999;
        const bd = Number.isFinite(Number(b.distanceKm)) ? Number(b.distanceKm) : 9999;
        return ad - bd;
      });

    const deduped = dedupeTransportRows(rows);

    return pickBalancedTransportRows(deduped, limit);
  } catch (err: any) {
    console.warn("Transport intelligence failed:", err?.message || err);
    return [];
  }
}