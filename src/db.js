'use strict';
const { Client } = require('pg');
const config = require('./config');

function createClient() {
    return new Client({
        ...config.db,
        options: '-c search_path=public',
    });
}

async function ensureCacheTable(client) {
    // 전용 스키마 생성
    await client.query(`CREATE SCHEMA IF NOT EXISTS geocoding`);

    await client.query(`
        CREATE TABLE IF NOT EXISTS geocoding.geocode_cache (
            cache_key  VARCHAR PRIMARY KEY,
            country    VARCHAR,
            state      VARCHAR,
            city       VARCHAR,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

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
        `SELECT cache_key, country, state, city
         FROM geocoding.geocode_cache
         WHERE updated_at >= CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')`,
        [ttlDays],
    );
    for (const row of res.rows) {
        memCache.set(row.cache_key, { country: row.country, state: row.state, city: row.city });
    }
    return res.rows.length;
}

async function upsertCache(client, cacheKey, address) {
    await client.query(
        `INSERT INTO geocoding.geocode_cache (cache_key, country, state, city, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (cache_key) DO UPDATE
         SET country = EXCLUDED.country,
             state = EXCLUDED.state,
             city = EXCLUDED.city,
             updated_at = CURRENT_TIMESTAMP`,
        [cacheKey, address.country, address.state, address.city],
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
