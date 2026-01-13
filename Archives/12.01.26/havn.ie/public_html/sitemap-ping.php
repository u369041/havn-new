<?php
// /public_html/sitemap-ping.php
// Pings Google & Bing so they recrawl your sitemap promptly.

declare(strict_types=1);

$sitemap = 'https://havn.ie/sitemap.xml';

$targets = [
  'google' => 'https://www.google.com/ping?sitemap=' . rawurlencode($sitemap),
  'bing'   => 'https://www.bing.com/ping?sitemap='   . rawurlencode($sitemap),
];

$results = [];

foreach ($targets as $name => $url) {
  $start = microtime(true);
  $status = null;
  $body = null;

  // Prefer cURL
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_USERAGENT      => 'HAVN-Sitemap-Pinger/1.0',
      CURLOPT_TIMEOUT        => 10,
      CURLOPT_FOLLOWLOCATION => true,
    ]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
  } else {
    // Fallback to file_get_contents
    $context = stream_context_create([
      'http' => [
        'method'  => 'GET',
        'timeout' => 10,
        'header'  => "User-Agent: HAVN-Sitemap-Pinger/1.0\r\n",
      ],
    ]);
    $body = @file_get_contents($url, false, $context);
    $status = 0;
    if (isset($http_response_header) && is_array($http_response_header)) {
      foreach ($http_response_header as $h) {
        if (preg_match('~^HTTP/\S+\s+(\d{3})~i', $h, $m)) {
          $status = (int)$m[1];
          break;
        }
      }
    }
  }

  $elapsed = round((microtime(true) - $start) * 1000);
  $results[] = [
    'engine'  => $name,
    'url'     => $url,
    'status'  => $status,
    'ms'      => $elapsed,
  ];
}

// log to /tmp
$line = date('c') . ' ' . json_encode($results) . PHP_EOL;
@file_put_contents('/tmp/sitemap-ping.log', $line, FILE_APPEND);

// return JSON for manual checks
header('Content-Type: application/json; charset=UTF-8');
echo json_encode(['ok' => true, 'results' => $results], JSON_PRETTY_PRINT);
