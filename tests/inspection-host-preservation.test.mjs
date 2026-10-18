import assert from 'node:assert/strict';
import {normalizeSiteUrl} from '../src/url-inspection.js';
assert.equal(normalizeSiteUrl('https://oceanliners.net/ships/ss-storstad'),'https://oceanliners.net/ships/ss-storstad');
assert.equal(normalizeSiteUrl('https://www.oceanliners.net/ships/ss-storstad'),'https://www.oceanliners.net/ships/ss-storstad');
assert.notEqual(normalizeSiteUrl('https://oceanliners.net/ships/ss-storstad'),normalizeSiteUrl('https://www.oceanliners.net/ships/ss-storstad'));
assert.equal(normalizeSiteUrl('https://www.oceanliners.net/white-star-line/?x=1#anchor'),'https://www.oceanliners.net/white-star-line/');
for(const s of ['https://example.org/page','http://oceanliners.net/page','https://oceanliners.net.evil.org/page','/ships/ss-storstad','https://user:pw@oceanliners.net/page','https://oceanliners.net:444/page'])assert.equal(normalizeSiteUrl(s),'');
console.log('URL Inspection host-preservation tests passed');
