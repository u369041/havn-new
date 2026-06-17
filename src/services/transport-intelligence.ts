import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";

const TFI_GTFS_URL = process.env.TFI_GTFS_URL || "";

const IRISH_RAIL_GTFS_URL =
  process.env.IRISH_RAIL_GTFS_URL ||
  "https://www.transportforireland.ie/transitData/Data/GTFS_Irish_Rail.zip";

type GtfsStop = {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
};

type GtfsRoute = {
  route_id: string;
  agency_id?: string;
  route_short_name?: string;
  route_long_name?: string;
  route_type?: string;
};

type GtfsTrip = {
  route_id: string;
  service_id?: string;
  trip_id: string;
  trip_headsign?: string;
  direction_id?: string;
};

type GtfsStopTime = {
  trip_id: string;
  stop_id: string;
  stop_sequence?: string;
};

type GtfsAgency = {
  agency_id?: string;
  agency_name?: string;
};

export type TransportIntelRow = {
  type: string;
  distanceKm: number | null;
  stop: string;
  route: string;
  destination: string;
  provider: string;
  source: string;
};

type GtfsBundle = {
  loadedAt: number;
  source: string;
  agencies: Map<string, GtfsAgency>;
  routes: Map<string, GtfsRoute>;
  tripsById: Map<string, GtfsTrip>;
  stopTimesByStopId: Map<string, GtfsStopTime[]>;
  stops: GtfsStop[];
};

let tfiCache: GtfsBundle | null = null;
let railCache: GtfsBundle | null = null;

const CACHE_MS = 24 * 60 * 60 * 1000;

function safeText(v: any): string {
  return v === null || v === undefined ? "" : String(v);
}

function toNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function readCsvFromZip<T = any>(zip: AdmZip, filename: string): T[] {
  const entry = zip.getEntry(filename);
  if (!entry) return [];

  const raw = entry.getData().toString("utf8");

  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  }) as T[];
}

