'use strict';
const { Client } = require('pg');
const config = require('./config');

function createClient() {
    return new Client({
        ...config.db,
        options: '-c search_path=public',
    });
}

// Google 원본 컴포넌트로 city 재조합 (geocoder.js의 fetchGoogle 로직과 동일하게 유지)
function assembleCityFromComponents(row) {
    const { country_code, state, level2, locality, sublocality1 } = row;
    const parts = [
        ...(country_code === 'JP' ? [level2, locality] : [locality || level2]),
        sublocality1,
    ].filter(Boolean)
     .filter((v, i, arr) => arr.indexOf(v) === i)
     .filter(v => v !== state);
    return parts.join(' ') || null;
}

async function ensureCacheTable(client) {
    // 전용 스키마 생성
    await client.query(`CREATE SCHEMA IF NOT EXISTS geocoding`);

    await client.query(`
        CREATE TABLE IF NOT EXISTS geocoding.geocode_cache (
            cache_key   VARCHAR PRIMARY KEY,
            country     VARCHAR,
            state       VARCHAR,
            city        VARCHAR,
            country_code VARCHAR,
            level2      VARCHAR,
            locality    VARCHAR,
            sublocality1 VARCHAR,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 기존 테이블에 컴포넌트 컬럼 추가 (이미 있으면 무시)
    await client.query(`ALTER TABLE geocoding.geocode_cache ADD COLUMN IF NOT EXISTS country_code VARCHAR`);
    await client.query(`ALTER TABLE geocoding.geocode_cache ADD COLUMN IF NOT EXISTS level2 VARCHAR`);
    await client.query(`ALTER TABLE geocoding.geocode_cache ADD COLUMN IF NOT EXISTS locality VARCHAR`);
    await client.query(`ALTER TABLE geocoding.geocode_cache ADD COLUMN IF NOT EXISTS sublocality1 VARCHAR`);

    // 기존 public.custom_naver_geocode_cache → geocoding.geocode_cache 마이그레이션
    const { rows } = await client.query(`
        SELECT to_regclass('public.custom_naver_geocode_cache') AS tbl
    `);
    if (rows[0].tbl) {
        await client.query(`
            INSERT INTO geocoding.geocode_cache (cache_key, country, state, city, updated_at)
            SELECT cache_key,
                   COALESCE(country, '대한민국'),
                   state,
                   city,
                   updated_at
            FROM public.custom_naver_geocode_cache
            ON CONFLICT (cache_key) DO NOTHING
        `);
        await client.query(`DROP TABLE public.custom_naver_geocode_cache`);
        console.log('[마이그레이션] public.custom_naver_geocode_cache → geocoding.geocode_cache 완료');
    }
}

async function warmUpCache(client, memCache, ttlDays) {
    memCache.clear();
    const res = await client.query(
        `SELECT cache_key, country, state, city, country_code, level2, locality, sublocality1
         FROM geocoding.geocode_cache
         WHERE updated_at >= CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')`,
        [ttlDays],
    );
    for (const row of res.rows) {
        // Google 결과(country_code 있음): 현재 로직으로 city 재조합
        const city = row.country_code ? assembleCityFromComponents(row) : row.city;
        memCache.set(row.cache_key, { country: row.country, state: row.state, city });
    }
    return res.rows.length;
}

async function upsertCache(client, cacheKey, address) {
    await client.query(
        `INSERT INTO geocoding.geocode_cache
             (cache_key, country, state, city, country_code, level2, locality, sublocality1, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
         ON CONFLICT (cache_key) DO UPDATE
         SET country      = EXCLUDED.country,
             state        = EXCLUDED.state,
             city         = EXCLUDED.city,
             country_code = EXCLUDED.country_code,
             level2       = EXCLUDED.level2,
             locality     = EXCLUDED.locality,
             sublocality1 = EXCLUDED.sublocality1,
             updated_at   = CURRENT_TIMESTAMP`,
        [
            cacheKey,
            address.country,
            address.state,
            address.city,
            address.countryCode  || null,
            address.level2       || null,
            address.locality     || null,
            address.sublocality1 || null,
        ],
    );
}

async function bulkUpdate(client, items) {
    if (!items.length) return 0;

    const values = [];
    const placeholders = [];

    items.forEach((item, i) => {
        const b = i * 4;
        placeholders.push(`($${b + 1}::uuid, $${b + 2}, $${b + 3}, $${b + 4})`);
        values.push(item.assetId, item.country, item.state, item.city);
    });

    const result = await client.query(
        `UPDATE public."asset_exif" AS a
         SET "country" = v.country, "state" = v.state, "city" = v.city
         FROM (VALUES ${placeholders.join(',')}) AS v(asset_id, country, state, city)
         WHERE a."assetId" = v.asset_id`,
        values,
    );
    return result.rowCount || 0;
}

async function bulkUpdateByIds(client, assetIds, address) {
    if (!assetIds.length || !address) return 0;
    const idPH = assetIds.map((_, i) => `$${i + 4}::uuid`).join(',');
    const result = await client.query(
        `UPDATE public."asset_exif"
         SET "country" = $1, "state" = $2, "city" = $3
         WHERE "assetId" IN (${idPH})`,
        [address.country, address.state, address.city, ...assetIds],
    );
    return result.rowCount || 0;
}

module.exports = { createClient, ensureCacheTable, warmUpCache, upsertCache, bulkUpdate, bulkUpdateByIds };
