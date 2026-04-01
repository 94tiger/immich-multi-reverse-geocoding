# Immich Multi Reverse Geocoding

Immich 사진의 위치 정보를 한국어 주소로 보정하는 사이드카 워커입니다.

- **한국 사진**: 네이버 Reverse Geocoding으로 읍/면/동 단위 한글 주소 보정
- **해외 사진**: Google Maps Geocoding으로 한국어 표기 변환 (선택)
- **웹 관리 UI**: 대시보드, 수동 실행, 실시간 로그, 설정 변경

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 한국 역지오코딩 | 네이버 API 기반, 시/군/구/읍/면/동 단위 |
| 해외 역지오코딩 | Google Maps API 기반 (비활성화가 기본값) |
| 멀티 제공자 | 한국/해외 제공자 각각 독립 설정 |
| 캐시 | 인메모리 + PostgreSQL 2단계 캐시 (TTL 180일) |
| Fast Track | 캐시 적중 좌표는 API 호출 없이 고속 처리 |
| 웹 UI | 실시간 상태, 로그, cron 설정, 필터 등 |
| 대상 필터 | Immich 계정별 또는 경로별로 처리 범위 지정 |
| 건물명 포함 옵션 | city 필드에 건물명 추가 여부 선택 |
| 자동 마이그레이션 | 이전 버전 캐시 테이블 자동 이전 |

---

## 위치 정보 보정 결과

Immich `asset_exif` 테이블의 아래 필드를 보정합니다.

| 필드 | 보정 결과 예시 |
|------|----------------|
| `country` | `대한민국` |
| `state` | `경기도` |
| `city` | `성남시 분당구 정자동` |

건물명 포함 옵션을 켜면:
- `city`: `성남시 분당구 정자동 (네이버 1784)`

---

## 빠른 시작

### 1. 네이버 API 키 발급

한국 사진을 처리하려면 필수입니다.

