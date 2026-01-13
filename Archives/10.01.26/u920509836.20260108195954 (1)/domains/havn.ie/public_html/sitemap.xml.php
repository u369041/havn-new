<?php
// /public_html/sitemap.xml.php
// HAVN.ie live sitemap builder — clean version

declare(strict_types=1);

header('Content-Type: application/xml; charset=UTF-8');

// Basic config
$site = 'https://havn.ie';
$api  = 'https://api.havn.ie/api/properties';

// Fetch JSON data from the live API
$context = stream_context_create([
  'http' => [
    'timeout' => 5,
    'header'  => "Accept: application/json\r\n",
  ],
]);
$response = @file_get_contents($api, false, $context);
$data = $response ? json_decode($response, true) : null;

// Extract property list safely
$properties = [];
if (is_array($data)) {
  if (isset($data['properties']) && is_array($data['properties'])) {
    $properties = $data['properties'];
  } elseif (array_is_list($data)) {
    $properties = $data;
  }
}

// Helper for ISO date
function iso($v): string {
  if (!$v) return gmdate('c');
  $t = strtotime($v);
  return $t ? gmdate('c', $t) : gmdate('c');
}

// Start XML output
echo '<?xml version="1.0" encoding="UTF-8"?>', "\n";
?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc><?= htmlspecialchars($site . '/', ENT_QUOTES) ?></loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc><?= htmlspecialchars($site . '/properties.html', ENT_QUOTES) ?></loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>

  <?php foreach ($properties as $p):
    $slug = $p['slug'] ?? null;
    if (!$slug) continue;
    $loc  = $site . '/property.html?slug=' . rawurlencode($slug);
    $last = $p['updatedAt'] ?? ($p['createdAt'] ?? null);
  ?>
  <url>
    <loc><?= htmlspecialchars($loc, ENT_QUOTES) ?></loc>
    <lastmod><?= iso($last) ?></lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <?php endforeach; ?>
</urlset>
