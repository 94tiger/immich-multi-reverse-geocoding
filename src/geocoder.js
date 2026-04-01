'use strict';
const https = require('https');
const config = require('./config');

function isKorean(lat, lon) {
    return lat >= 33 && lat <= 43 && lon >= 124 && lon <= 132;
}

function httpGet(url, options, timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (val) => {
            if (!settled) {
                settled = true;
                resolve(val);
            }
        };

        const req = https.get(url, options || {}, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
                if (res.statusCode !== 200) return done(null);
                try {
                    done(JSON.parse(data));
                } catch {
                    done(null);
                }
            });
            res.on('error', () => done(null));
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy();
            done(null);
        });
        req.on('error', () => done(null));
    });
}

async function fetchNaver(lat, lon) {
    if (!config.naverId || !config.naverSecret) return null;

    const url = `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${lon},${lat}&output=json&orders=admcode,roadaddr,addr`;
    const parsed = await httpGet(
        url,
        {
            headers: {
                'x-ncp-apigw-api-key-id': config.naverId,
                'x-ncp-apigw-api-key': config.naverSecret,
            },
        },
        config.naverTimeoutMs,
    );

    if (!parsed || parsed.status?.code !== 0 || !Array.isArray(parsed.results) || !parsed.results.length) {
        return null;
    }

    const admResult = parsed.results.find((r) => r.name === 'admcode') || parsed.results[0];
    const region = admResult.region;

    const stateName = region.area1?.name || '';
    const cityParts = [region.area2?.name, region.area3?.name, region.area4?.name].filter(
        (p) => p && p.trim(),
    );
    let cityName = cityParts.join(' ');

    if (config.includeBuildingName) {
        const roadResult = parsed.results.find((r) => r.name === 'roadaddr');
        if (roadResult?.land?.addition0?.value) {
            const building = roadResult.land.addition0.value.trim();
            if (building.length >= 2 && isNaN(Number(building))) {
                cityName = `${cityName} (${building})`.trim();
            }
        }
    }

    return { country: '대한민국', state: stateName, city: cityName };
}

async function fetchGoogle(lat, lon) {
    if (!config.googleApiKey) return null;

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&language=${config.googleLanguage}&key=${config.googleApiKey}`;
    const parsed = await httpGet(url, {}, config.googleTimeoutMs);

    if (!parsed || parsed.status !== 'OK' || !parsed.results?.length) return null;

    const result = parsed.results[0];
    const getComp = (...types) => {
        for (const type of types) {
            const c = result.address_components?.find((c) => c.types.includes(type));
            if (c) return c.long_name;
        }
        return null;
    };

    const countryCode = result.address_components?.find(c => c.types.includes('country'))?.short_name;
    const country = getComp('country');
    const state = getComp('administrative_area_level_1');
    const level2 = getComp('administrative_area_level_2');
    const locality = getComp('locality');

    // 일본은 郡(level_2)과 市町村(locality)를 둘 다 포함 (예: 쿠니가미군 온나촌)
    // 그 외 국가는 locality 우선, 없을 때만 level_2 사용 (County/Landkreis 중복 방지)
    const cityParts = [
        ...(countryCode === 'JP' ? [level2, locality] : [locality || level2]),
        getComp('sublocality_level_1'),
    ].filter(Boolean)
     .filter((v, i, arr) => arr.indexOf(v) === i) // 중복 제거
     .filter(v => v !== state);                   // state와 중복 제거 (중국 직할시 등)

    return { country: country || null, state: state || null, city: cityParts.join(' ') || null };
}

async function fetchAddress(lat, lon) {
    if (isKorean(lat, lon)) {
        if (config.geocodingKorea === 'google') return fetchGoogle(lat, lon);
        if (config.geocodingKorea === 'naver') return fetchNaver(lat, lon);
        return null;
    } else {
        if (config.geocodingWorld === 'google') return fetchGoogle(lat, lon);
        return null;
    }
}

module.exports = { fetchAddress, fetchNaver, fetchGoogle, isKorean };
