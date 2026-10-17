import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('site discovery has descriptive title, aliases, canonical URL and independent-project notice',()=>{
  const html=readFileSync('index.html','utf8');
  assert.match(html,/<title>华北理工大学三维地图 \| 华北理工数字校园 WebGIS<\/title>/);
  assert.match(html,/<meta name="description" content="[^"]*非学校官方网站/);
  assert.match(html,/<link rel="canonical" href="https:\/\/ncstgeo.cn\/map"/);
  const data=JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)![1]!);
  assert.equal(data['@type'],'WebSite');
  assert.ok(data.alternateName.includes('华北理工数字校园'));
  assert.equal(data.url,'https://ncstgeo.cn/');
});

test('crawler rules expose a stable sitemap, without indexing model or API endpoints',()=>{
  const robots=readFileSync('public/robots.txt','utf8');
  assert.match(robots,/Allow: \/\n/);
  assert.match(robots,/Disallow: \/api\//);
  assert.match(robots,/Sitemap: https:\/\/ncstgeo.cn\/sitemap.xml/);
  const sitemap=readFileSync('public/sitemap.xml','utf8');
  assert.match(sitemap,/<loc>https:\/\/ncstgeo.cn\/map<\/loc>/);
  const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>new URL(match[1]!));
  assert.ok(urls.every(url=>!url.search),'camera/selection URL variants must not be submitted');
});
