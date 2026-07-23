export type HavnPremiumLocationSeed = {
  slug: string;
  name: string;
  canonicalName: string;
  displayName: string;
  type:
    | "CITY"
    | "SUBURB"
    | "LOCALITY"
    | "TOWN"
    | "VILLAGE"
    | "NEIGHBOURHOOD"
    | "POSTAL_DISTRICT"
    | "SEARCH_REGION";
  county: string;
  aliases: string[];
  searchTerms: string[];
  latitude?: number;
  longitude?: number;
  indexable: boolean;
  isPopular: boolean;
  seoPriority: number;
  displayOrder: number;
  updateExistingSlug?: string;
};