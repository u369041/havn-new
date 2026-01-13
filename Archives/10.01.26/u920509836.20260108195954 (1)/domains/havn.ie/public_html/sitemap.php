<?php
// sitemap.php — dynamic XML sitemap for havn.ie
// Outputs: https://havn.ie/sitemap.xml (if routed to this file) or /sitemap.php
// Assumes frontend pages live at https://havn.ie/* and API at https://api.havn.ie/*

declare(strict_types=1);

// ---------- Config ----------
$SITE = 'https://havn.ie';
$API  = 'https://api.havn.ie/api/properties';
$TAKE = 200; // page size when fetching properties

// ---------- Helpers ----------
function h(string $s): string {
  return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function get_json(string $url, int $timeout = 10): array {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_CONNECTTIMEOUT => $timeout,
    CURLOPT_TIMEOUT => $timeout,
    CURLOPT_HTTPHEADER => ['Accept: application/json'],
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_USERAGENT => 'havn-sitemap/1.0'
  ]);
  $raw = curl_exec($ch);
  $err = curl_error($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  if ($raw === false || $code >= 400) {
    return [];
  }
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function iso_date(?string $dt): string {
  if (!$dt) return gmdate('c');
  $t = strtotime($dt);
  if ($t === false) return gmdate('c');
  return gmdate('c', $t);
}

// ---------- Collect URLs ----------
$urls = [];

// Static / high-value pages
$urls[] = [
  'loc' => "{$SITE}/",
  'lastmod' => gmdate('c'),
  'priority' => '1.0',
  'changefreq' => 'daily',
];
$urls[] = [
  'loc' => "{$SITE}/properties.html",
  'lastmod' => gmdate('c'),
  'priority' => '0.9',
  'changefreq' => 'daily',
];
$urls[] = [
  'loc' => "{$SITE}/property-upload.html",
  'lastmod' => gmdate('c'),
  'priority' => '0.5',
  'changefreq' => 'weekly',
];

// Useful browse entry points
$combos = [
  ['mode' => 'buy',   'type' => 'house'],
  ['mode' => 'buy',   'type' => 'apartment'],
  ['mode' => 'buy',   'type' => 'site'],
  ['mode' => 'rent',  'type' => 'house'],
  ['mode' => 'rent',  'type' => 'apartment'],
  ['mode' => 'share', 'type' => 'house'],
  ['mode' => 'share', 'type' => 'apartment'],
];
foreach ($combos as $c) {
  $q = http_build_query($c);
  $urls[] = [
    'loc' => "{$SITE}/properties.html?{$q}",
    'lastmod' => gmdate('c'),
    'priority' => '0.7',
    'changefreq' => 'daily',
  ];
}

// Dynamic property detail pages (published only)
$skip = 0;
$total = null;
do {
  $qp = http_build_query([
    'status' => 'PUBLISHED',
    'take' => $TAKE,
    'skip' => $skip
  ]);
  $data = get_json("{$API}?{$qp}");
  $props = $data['properties'] ?? [];
  $count = is_array($props) ? count($props) : 0;
  if ($total === null) {
    $total = isset($data['count']) ? (int)$data['count'] : $count;
  }

  foreach ($props as $p) {
    $slug = isset($p['slug']) ? (string)$p['slug'] : '';
    if ($slug === '') continue;
    $last = $p['updatedAt'] ?? ($p['createdAt'] ?? null);
    $urls[] = [
      'loc' => "{$SITE}/property.html?slug=" . rawurlencode($slug),
      'lastmod' => iso_date($last),
      'priority' => '0.8',
      'changefreq' => 'weekly',
    ];
  }

  $skip += $TAKE;
} while ($count === $TAKE && $skip < 20000); // hard cap to avoid runaway

// ---------- Output XML ----------
header('Content-Type: application/xml; charset=UTF-8');

// Optional: basic caching headers (adjust as you like)
header('Cache-Control: public, max-age=3600, s-maxage=3600');

echo "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
echo "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";

foreach ($urls as $u) {
  echo "  <url>\n";
  echo "    <loc>" . h($u['loc']) . "</loc>\n";
  if (!empty($u['lastmod'])) {
    echo "    <lastmod>" . h($u['lastmod']) . "</lastmod>\n";
  }
  if (!empty($u['changefreq'])) {
    echo "    <changefreq>" . h($u['changefreq']) . "</changefreq>\n";
  }
  if (!empty($u['priority'])) {
    echo "    <priority>" . h($u['priority']) . "</priority>\n";
  }
  echo "  </url>\n";
}

echo "</urlset>\n";