1. [네이버 클라우드 플랫폼](https://console.ncloud.com/) 로그인
2. **AI·NAVER API > Maps > Reverse Geocoding** 사용 설정
3. `Client ID` / `Client Secret` 확인

### 2. `.env` 작성

`.env.example`을 복사해 작성합니다.

```bash
cp .env.example .env
```

최소 필수 항목:

```env
DB_PASSWORD=immich_db_비밀번호

NAVER_CLIENT_ID=발급받은_ID
NAVER_CLIENT_SECRET=발급받은_Secret
```

### 3. `docker-compose.yml`

```yaml
services:
  immich-reverse-geocoding:
    image: 94tiger/immich-multi-reverse-geocoding:latest
    container_name: immich_reverse_geocoding
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - geocoding-data:/data
    networks:
      - immich_default

volumes:
  geocoding-data:

networks:
  immich_default:
    external: true
    name: immich_default   # docker network ls 로 이름 확인 후 변경
```

> Immich와 같은 `docker-compose.yml`에 합칠 경우 `networks` 섹션은 제거하고 기존 네트워크를 그대로 사용하세요.

### 4. 실행

```bash
docker compose up -d
```

웹 UI: `http://서버IP:3000`

---

## 환경 변수 전체 목록

### 필수

| 변수 | 설명 |
|------|------|
| `DB_PASSWORD` | Immich PostgreSQL 비밀번호 |
| `NAVER_CLIENT_ID` | 네이버 API Client ID |
| `NAVER_CLIENT_SECRET` | 네이버 API Client Secret |

### DB 연결

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DB_HOSTNAME` | `immich_postgres` | PostgreSQL 호스트 |
| `DB_USERNAME` | `postgres` | DB 사용자 |
| `DB_DATABASE_NAME` | `immich` | DB 이름 |

### 지오코딩 제공자

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `GEOCODING_KOREA` | `naver` | 한국: `naver` / `google` / `disabled` |
| `GEOCODING_WORLD` | `disabled` | 해외: `google` / `disabled` |
| `GOOGLE_API_KEY` | (없음) | `GEOCODING_WORLD=google` 시 필요 |
| `INCLUDE_BUILDING_NAME` | `false` | city에 건물명 포함 여부 |

### 스케줄

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `CRON_SCHEDULE` | `0 2 * * *` | cron 표현식 (매일 새벽 2시) |
| `RUN_ON_STARTUP` | `false` | 컨테이너 시작 시 즉시 실행 여부 |

### 웹 UI

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `WEB_PORT` | `3000` | 웹 UI 포트 |
| `WEB_PASSWORD` | (없음) | Bearer 토큰 인증 (비워두면 인증 없음) |

### 성능 / 캐시

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `STEP_DELAY_MS` | `100` | API 호출 간격 (ms) |
| `CACHE_TTL_DAYS` | `180` | 캐시 유효 기간 (일) |
| `NAVER_API_TIMEOUT_MS` | `10000` | 네이버 API 타임아웃 (ms) |
| `GOOGLE_API_TIMEOUT_MS` | `10000` | Google API 타임아웃 (ms) |

### 대상 필터 (환경 변수로 초기 설정)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `FILTER_USER_IDS` | (없음) | Immich 사용자 ID 쉼표 구분 (비워두면 전체) |
| `FILTER_PATH_PREFIX` | (없음) | 처리할 경로 prefix 쉼표 구분 (비워두면 전체) |

> 필터는 웹 UI에서도 설정 가능하며, UI 설정이 환경 변수보다 우선합니다.

---

## 웹 UI 사용법

| 기능 | 위치 |
|------|------|
| 작업 상태 / 마지막 실행 | 상단 카드 |
| 수동 실행 / 강제 재처리 | 실행 버튼 |
| 실시간 로그 | 하단 로그 패널 |
| cron 스케줄 변경 | 설정 > 스케줄 |
| 제공자 변경 | 설정 > 지오코딩 제공자 |
| 건물명 포함 토글 | 설정 > 건물명 포함 |
| API / DB 연결 상태 | 연결 상태 섹션 |
| 사용자/경로 필터 | 대상 필터 섹션 |

### 대상 필터

특정 Immich 계정이나 경로만 처리할 수 있습니다.

- **사용자 필터**: "목록 불러오기"로 Immich 사용자 조회 후 체크
- **경로 필터**: `/mnt/photos/여행/` 형태로 여러 경로 추가 가능 (OR 조건)
- 필터 미설정 시 전체 대상

---

## mapping.json

네이버 API 응답이 없을 때 영문 지명을 한글로 변환하는 보조 사전입니다.

```bash
node make_mapping.js
```

> 저장소에 `mapping.csv`가 기본 포함되어 있어 별도 파일 없이 바로 생성 가능합니다.  
> `mapping.csv`가 CP949/EUC-KR 인코딩인 경우 UTF-8로 변환 후 재생성하세요.

---

## 업데이트

```bash
docker compose pull immich-reverse-geocoding
docker compose up -d immich-reverse-geocoding
```

> 컨테이너 시작 시 캐시 테이블 마이그레이션이 자동 실행됩니다.

---

## 캐시 테이블

이 워커는 Immich DB 내 별도 스키마를 사용합니다.

- 스키마: `geocoding`
- 테이블: `geocoding.geocode_cache`

Immich의 `public` 스키마와 분리되어 있어 Immich 업데이트에 영향받지 않습니다.

---

## 트러블슈팅

### 주소가 변환되지 않음
- 네이버 API 키가 올바른지 확인
- 웹 UI > 연결 상태에서 API 응답 확인
- `mapping.json`에 매핑이 없는 경우 정상 (미확인 지명은 건드리지 않음)

### 해외 좌표가 영문으로 남아있음
- `GEOCODING_WORLD=google` 및 `GOOGLE_API_KEY` 설정 필요
- 또는 웹 UI > 설정 > 세계 제공자를 Google로 변경

### 사용자 목록이 로드되지 않음
- DB 연결 상태를 먼저 확인
- 컨테이너 로그에서 오류 메시지 확인: `docker compose logs immich-reverse-geocoding`

---

## 릴리즈

- [GitHub Releases](https://github.com/lscya84/immich-naver-reverse-geocoding/releases)
- Docker Hub: [`94tiger/immich-multi-reverse-geocoding:latest`](https://hub.docker.com/r/94tiger/immich-multi-reverse-geocoding)
