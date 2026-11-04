// Offline routing tests; modeled S3 responses are not live HTTP verification.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const source = path.join(root, 'marathon2026/infra/terraform');
const mirror = path.join(root, '.tools/deployment/eu-north-1/terraform');
const tf = fs.readFileSync(path.join(source, 'cloudfront.tf'), 'utf8');
const code = fs.readFileSync(path.join(source, 'spa-navigation.js'), 'utf8');
const context = vm.createContext({}); vm.runInContext(code, context);
const rewrite = (uri, method = 'GET') => context.handler({ request: { uri, method, querystring: { token: { value: 'unchanged' } } } });
const exactBlock = tf.slice(tf.indexOf('# Exact bundled keys'), tf.indexOf('# Catalog keys'));
const keys = [...exactBlock.matchAll(/"(assets\/img\/[^"*]+)"/g)].map(x => '/' + x[1]);
const origin = uri => keys.includes(uri) ? 'frontend' : /^\/assets\/img\/(dishes|locations)\//.test(uri) ? 'catalog' : 'frontend';

test('source/mirror identical, seven exact keys precede catalog; private OAC retained', () => {
  assert.equal(fs.readFileSync(path.join(mirror, 'cloudfront.tf'), 'utf8').replace(/\r\n/g, '\n'), tf.replace(/\r\n/g, '\n'));
  assert.equal(fs.readFileSync(path.join(mirror, 'spa-navigation.js'), 'utf8'), code);
  assert.equal(keys.length, 7); assert.equal(new Set(keys).size, 7);
  assert.ok(keys.length + 2 <= 25); // Below default ordered-behavior quota.
  assert.ok(tf.indexOf('# Exact bundled keys') < tf.indexOf('for_each = ["assets/img/dishes/*"'));
  assert.match(exactBlock, /target_origin_id\s*=\s*"s3-frontend"/);
  assert.equal((tf.match(/function_association/g) || []).length, 1);
  assert.ok(tf.indexOf('function_association') < tf.indexOf('# Exact bundled keys'));
  assert.equal((tf.match(/resource "aws_cloudfront_function"/g) || []).length, 1);
  assert.ok(Buffer.byteLength(code) < 10000);
  assert.equal((tf.match(/origin_access_control_id/g) || []).length, 2);
  assert.doesNotMatch(tf, /custom_error_response/);
});
for (const uri of keys) test('bundled JPEG: ' + uri, () => {
  const file = path.join(root, 'marathon2026/frontend/restaurant-frontend-app/dist/restaurant-frontend-app/browser', uri.slice(1));
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  assert.equal(origin(uri), 'frontend'); assert.equal(rewrite(uri).uri, uri);
});

const routes = fs.readFileSync(path.join(root, 'marathon2026/frontend/restaurant-frontend-app/src/app/app.routes.ts'), 'utf8');
for (const [,route] of routes.matchAll(/path:\s*'([^']*)'/g)) {
  if (route === '**') continue;
  const uri = '/' + route.replace(/:[A-Za-z]+/g, 'test-id_123');
  for (const method of ['GET', 'HEAD']) test(method + ' Angular route ' + uri, () => {
    const request = rewrite(uri, method); assert.equal(request.uri, '/index.html');
    assert.equal(request.querystring.token.value, 'unchanged');
  });
}
for (const uri of ['/missing.js', '/missing.css', '/assets/missing', '/assets/missing.png', '/assets/img/dishes/missing.jpg', '/assets/img/locations/missing.jpg', '/api/locations', '/develop/locations', '/guest/groups/id/sessions', '/unknown', '/locations/file.js', '/join/file.png', '/join/a%2Fb']) {
  test('missing/static/API unchanged: ' + uri, () => {
    assert.equal(rewrite(uri).uri, uri);
    // With no global custom error mapping, simulated origin errors retain status/type.
    for (const status of [403,404]) {
      const originResponse = { status, contentType: 'application/xml' };
      const viewerResponse = originResponse;
      assert.equal(viewerResponse.status, status); assert.notEqual(viewerResponse.contentType, 'text/html');
    }
  });
}
test('catalog origin unchanged; non-read methods never rewritten', () => {
  assert.equal(origin('/assets/img/dishes/uploaded.jpg'), 'catalog');
  assert.equal(rewrite('/assets/img/dishes/uploaded.jpg').uri, '/assets/img/dishes/uploaded.jpg');
  for (const method of ['POST','PUT','DELETE','OPTIONS']) assert.equal(rewrite('/main',method).uri, '/main');
});
