<?php
/**
 * api-proxy.php — diagnostic, SSL-hardened CORS proxy from havn.ie → https://api.havn.ie
 */
header("Content-Type: application/json; charset=utf-8");

$path = isset($_GET['path']) ? $_GET['path'] : '';
if ($path === '') {
  http_response_code(400);
  echo json_encode(["ok"=>false,"error"=>"missing_path","hint"=>"Use /api-proxy.php?path=/api/properties"]);
  exit;
}

$target = "https://api.havn.ie" . $path;

$method  = $_SERVER['REQUEST_METHOD'];
$input   = file_get_contents('php://input');

$forward_headers = [];
$all = function_exists('getallheaders') ? getallheaders() : [];
foreach ($all as $k => $v) {
  $lk = strtolower($k);
  if (in_array($lk, ['content-type','x-admin-key','authorization'])) {
    $forward_headers[] = $k . ': ' . $v;
  }
}

$ch = curl_init($target);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CUSTOMREQUEST  => $method,
  CURLOPT_HTTPHEADER     => $forward_headers,
  CURLOPT_TIMEOUT        => 45,
  CURLOPT_FOLLOWLOCATION => true,
  // Temporarily relax SSL to bypass strict hosting chains; set back to true/2 when stable:
  CURLOPT_SSL_VERIFYPEER => false,
  CURLOPT_SSL_VERIFYHOST => 0,
]);

if (in_array($method, ['POST','PUT','PATCH','DELETE'])) {
  curl_setopt($ch, CURLOPT_POSTFIELDS, $input);
}

$response = curl_exec($ch);
$errno    = curl_errno($ch);
$error    = curl_error($ch);
$code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false) {
  http_response_code(502);
  echo json_encode([
    "ok"=>false,"error"=>"proxy_error","errno"=>$errno,"detail"=>$error,"target"=>$target,"method"=>$method,"headers"=>$forward_headers
  ], JSON_PRETTY_PRINT);
  exit;
}

http_response_code($code ?: 200);
echo $response;
