import { LocationType } from "@prisma/client";

export type CoreLocationSeed = {
  slug: string;
  name: string;
  canonicalName: string;
  displayName: string;
  type: LocationType;

  parentSlug: string | null;
  county: string | null;

  latitude?: number | null;
  longitude?: number | null;

  aliases?: string[];
  searchTerms?: string[];
  eircodeRoutingKeys?: string[];

  population?: number | null;

  searchable?: boolean;
  indexable?: boolean;
  isPopular?: boolean;
  isActive?: boolean;

  seoPriority?: number;
  displayOrder?: number;

  tailteId?: string | null;
  csoId?: string | null;
  osmId?: string | null;
  geonamesId?: string | null;

  sourceData?: Record<string, unknown>;
};

const county = (
  name: string,
  slug: string,
  displayOrder: number,
  options: Partial<CoreLocationSeed> = {},
): CoreLocationSeed => ({
  slug,
  name,
  canonicalName: name,
  displayName: `County ${name}`,
  type: LocationType.COUNTY,
  parentSlug: "ireland",
  county: name,
  aliases: [name, `County ${name}`],
  searchTerms: [name, `County ${name}`],
  eircodeRoutingKeys: [],
  population: null,
  searchable: true,
  indexable: false,
  isPopular: false,
  isActive: true,
  seoPriority: 50,
  displayOrder,
  sourceData: {
    source: "HAVN_CORE_SEED",
    version: 1,
  },
  ...options,
});

const city = (
  name: string,
  slug: string,
  countyName: string,
  countySlug: string,
  displayOrder: number,
  options: Partial<CoreLocationSeed> = {},
): CoreLocationSeed => ({
  slug,
  name,
  canonicalName: name,
  displayName: `${name} City`,
  type: LocationType.CITY,
  parentSlug: countySlug,
  county: countyName,
  aliases: [name, `${name} City`],
  searchTerms: [name, `${name} City`, countyName],
  eircodeRoutingKeys: [],
  population: null,
  searchable: true,
  indexable: false,
  isPopular: true,
  isActive: true,
  seoPriority: 90,
  displayOrder,
  sourceData: {
    source: "HAVN_CORE_SEED",
    version: 1,
  },
  ...options,
});

export const coreLocations: CoreLocationSeed[] = [
  {
    slug: "ireland",
    name: "Ireland",
    canonicalName: "Ireland",
    displayName: "Ireland",
    type: LocationType.COUNTRY,
    parentSlug: null,
    county: null,
    aliases: ["Ireland", "Republic of Ireland"],
    searchTerms: ["Ireland", "Republic of Ireland", "Irish property"],
    eircodeRoutingKeys: [],
    population: null,
    searchable: true,
    indexable: false,
    isPopular: true,
    isActive: true,
    seoPriority: 100,
    displayOrder: 0,
    sourceData: {
      source: "HAVN_CORE_SEED",
      version: 1,
    },
  },

  county("Carlow", "county-carlow", 10),
  county("Cavan", "county-cavan", 20),
  county("Clare", "county-clare", 30),
  county("Cork", "county-cork", 40, {
    isPopular: true,
    seoPriority: 75,
  }),
  county("Donegal", "county-donegal", 50),
  county("Dublin", "county-dublin", 60, {
    isPopular: true,
    seoPriority: 90,
  }),
  county("Galway", "county-galway", 70, {
    isPopular: true,
    seoPriority: 75,
  }),
  county("Kerry", "county-kerry", 80),
  county("Kildare", "county-kildare", 90, {
    isPopular: true,
    seoPriority: 70,
  }),
  county("Kilkenny", "county-kilkenny", 100),
  county("Laois", "county-laois", 110),
  county("Leitrim", "county-leitrim", 120),
  county("Limerick", "county-limerick", 130, {
    isPopular: true,
    seoPriority: 75,
  }),
  county("Longford", "county-longford", 140),
  county("Louth", "county-louth", 150),
  county("Mayo", "county-mayo", 160),
  county("Meath", "county-meath", 170, {
    isPopular: true,
    seoPriority: 70,
  }),
  county("Monaghan", "county-monaghan", 180),
  county("Offaly", "county-offaly", 190),
  county("Roscommon", "county-roscommon", 200),
  county("Sligo", "county-sligo", 210),
  county("Tipperary", "county-tipperary", 220),
  county("Waterford", "county-waterford", 230),
  county("Westmeath", "county-westmeath", 240),
  county("Wexford", "county-wexford", 250),
  county("Wicklow", "county-wicklow", 260, {
    isPopular: true,
    seoPriority: 70,
  }),

  city(
    "Dublin",
    "dublin-city",
    "Dublin",
    "county-dublin",
    10,
    {
      aliases: ["Dublin", "Dublin City", "City of Dublin"],
      searchTerms: [
        "Dublin",
        "Dublin City",
        "City of Dublin",
        "Dublin property",
      ],
      seoPriority: 100,
    },
  ),

  city(
    "Cork",
    "cork-city",
    "Cork",
    "county-cork",
    20,
    {
      aliases: ["Cork", "Cork City", "City of Cork"],
      searchTerms: [
        "Cork",
        "Cork City",
        "City of Cork",
        "Cork property",
      ],
      seoPriority: 95,
    },
  ),

  city(
    "Limerick",
    "limerick-city",
    "Limerick",
    "county-limerick",
    30,
    {
      aliases: ["Limerick", "Limerick City", "City of Limerick"],
      searchTerms: [
        "Limerick",
        "Limerick City",
        "City of Limerick",
        "Limerick property",
      ],
      seoPriority: 90,
    },
  ),

  city(
    "Galway",
    "galway-city",
    "Galway",
    "county-galway",
    40,
    {
      aliases: ["Galway", "Galway City", "City of Galway"],
      searchTerms: [
        "Galway",
        "Galway City",
        "City of Galway",
        "Galway property",
      ],
      seoPriority: 90,
    },
  ),

  city(
    "Waterford",
    "waterford-city",
    "Waterford",
    "county-waterford",
    50,
    {
      aliases: ["Waterford", "Waterford City", "City of Waterford"],
      searchTerms: [
        "Waterford",
        "Waterford City",
        "City of Waterford",
        "Waterford property",
      ],
      seoPriority: 85,
    },
  ),
];