async function downloadGtfs(url: string, source: string): Promise<GtfsBundle> {
  if (!url) {
    throw new Error(`${source} GTFS URL not configured`);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${source} GTFS: ${response.status}`);
  }

  const arr = await response.arrayBuffer();
  const zip = new AdmZip(Buffer.from(arr));

  const agenciesRows = readCsvFromZip<GtfsAgency>(zip, "agency.txt");
  const routesRows = readCsvFromZip<GtfsRoute>(zip, "routes.txt");
  const tripsRows = readCsvFromZip<GtfsTrip>(zip, "trips.txt");
  const stopsRows = readCsvFromZip<GtfsStop>(zip, "stops.txt");
  const stopTimesRows = readCsvFromZip<GtfsStopTime>(zip, "stop_times.txt");

  const agencies = new Map<string, GtfsAgency>();
  agenciesRows.forEach((a) => {
    const id = safeText(a.agency_id || a.agency_name).trim();
    if (id) agencies.set(id, a);
  });

  const routes = new Map<string, GtfsRoute>();
  routesRows.forEach((r) => {
    const id = safeText(r.route_id).trim();
    if (id) routes.set(id, r);
  });

  const tripsById = new Map<string, GtfsTrip>();
  tripsRows.forEach((t) => {
    const id = safeText(t.trip_id).trim();
    if (id) tripsById.set(id, t);
  });

  const stopTimesByStopId = new Map<string, GtfsStopTime[]>();
  stopTimesRows.forEach((st) => {
    const stopId = safeText(st.stop_id).trim();
    if (!stopId) return;

    const list = stopTimesByStopId.get(stopId) || [];
    if (list.length < 120) list.push(st);
    stopTimesByStopId.set(stopId, list);
  });

  return {
    loadedAt: Date.now(),
    source,
    agencies,
    routes,
    tripsById,
    stopTimesByStopId,
    stops: stopsRows,
  };
}

async function getTfiBundle(): Promise<GtfsBundle> {
  if (!TFI_GTFS_URL) {
    throw new Error("TFI_GTFS_URL not configured");
  }

  if (tfiCache && Date.now() - tfiCache.loadedAt < CACHE_MS) return tfiCache;
  tfiCache = await downloadGtfs(TFI_GTFS_URL, "TFI");
  return tfiCache;
}

async function getRailBundle(): Promise<GtfsBundle> {
  if (railCache && Date.now() - railCache.loadedAt < CACHE_MS) return railCache;
  railCache = await downloadGtfs(IRISH_RAIL_GTFS_URL, "Irish Rail");
  return railCache;
}

function routeTypeLabel(routeType: any, source: string): string {
  const t = safeText(routeType).trim();

  if (source === "Irish Rail") return "Rail";
  if (t === "2") return "Rail";
  if (t === "3") return "Bus";
  if (t === "0") return "Tram";
  if (t === "4") return "Ferry";

  return source === "Irish Rail" ? "Rail" : "Bus";
}

function routeLabel(route: GtfsRoute | undefined): string {
  if (!route) return "—";

  return (
    safeText(route.route_short_name).trim() ||
    safeText(route.route_long_name).trim() ||
    safeText(route.route_id).trim() ||
    "—"
  );
}

function providerLabel(route: GtfsRoute | undefined, bundle: GtfsBundle): string {
  if (!route) return bundle.source;

  const agencyId = safeText(route.agency_id).trim();
  const agency = agencyId ? bundle.agencies.get(agencyId) : null;

  return (
    safeText(agency?.agency_name).trim() ||
    safeText(route.agency_id).trim() ||
    bundle.source
  );
}

function cleanDestination(raw: any): string {
  const s = safeText(raw).trim();
  if (!s) return "—";
  return s.replace(/\s+/g, " ");
}

function rowsForNearbyStops(
  bundle: GtfsBundle,
  lat: number,
  lng: number,
  radiusKm: number
): TransportIntelRow[] {
  const nearbyStops = bundle.stops
    .map((stop) => {
      const stopLat = toNumber(stop.stop_lat);
      const stopLng = toNumber(stop.stop_lon);

      if (stopLat === null || stopLng === null) return null;

      const dist = distanceKm(lat, lng, stopLat, stopLng);

      return {
        stop,
        distanceKm: Number(dist.toFixed(2)),
      };
    })
    .filter((x): x is { stop: GtfsStop; distanceKm: number } => !!x && x.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 18);

  const rows: TransportIntelRow[] = [];

  for (const nearby of nearbyStops) {
    const stopId = safeText(nearby.stop.stop_id).trim();
    const stopTimes = (bundle.stopTimesByStopId.get(stopId) || []).slice(0, 80);

    const seenRoutesForStop = new Set<string>();

    for (const stopTime of stopTimes) {
      const trip = bundle.tripsById.get(safeText(stopTime.trip_id).trim());
      if (!trip) continue;

      const route = bundle.routes.get(safeText(trip.route_id).trim());
      const routeKey = `${stopId}|${trip.route_id}|${trip.trip_headsign || ""}`;

      if (seenRoutesForStop.has(routeKey)) continue;
      seenRoutesForStop.add(routeKey);

      rows.push({
        type: routeTypeLabel(route?.route_type, bundle.source),
        distanceKm: nearby.distanceKm,
        stop: safeText(nearby.stop.stop_name).trim() || "Nearby stop",
        route: routeLabel(route),
        destination: cleanDestination(trip.trip_headsign || route?.route_long_name),
        provider: providerLabel(route, bundle),
        source: bundle.source,
      });

      if (rows.length >= 80) break;
    }

    if (rows.length >= 80) break;
  }

  return rows;
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

export async function getTransportIntelligence(
  lat: number,
  lng: number,
  limit = 30
): Promise<TransportIntelRow[]> {
  try {
    const [tfi, rail] = await Promise.allSettled([
      getTfiBundle(),
      getRailBundle(),
    ]);

    const rows: TransportIntelRow[] = [];

    if (tfi.status === "fulfilled") {
      rows.push(...rowsForNearbyStops(tfi.value, lat, lng, 6));
    }

    if (rail.status === "fulfilled") {
      rows.push(...rowsForNearbyStops(rail.value, lat, lng, 12));
    }

    return dedupeTransportRows(rows)
      .sort((a, b) => {
        const ad = Number.isFinite(Number(a.distanceKm)) ? Number(a.distanceKm) : 9999;
        const bd = Number.isFinite(Number(b.distanceKm)) ? Number(b.distanceKm) : 9999;
        return ad - bd;
      })
      .slice(0, limit);
  } catch (err: any) {
    console.warn("Transport intelligence failed:", err?.message || err);
    return [];
  }
}