'use strict';
const https = require('https');
const http = require('http');
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

        const lib = url.startsWith('https://') ? https : http;
        const req = lib.get(url, options || {}, (res) => {
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

    const url = `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${lon},${lat}&output=json&orders=legalcode,roadaddr,addr`;
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

    const admResult = parsed.results.find((r) => r.name === 'legalcode') || parsed.results[0];
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
    const sublocality1 = getComp('sublocality_level_1');

    // 일본은 郡(level_2)과 市町村(locality)를 둘 다 포함 (예: 쿠니가미군 온나촌)
    // 그 외 국가는 locality 우선, 없을 때만 level_2 사용 (County/Landkreis 중복 방지)
    const cityParts = [
        ...(countryCode === 'JP' ? [level2, locality] : [locality || level2]),
        sublocality1,
    ].filter(Boolean)
     .filter((v, i, arr) => arr.indexOf(v) === i) // 중복 제거
     .filter(v => v !== state);                   // state와 중복 제거 (중국 직할시 등)

    return {
        country:      country      || null,
        countryCode:  countryCode  || null,
        state:        state        || null,
        level2:       level2       || null,
        locality:     locality     || null,
        sublocality1: sublocality1 || null,
        city:         cityParts.join(' ') || null,
    };
}

async function fetchHere(lat, lon) {
    if (!config.hereApiKey) return null;

    const url = `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lon}&lang=ko&apiKey=${config.hereApiKey}`;
    const parsed = await httpGet(url, {}, config.hereTimeoutMs);

    if (!parsed || !parsed.items?.length) return null;

    const item = parsed.items[0];
    const addr = item.address;

    const country = addr.countryName || null;
    const countryCode = addr.countryCode || null; // ISO 3166-1 alpha-3
    const state = addr.state || addr.county || null;
    const cityParts = [
        addr.city,
        addr.district,
    ].filter(Boolean)
     .filter((v, i, arr) => arr.indexOf(v) === i)
     .filter(v => v !== state);

    return {
        country,
        countryCode,
        state,
        city: cityParts.join(' ') || null,
    };
}

async function fetchPhoton(lat, lon) {
    if (!config.photonUrl) return null;

    const url = `${config.photonUrl}/reverse?lat=${lat}&lon=${lon}`;
    const parsed = await httpGet(url, {}, config.photonTimeoutMs);

    if (!parsed || !parsed.features?.length) return null;

    const props = parsed.features[0].properties;
    const country = props.country || null;
    const countryCode = props.countrycode || null;
    let state = props.state || null;
    let city = props.city || null;

    // 한국 특별시/광역시/특별자치시: state가 없고 city 또는 name에 광역 단위명이 있으면 state로 승격
    // 예) city="서울특별시" → state="서울특별시", city=null (district가 city 역할)
    // 예) 세종처럼 city=null, name="세종특별자치시" → state="세종특별자치시"
    if (countryCode === 'KR' && !state) {
        const candidate = city || (!props.county && !props.district ? props.name : null);
        if (candidate && /특별시$|광역시$|특별자치시$/.test(candidate)) {
            state = candidate;
            city = null;
        }
    }

    const cityParts = [
        props.county,   // 군/구 (KR), 지청 (JP) 등
        city,
        props.district,
    ].filter(Boolean)
     .filter((v, i, arr) => arr.indexOf(v) === i)
     .filter(v => v !== state);

    return {
        country,
        countryCode,
        state,
        city: cityParts.join(' ') || null,
    };
}

async function fetchKakao(lat, lon) {
    if (!config.kakaoApiKey) return null;

    const url = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lon}&y=${lat}`;
    const parsed = await httpGet(
        url,
        { headers: { Authorization: `KakaoAK ${config.kakaoApiKey}` } },
        config.kakaoTimeoutMs,
    );

    if (!parsed || !parsed.documents?.length) return null;

    const doc = parsed.documents[0];
    const addr = doc.address;
    if (!addr) return null;

    const KAKAO_STATE_MAP = {
        '서울': '서울특별시', '부산': '부산광역시', '대구': '대구광역시',
        '인천': '인천광역시', '광주': '광주광역시', '대전': '대전광역시',
        '울산': '울산광역시', '세종': '세종특별자치시',
    };
    const raw = addr.region_1depth_name || '';
    const stateName = KAKAO_STATE_MAP[raw] || raw;
    const cityParts = [addr.region_2depth_name, addr.region_3depth_name].filter(
        (p) => p && p.trim(),
    );
    let cityName = cityParts.join(' ');

    if (config.includeBuildingName) {
        const building = doc.road_address?.building_name?.trim();
        if (building && building.length >= 2 && isNaN(Number(building))) {
            cityName = `${cityName} (${building})`.trim();
        }
    }

    return { country: '대한민국', state: stateName, city: cityName };
}

async function fetchAddress(lat, lon) {
    if (isKorean(lat, lon)) {
        if (config.geocodingKorea === 'naver')  return fetchNaver(lat, lon);
        if (config.geocodingKorea === 'kakao')  return fetchKakao(lat, lon);
        if (config.geocodingKorea === 'google') return fetchGoogle(lat, lon);
        if (config.geocodingKorea === 'here')   return fetchHere(lat, lon);
        if (config.geocodingKorea === 'photon') return fetchPhoton(lat, lon);
        return null;
    } else {
        if (config.geocodingWorld === 'google') return fetchGoogle(lat, lon);
        if (config.geocodingWorld === 'here')   return fetchHere(lat, lon);
        if (config.geocodingWorld === 'photon') return fetchPhoton(lat, lon);
        return null;
    }
}

module.exports = { fetchAddress, fetchNaver, fetchKakao, fetchGoogle, fetchHere, fetchPhoton, isKorean };
