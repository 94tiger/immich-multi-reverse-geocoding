# Immich 한국어 역지오코딩 워커

Immich 사진의 대한민국 위치 정보를 **네이버 Reverse Geocoding** 기반으로 한글 주소로 보정하는 워커입니다.

이 프로젝트는 다음에 초점을 맞춥니다.
- 한국 주소를 더 자연스럽게 한글화
- 해외 데이터는 건드리지 않고 보존
- 같은 좌표는 캐시/그룹 처리로 빠르게 반영
- 기존 설치 사용자가 쉽게 업데이트 가능

## 위치정보가 표시되는 방식

이 워커는 Immich의 위치 메타데이터 중 주로 아래 값을 보정합니다.

- `country` → `대한민국`
- `state` → 시/도
- `city` → 시/군/구/읍/면/동

예를 들면:
- `country`: `대한민국`
- `state`: `경기도`
- `city`: `성남시 분당구 정자동`

네이버 도로명 응답에 **건물명**이 있으면 `city`에 함께 붙여 더 읽기 쉽게 표시할 수 있습니다.

예:
- `city`: `성남시 분당구 정자동 (네이버 1784)`

즉, 이 프로젝트는 좌표를 단순히 영문 지명으로 남겨두지 않고,
**Immich에서 보기 쉬운 한국어 위치명 형태로 정리해 넣는 것**이 목적입니다.

## 주요 특징

- 네이버 Reverse Geocoding 사용
- `mapping.json` 보조 매핑 지원
- 메모리 + PostgreSQL 캐시 사용
- Fast Track / API Track 분리 처리
- 같은 좌표 그룹은 API 1회 호출 후 벌크 업데이트
- 캐시 TTL(180일) 적용
- 작업 중복 실행 방지

## 릴리즈

- Latest: [v1.1.0](https://github.com/lscya84/immich-naver-reverse-geocoding/releases/tag/v1.1.0)
- Initial: [v1.0.0](https://github.com/lscya84/immich-naver-reverse-geocoding/releases/tag/v1.0.0)
- Releases: [GitHub Releases](https://github.com/lscya84/immich-naver-reverse-geocoding/releases)

---

## 설치 방법

### 1) 저장소 클론
Immich를 운영 중인 **본인 작업 폴더**에서 클론합니다.

```bash
git clone https://github.com/lscya84/immich-naver-reverse-geocoding.git
cd immich-naver-reverse-geocoding
```

### 2) 네이버 API 키 준비
네이버 클라우드 플랫폼에서 **Maps / Reverse Geocoding API**를 사용할 수 있도록 애플리케이션을 만든 뒤 아래 값을 준비합니다.

- `NAVER_CLIENT_ID`
- `NAVER_CLIENT_SECRET`

진행 순서는 보통 다음과 같습니다.
- 네이버 클라우드 플랫폼 로그인
- AI·NAVER API 또는 Maps 관련 메뉴에서 애플리케이션 생성
- Reverse Geocoding 사용 설정
- 발급된 Client ID / Client Secret 확인

이 두 값이 없으면 이 워커는 네이버 주소 변환을 수행할 수 없습니다.

### 3) `.env` 설정
Immich에서 실제로 사용하는 `.env` 파일에 아래를 추가합니다.

```env
NAVER_CLIENT_ID=복사한_ID
NAVER_CLIENT_SECRET=복사한_Secret
INTERVAL_HOURS=24
STEP_DELAY_MS=100
```

### 4) `mapping.json` 준비
행정구역 매핑이 필요하면 `mapping.csv`를 준비한 뒤 아래를 실행합니다.

```bash
node make_mapping.js
```

### 5) `docker-compose.yml`에 서비스 추가
Immich의 `docker-compose.yml`에 아래 서비스를 추가합니다.

```yaml
immich-naver-reverse-geocoding:
  container_name: immich_naver_reverse_geocoding
  build: ./immich-naver-reverse-geocoding
  restart: always
  volumes:
    - ./.env:/app/.env:ro
  environment:
    - DB_HOSTNAME=immich_postgres
  depends_on:
    - immich_postgres
```

### 6) 빌드 및 실행
Immich 작업 폴더에서 실행합니다.

```bash
docker compose up -d --build immich-naver-reverse-geocoding
```

---

## 업데이트 방법

이미 설치한 사용자는 보통 아래 순서면 충분합니다.

### 최신판으로 업데이트
```bash
cd <immich 작업 폴더>/immich-naver-reverse-geocoding
git pull origin main
cd <immich 작업 폴더>
docker compose up -d --build immich-naver-reverse-geocoding
```

### 특정 릴리즈 버전으로 고정
```bash
cd <immich 작업 폴더>/immich-naver-reverse-geocoding
git fetch --tags
git checkout v1.1.0
cd <immich 작업 폴더>
docker compose up -d --build immich-naver-reverse-geocoding
```

### 다시 `main` 브랜치로 복귀
```bash
cd <immich 작업 폴더>/immich-naver-reverse-geocoding
git checkout main
git pull origin main
```

---

## 실행 / 사용

### 백그라운드 스케줄러
`INTERVAL_HOURS` 주기로 자동 실행됩니다.

### 수동 강제 실행
기존 사진까지 다시 처리하려면:

```bash
docker compose exec immich-naver-reverse-geocoding node updater.js --force
```

### 로그 확인
```bash
docker compose logs -f --tail=100 immich-naver-reverse-geocoding
```

---

## 업데이트 시 참고

- `.env`의 네이버 API 키는 그대로 사용됩니다.
- PostgreSQL의 `custom_naver_geocode_cache` 캐시는 유지됩니다.
- 특정 태그(`v1.1.0` 등)로 checkout 한 경우, 이후 최신판으로 가려면 `main` 브랜치로 다시 전환해야 합니다.
- 코드 변경 후에는 `docker compose up -d --build ...`로 재빌드해야 반영됩니다.

---

## 트러블슈팅

### 주소가 번역되지 않음
- 네이버 API 결과가 없거나
- `mapping.json`에도 매핑이 없는 경우입니다.

이 프로젝트는 확실하지 않은 정보를 억지로 넣지 않도록 설계되어 있습니다.

### 해외 좌표가 잘못 보임
Immich에서 해당 사진의 **메타데이터 갱신(Refresh Metadata)** 후 다시 `--force` 실행을 권장합니다.

---

## 요약

이 프로젝트는 **한국 주소를 안전하게 한글화**하면서도,
**기존 설치 사용자가 쉽게 업데이트할 수 있게 만든 Immich용 역지오코딩 워커**입니다.
