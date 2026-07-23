SELECT
  "canonicalName",
  county,
  searchable,
  "isActive"
FROM "Location"
WHERE "canonicalName" IN (
  'Blackrock',
  'Greystones',
  'Douglas',
  'Ballincollig',
  'Dooradoyle'
)
ORDER BY "canonicalName";
