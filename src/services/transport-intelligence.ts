import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";

const TFI_GTFS_URL =
  process.env.TFI_GTFS_URL ||
  "https://www.transportforireland.ie/transitData/Data/GTFS_All.zip";

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

  if (!entry) {
    console.warn("GTFS_FILE_MISSING:", filename);
    return [];
  }

  const raw = entry.getData().toString("utf8");

  try {
    return parse(raw, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
    }) as T[];
  } catch (err: any) {
    console.warn("GTFS_CSV_PARSE_FAILED:", {
      filename,
      message: err?.message || String(err),
    });
    return [];
  }
}

async function downloadGtfs(url: string, source: string): Promise<GtfsBundle> {
  const startedAt = Date.now();

  console.log("GTFS_DOWNLOAD_START:", {
    source,
    url,
  });

  const response = await fetch(url);

  console.log("GTFS_DOWNLOAD_RESPONSE:", {
    source,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type"),
    contentLength: response.headers.get("content-length"),
    elapsedMs: Date.now() - startedAt,
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${source} GTFS: ${response.status}`);
  }

  const arr = await response.arrayBuffer();

  console.log("GTFS_DOWNLOAD_BYTES:", {
    source,
    bytes: arr.byteLength,
    elapsedMs: Date.now() - startedAt,
  });

  const zip = new AdmZip(Buffer.from(arr));
  const entries = zip.getEntries().map((e) => e.entryName);

  console.log("GTFS_ZIP_ENTRIES:", {
    source,
    count: entries.length,
    first25: entries.slice(0, 25),
  });

  const agenciesRows = readCsvFromZip<GtfsAgency>(zip, "agency.txt");
  const routesRows = readCsvFromZip<GtfsRoute>(zip, "routes.txt");
  const tripsRows = readCsvFromZip<GtfsTrip>(zip, "trips.txt");
  const stopsRows = readCsvFromZip<GtfsStop>(zip, "stops.txt");
  const stopTimesRows = readCsvFromZip<GtfsStopTime>(zip, "stop_times.txt");

  console.log("GTFS_ROW_COUNTS:", {
    source,
    agencies: agenciesRows.length,
    routes: routesRows.length,
    trips: tripsRows.length,
    stops: stopsRows.length,
    stopTimes: stopTimesRows.length,
    elapsedMs: Date.now() - startedAt,
  });

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

  console.log("GTFS_BUNDLE_READY:", {
    source,
    agencies: agencies.size,
    routes: routes.size,
    trips: tripsById.size,
    stopTimeStops: stopTimesByStopId.size,
    stops: stopsRows.length,
    elapsedMs: Date.now() - startedAt,
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
  if (tfiCache && Date.now() - tfiCache.loadedAt < CACHE_MS) {
    console.log("GTFS_CACHE_HIT:", { source: "TFI" });
    return tfiCache;
  }

  console.log("GTFS_CACHE_MISS:", { source: "TFI" });
  tfiCache = await downloadGtfs(TFI_GTFS_URL, "TFI");
  return tfiCache;
}

async function getRailBundle(): Promise<GtfsBundle> {
  if (railCache && Date.now() - railCache.loadedAt < CACHE_MS) {
    console.log("GTFS_CACHE_HIT:", { source: "Irish Rail" });
    return railCache;
  }

  console.log("GTFS_CACHE_MISS:", { source: "Irish Rail" });
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
  console.log("GTFS_NEARBY_START:", {
    source: bundle.source,
    lat,
    lng,
    radiusKm,
    totalStops: bundle.stops.length,
  });

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

  console.log("GTFS_NEARBY_STOPS:", {
    source: bundle.source,
    count: nearbyStops.length,
    first10: nearbyStops.slice(0, 10).map((x) => ({
      stop_id: x.stop.stop_id,
      stop_name: x.stop.stop_name,
      distanceKm: x.distanceKm,
      hasStopTimes: (bundle.stopTimesByStopId.get(safeText(x.stop.stop_id).trim()) || []).length,
    })),
  });

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

  console.log("GTFS_NEARBY_ROWS:", {
    source: bundle.source,
    rows: rows.length,
    first10: rows.slice(0, 10),
  });

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
  const startedAt = Date.now();

  console.log("TRANSPORT_INTELLIGENCE_START:", {
    lat,
    lng,
    limit,
  });

  try {
    const [tfi, rail] = await Promise.allSettled([
      getTfiBundle(),
      getRailBundle(),
    ]);

    console.log("TRANSPORT_BUNDLE_RESULTS:", {
      tfiStatus: tfi.status,
      railStatus: rail.status,
      tfiError: tfi.status === "rejected" ? String(tfi.reason?.message || tfi.reason) : null,
      railError: rail.status === "rejected" ? String(rail.reason?.message || rail.reason) : null,
      elapsedMs: Date.now() - startedAt,
    });

    const rows: TransportIntelRow[] = [];

    if (tfi.status === "fulfilled") {
      rows.push(...rowsForNearbyStops(tfi.value, lat, lng, 6));
    }

    if (rail.status === "fulfilled") {
      rows.push(...rowsForNearbyStops(rail.value, lat, lng, 12));
    }

    const deduped = dedupeTransportRows(rows)
      .sort((a, b) => {
        const ad = Number.isFinite(Number(a.distanceKm)) ? Number(a.distanceKm) : 9999;
        const bd = Number.isFinite(Number(b.distanceKm)) ? Number(b.distanceKm) : 9999;
        return ad - bd;
      })
      .slice(0, limit);

    console.log("TRANSPORT_INTELLIGENCE_DONE:", {
      rawRows: rows.length,
      dedupedRows: deduped.length,
      elapsedMs: Date.now() - startedAt,
      first10: deduped.slice(0, 10),
    });

    return deduped;
  } catch (err: any) {
    console.warn("Transport intelligence failed:", err?.message || err);
    return [];
  }
}