# Immich Multi Reverse Geocoding

[![Docker Hub](https://img.shields.io/docker/pulls/94tiger/immich-multi-reverse-geocoding?logo=docker&label=Docker+Hub&color=0db7ed)](https://hub.docker.com/r/94tiger/immich-multi-reverse-geocoding)
[![Docker Image Size](https://img.shields.io/docker/image-size/94tiger/immich-multi-reverse-geocoding/latest?logo=docker&color=0db7ed)](https://hub.docker.com/r/94tiger/immich-multi-reverse-geocoding)
[![GitHub Release](https://img.shields.io/github/v/release/lscya84/immich-naver-reverse-geocoding?logo=github&color=4f46e5)](https://github.com/lscya84/immich-naver-reverse-geocoding/releases)

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
    logging:
      options:
        max-size: "10m"
        max-file: "3"

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
| `GOOGLE_LANGUAGE` | `ko` | Google API 응답 언어 코드 (예: `en`, `ja`, `zh-CN`) |
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

웹 브라우저에서 `http://서버IP:3000` 으로 접속합니다.

---

### 상태 카드

상단에 3개의 카드로 현재 상태를 표시합니다.

- **마지막 실행**: 마지막으로 작업이 완료된 시각과 소요 시간
- **스케줄**: 현재 등록된 cron 표현식
- **제공자**: 한국/세계 역지오코딩에 사용 중인 API

---

### 실행

<!-- 스크린샷: 실행 버튼 영역 -->

**범위 선택**

| 옵션 | 설명 |
|------|------|
| 전체 | 한국 + 세계 모두 처리 |
| 한국만 | 한국 좌표 범위 사진만 처리 |
| 세계만 | 한국 외 지역 사진만 처리 |

**처리 모드 선택**

| 모드 | 조건 | 사용 시나리오 |
|------|------|--------------|
| 미입력만 | city 또는 state가 NULL | 아직 한 번도 처리되지 않은 사진 |
| 미번역 포함 | 한국어가 아닌 것 (NULL + 영문 포함) | 영문으로 저장된 해외 사진을 한국어로 바꾸고 싶을 때 |
| 전체 재처리 | 조건 없음, 전부 재호출 | 제공자 변경 후 재적용, 건물명 설정 변경 후 재적용 |

**▶ 실행**

선택한 범위 + 모드 조합으로 역지오코딩을 시작합니다.

---

### 마지막 실행 결과

작업 완료 후 처리 건수 통계를 카드로 표시합니다.

- 캐시 워밍업 / Fast Track / API Track / 세계 처리 건수
- 실제 API 호출 횟수, 메모리 캐시 재사용 횟수

---

### 연결 상태

<!-- 스크린샷: 연결 상태 섹션 -->

컨테이너 시작 시 1회 헬스체크를 실행하고 결과를 표시합니다.

| 항목 | 표시 내용 |
|------|-----------|
| DB | Immich PostgreSQL 연결 여부 |
| Naver | API 키 설정 여부 및 실제 응답 확인 |
| Google | API 키 설정 여부 및 실제 응답 확인 |

연결 상태를 다시 확인하려면 컨테이너를 재시작하세요.

---

### 설정

<!-- 스크린샷: 설정 섹션 -->

**스케줄 (Cron)**

cron 표현식으로 자동 실행 주기를 설정합니다. 저장 즉시 반영되며 컨테이너 재시작 후에도 유지됩니다.

| 프리셋 | 표현식 |
|--------|--------|
| 매일 새벽 2시 | `0 2 * * *` |
| 6시간마다 | `0 */6 * * *` |
| 매 시간 | `0 * * * *` |

**지오코딩 제공자**

| 항목 | 옵션 |
|------|------|
| 한국 | Naver Maps / Google Maps / 비활성화 |
| 세계 | Google Maps / 비활성화 |

설정 변경 후 **저장** 버튼을 눌러야 반영됩니다.

**Google API 응답 언어**

Google Maps API가 주소를 반환할 언어를 선택합니다. 해당 언어 데이터가 없는 지역은 현지어로 반환될 수 있습니다.

| 코드 | 언어 |
|------|------|
| `ko` | 한국어 (기본값) |
| `en` | English |
| `ja` | 日本語 |
| `zh-CN` | 简体中文 |
| `zh-TW` | 繁體中文 |
| `fr` / `de` / `es` | 유럽 언어 |

**건물명 포함**

`city` 필드에 건물명을 포함할지 선택합니다.

- 켬: `성남시 분당구 정자동 (네이버 1784)`
- 끔: `성남시 분당구 정자동` (기본값)

> Immich 장소 탐색에서 건물명이 별도 항목으로 나타날 수 있어 기본값은 끔입니다.

---

### 대상 필터

<!-- 스크린샷: 대상 필터 섹션 -->

특정 Immich 계정이나 경로만 처리할 수 있습니다. 필터 미설정 시 전체 대상입니다.

**사용자 필터**

"목록 불러오기"를 눌러 Immich에 등록된 사용자를 조회한 뒤 체크박스로 선택합니다. 선택한 사용자의 사진만 처리됩니다.

**경로 필터**

`originalPath` 기준으로 처리할 경로를 지정합니다. 여러 경로를 추가하면 OR 조건으로 처리됩니다.

예) `/mnt/nas/photos/여행/` 을 추가하면 해당 경로 하위 사진만 처리

필터 설정 후 **필터 저장**을 눌러야 반영되며, **필터 초기화**로 전체 대상으로 되돌릴 수 있습니다.

---

### 실시간 로그

작업 진행 상황을 실시간으로 확인할 수 있습니다. 최대 1000줄이 유지되며 **지우기**로 초기화할 수 있습니다.

---

## 국가별 주소 처리 방식

### 한국 (Naver API)

| Immich 필드 | 내용 | 예시 |
|-------------|------|------|
| `country` | 대한민국 고정 | 대한민국 |
| `state` | 시/도 | 경기도, 부산광역시 |
| `city` | 시/군/구/읍/면/동 | 성남시 분당구 정자동 |

> **광역시/특별시** (부산, 서울 등)는 `state`에 시 단위가 들어가므로 `city`는 구 단위부터 시작합니다.
> 예: state=`부산광역시` / city=`해운대구 좌동`

### 해외 (Google Maps API)

Google API는 `GOOGLE_LANGUAGE` 설정(기본 `ko`)으로 요청합니다. 해당 언어 데이터가 없는 지역은 현지어나 영어로 반환될 수 있습니다.

| 국가 | state | city |
|------|-------|------|
| 일본 | 都/道/府/県 | 市 + 区/町 + 丁目 |
| 중국 | 省/直辖市 | 区/街道 (직할시는 state 중복 자동 제거) |
| 대만 | 縣/市 | 區 + 里 |
| 미국 | 주 (State) | 도시명 |
| 기타 | 광역 행정구역 | 시/구 단위 |

> 국가마다 행정 구역 체계가 달라 하위 단위 깊이가 다를 수 있습니다.

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
