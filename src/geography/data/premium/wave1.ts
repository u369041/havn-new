import type { HavnPremiumLocationSeed } from "./types";

export const wave1Locations: HavnPremiumLocationSeed[] = [
  {
    slug: "blackrock-dublin",
    name: "Blackrock",
    canonicalName: "Blackrock",
    displayName: "Blackrock, County Dublin",
    type: "SUBURB",
    county: "Dublin",
    aliases: ["Blackrock", "Blackrock Dublin"],
    searchTerms: [
      "Blackrock",
      "Blackrock Dublin",
      "Blackrock County Dublin",
      "Blackrock Co Dublin"
    ],
    indexable: true,
    isPopular: true,
    seoPriority: 90,
    displayOrder: 100
  },
  {
    slug: "douglas-cork",
    name: "Douglas",
    canonicalName: "Douglas",
    displayName: "Douglas, County Cork",
    type: "SUBURB",
    county: "Cork",
    aliases: ["Douglas", "Douglas Cork"],
    searchTerms: [
      "Douglas",
      "Douglas Cork",
      "Douglas County Cork",
      "Douglas Co Cork"
    ],
    indexable: true,
    isPopular: true,
    seoPriority: 80,
    displayOrder: 110
  },
  {
    slug: "ballincollig-cork",
    name: "Ballincollig",
    canonicalName: "Ballincollig",
    displayName: "Ballincollig, County Cork",
    type: "TOWN",
    county: "Cork",
    aliases: ["Ballincollig", "Ballincollig Cork"],
    searchTerms: [
      "Ballincollig",
      "Ballincollig Cork",
      "Ballincollig County Cork",
      "Ballincollig Co Cork"
    ],
    indexable: true,
    isPopular: true,
    seoPriority: 80,
    displayOrder: 120
  },
  {
    slug: "dooradoyle-limerick",
    name: "Dooradoyle",
    canonicalName: "Dooradoyle",
    displayName: "Dooradoyle, County Limerick",
    type: "SUBURB",
    county: "Limerick",
    aliases: ["Dooradoyle", "Dooradoyle Limerick"],
    searchTerms: [
      "Dooradoyle",
      "Dooradoyle Limerick",
      "Dooradoyle County Limerick",
      "Dooradoyle Co Limerick"
    ],
    indexable: true,
    isPopular: true,
    seoPriority: 75,
    displayOrder: 130
  },
  {
    slug: "greystones-delgany",
    updateExistingSlug: "greystones-delgany",
    name: "Greystones-Delgany",
    canonicalName: "Greystones-Delgany",
    displayName: "Greystones-Delgany",
    type: "TOWN",
    county: "Wicklow",
    aliases: ["Greystones-Delgany", "Greystones", "Delgany"],
    searchTerms: [
      "Greystones-Delgany",
      "Greystones",
      "Delgany",
      "Greystones Wicklow",
      "Delgany Wicklow",
      "Greystones County Wicklow",
      "Delgany County Wicklow"
    ],
    indexable: true,
    isPopular: true,
    seoPriority: 85,
    displayOrder: 90
  }
];