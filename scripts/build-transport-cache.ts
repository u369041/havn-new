import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";

const GTFS_URL =
  process.env.TFI_GTFS_URL ||
  "https://www.transportforireland.ie/transitData/Data/GTFS_All.zip";

const OUT_DIR = path.join(process.cwd(), "data");
const OUT_FILE = path.join(OUT_DIR, "transport-cache.json");

type Stop = {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
};

type Route = {
  route_id: string;
  agency_id?: string;
  route_short_name?: string;
  route_long_name?: string;
  route_type?: string;
};

type Trip = {
  route_id: string;
  trip_id: string;
  trip_headsign?: string;
};

type StopTime = {
  trip_id: string;
  stop_id: string;
};

type Agency = {
  agency_id?: string;
  agency_name?: string;
};

function safe(v: any): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function readCsv<T>(zip: AdmZip, filename: string): T[] {
  const entry = zip.getEntry(filename);
  if (!entry) {
    console.warn(`Missing ${filename}`);
    return [];
  }

  return parse(entry.getData().toString("utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  }) as T[];
}

function routeTypeLabel(routeType: any): string {
  const t = safe(routeType);
  if (t === "2") return "Rail";
  if (t === "3") return "Bus";
  if (t === "0") return "Tram";
  if (t === "4") return "Ferry";
  return "Transport";
}

async function main() {
  console.log("Downloading GTFS:", GTFS_URL);

  const response = await fetch(GTFS_URL);

  if (!response.ok) {
    throw new Error(`GTFS download failed: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  console.log("Downloaded bytes:", buffer.byteLength);

  const zip = new AdmZip(buffer);

  const agencies = readCsv<Agency>(zip, "agency.txt");
  const routes = readCsv<Route>(zip, "routes.txt");
  const trips = readCsv<Trip>(zip, "trips.txt");
  const stops = readCsv<Stop>(zip, "stops.txt");
  const stopTimes = readCsv<StopTime>(zip, "stop_times.txt");

  console.log("Rows:", {
    agencies: agencies.length,
    routes: routes.length,
    trips: trips.length,
    stops: stops.length,
    stopTimes: stopTimes.length,
  });

  const agencyById = new Map<string, Agency>();
  for (const agency of agencies) {
    const id = safe(agency.agency_id || agency.agency_name);
    if (id) agencyById.set(id, agency);
  }

  const routeById = new Map<string, Route>();
  for (const route of routes) {
    const id = safe(route.route_id);
    if (id) routeById.set(id, route);
  }

  const tripById = new Map<string, Trip>();
  for (const trip of trips) {
    const id = safe(trip.trip_id);
    if (id) tripById.set(id, trip);
  }

  const stopById = new Map<string, Stop>();
  for (const stop of stops) {
    const id = safe(stop.stop_id);
    if (id) stopById.set(id, stop);
  }

  const seen = new Set<string>();
  const output: any[] = [];

  for (const st of stopTimes) {
    const stopId = safe(st.stop_id);
    const tripId = safe(st.trip_id);

    const stop = stopById.get(stopId);
    const trip = tripById.get(tripId);
    if (!stop || !trip) continue;

    const route = routeById.get(safe(trip.route_id));
    if (!route) continue;

    const lat = Number(stop.stop_lat);
    const lng = Number(stop.stop_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const type = routeTypeLabel(route.route_type);
    const routeName =
      safe(route.route_short_name) ||
      safe(route.route_long_name) ||
      safe(route.route_id) ||
      "—";

    const agency = route.agency_id ? agencyById.get(safe(route.agency_id)) : null;

    const provider =
      safe(agency?.agency_name) ||
      safe(route.agency_id) ||
      "Transport operator";

    const destination =
      safe(trip.trip_headsign) ||
      safe(route.route_long_name) ||
      "—";

    const key = [
      type,
      stopId,
      routeName,
      destination,
      provider,
    ].join("|").toLowerCase();

    if (seen.has(key)) continue;
    seen.add(key);

    output.push({
      type,
      stop: safe(stop.stop_name) || "Nearby stop",
      route: routeName,
      destination,
      provider,
      lat,
      lng,
      source: "TFI GTFS cache",
    });
  }

  output.sort((a, b) => {
    if (a.type !== b.type) return String(a.type).localeCompare(String(b.type));
    if (a.stop !== b.stop) return String(a.stop).localeCompare(String(b.stop));
    return String(a.route).localeCompare(String(b.route));
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: GTFS_URL,
        count: output.length,
        items: output,
      },
      null,
      2
    )
  );

  console.log("Transport cache written:", OUT_FILE);
  console.log("Items:", output.length);
}

main().catch((err) => {
  console.error("Transport cache build failed:", err);
  process.exit(1);
});