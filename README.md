# 🌍 Immich 지능형 한국어 역지오코딩 워커 (Naver API + Mapping Hybrid)

[Immich](https://immich.app/)의 자체 역지오코딩(OSM)이 가진 한계(불완전한 한국어 주소, 지명 생략 등)를 해결하기 위한 **하이브리드 역지오코딩 스케줄러**입니다. 네이버 API와 통계청 공공데이터 기반의 매핑 사전을 결합하여, 해외 주소는 보존하면서 한국의 모든 영토를 가장 안전하고 정확하게 한글화합니다.



---

## ✨ 핵심 기능 및 로직 (Safety-First)

본 프로젝트는 메타데이터 오염을 방지하기 위해 확실한 근거가 있는 경우에만 업데이트를 수행하는 **2단계 검증 로직**을 따릅니다.

1. **[1순위] 네이버 역지오코딩 API:** 육지 좌표를 "시/도 + 시/군/구 + 읍/면/동" 단위로 가장 정확하게 변환합니다. **(도로명 주소가 있는 경우 건물명까지 함께 표기)**
2. **[2순위] 지명 매핑 사전 (`mapping.json`):** 네이버 API 결과가 없는 지역(바다 등)에서 기존 영문 지명을 매핑 사전에 따라 **순수 한글 지명으로 1:1 번역**합니다. (OSM의 행정구역 꼬리 자르기 대응 알고리즘 탑재)

**⚡ 지능형 성능 최적화:**
- **좌표 기반 메모리 캐싱:** 동일하거나 근접한(약 1.1m 이내) 좌표에 대해 API를 중복 호출하지 않고 메모리 캐시를 활용하여 처리 속도를 높이고 API 쿼리 비용을 줄입니다.
- **건물명 보강:** 도로명 응답에 건물명이 있으면 `city` 값에 함께 붙여 더 읽기 쉬운 위치명을 만듭니다.
- **DB 영구 캐시:** 컨테이너가 재시작되어도 캐시가 사라지지 않도록 PostgreSQL에 주소를 저장해 재활용합니다.
- **TTL(180일):** DB 캐시를 무기한 믿지 않고 180일까지만 유효하게 사용한 뒤, 오래된 데이터는 네이버 API로 다시 조회합니다.
- **안전한 실행 관리:** 작업 중복 실행 방지 플래그를 통해 스케줄러 간 충돌을 방지합니다.
- **단일 스캔 방식:** 한 번의 실행에서 DB를 한 차례만 스캔하여, 실패한 row 때문에 같은 데이터가 계속 재처리되는 문제를 줄였습니다.

**🛡️ 데이터 보호 원칙:** 확실한 번역 근거가 없거나 해외(일본 등) 좌표로 판단될 경우, **기존 메타데이터를 절대 수정하지 않고 스킵(Skip)**하여 데이터 무결성을 보장합니다.

---

## 🧠 쉽게 이해하는 캐시 구조

이 워커는 같은 장소 사진이 많을 때 네이버 API를 매번 다시 부르지 않도록 **2단계 캐시**를 사용합니다.

### 1) L1 캐시: 메모리 캐시
워커가 현재 실행 중인 동안에는, 한 번 찾은 주소를 메모리에 저장해 둡니다.
같거나 거의 같은 좌표의 사진이 다시 나오면 API를 다시 호출하지 않고 바로 재사용합니다.

- 가장 빠름
- 다만 컨테이너가 재시작되면 초기화됨

### 2) L2 캐시: DB 영구 캐시
메모리 캐시에 없으면 PostgreSQL에 저장된 캐시를 먼저 확인합니다.
이 덕분에 컨테이너를 재시작해도 예전에 찾은 주소를 다시 활용할 수 있습니다.

- 재시작 후에도 유지됨
- 오래된 주소는 TTL로 자동 재검증됨

### 3) TTL(유효기간): 180일
주소 정보는 영원히 고정된다고 보기 어렵기 때문에, DB 캐시는 **180일 동안만 유효**하게 사용합니다.

- **180일 이내 데이터** → 그대로 재사용
- **180일 지난 데이터** → 오래된 정보로 보고 네이버 API로 다시 조회

이렇게 해서 **속도는 빠르게**, **데이터는 너무 낡지 않게** 유지합니다.

### 4) 실제 조회 순서
사진 1장을 처리할 때 주소를 찾는 순서는 아래와 같습니다.

1. **메모리 캐시 확인**
2. **DB 캐시 확인 (180일 이내면 사용)**
3. **네이버 API 호출**
4. **그래도 실패하면 `mapping.json` 기반 사전 번역 시도**

네이버 API 호출에 성공하면 결과는 **메모리 캐시와 DB 캐시에 모두 저장**됩니다.

### 5) 자동 생성되는 캐시 테이블
워커가 시작되면 `custom_naver_geocode_cache` 테이블이 없을 경우 자동으로 생성합니다.

이 테이블에는 아래 정보가 저장됩니다.

- `cache_key`: 좌표 기반 캐시 키
- `state`: 시/도
- `city`: 시/군/구/동 + 필요 시 건물명
- `updated_at`: 마지막 갱신 시각

### 6) 로그에서 확인할 수 있는 것
작업이 끝나면 아래 통계를 확인할 수 있습니다.

- 총 처리 건수
- API 시도 건수
- DB 캐시 적중 수
- 메모리 캐시 적중 수
- 사전 번역(Fallback) 사용 수

즉, 실제로 얼마나 최적화가 잘 되고 있는지 로그만 봐도 확인할 수 있습니다.

---

## 🚀 설치 및 세팅 방법

### 1. 네이버 클라우드 API 키 발급 (ID/Secret)
1. [네이버 클라우드 플랫폼 콘솔](https://console.ncloud.com/) 접속 및 로그인.
2. **Services** > **AI·NAVER API** > **AI·NAVER API** 클릭.
3. **Application 등록** 버튼 클릭.
4. **Application 이름** 입력 (예: `Immich-Geocoding`) 및 **Maps** 하위의 **Reverse Geocoding** 체크.
5. **서비스 URL**에 Immich 주소 입력 (예: `http://192.168.0.10:2283`).
6. 등록 후 **인증 정보** 버튼을 클릭하여 **Client ID**와 **Client Secret**을 복사해 둡니다.

### 2. 저장소 클론 (Clone)
Immich가 설치된 메인 폴더(예: `/docker/immich/`)에서 저장소를 다운로드하고 폴더로 진입합니다.
```bash
git clone https://github.com/lscya84/immich-naver-reverse-geocoding.git
cd immich-naver-reverse-geocoding
```

### 3. 매핑 사전 데이터 준비 (`mapping.csv`)
1. [통계분류포털 행정구역분류 자료실](https://kssc.mods.go.kr:8443/ksscNew_web/kssc/common/CommonBoardList.do?gubun=1&strCategoryNameCode=019&strBbsId=kasctnr&categoryMenu=011)에 접속합니다.
2. 최신 버전의 **한국행정구역분류** `.xlsx` 파일을 다운로드합니다.
3. 엑셀 파일의 두 번째 탭인 **`2. 항목표(기준시점)`** 시트를 선택하여 **`CSV (쉼표로 분리)`** 형식으로 저장합니다.
4. 파일명을 **`mapping.csv`**로 변경하여 `immich-naver-reverse-geocoding` 폴더 안에 넣습니다.
5. 아래 명령어로 JSON 사전을 생성합니다.
```bash
node make_mapping.js
```

### 4. 환경 변수 (`.env`) 설정 추가
**Immich 메인 폴더의 `.env` 파일** 하단에 발급받은 API 키 정보를 추가합니다.
```env
# Naver Reverse Geocoding 설정
NAVER_CLIENT_ID=복사한_ID
NAVER_CLIENT_SECRET=복사한_Secret
INTERVAL_HOURS=24
STEP_DELAY_MS=100
```

### 5. docker-compose.yml 수정
Immich 메인 폴더의 `docker-compose.yml` 파일 `services:` 항목 아래에 다음 내용을 추가합니다.
```yaml
  # [추가] 네이버 역지오코딩 자동 업데이트 워커
  immich-naver-reverse-geocoding:
    container_name: immich_naver_reverse_geocoding
    # git clone으로 생성된 폴더명과 일치해야 합니다.
    build: ./immich-naver-reverse-geocoding 
    restart: always
    volumes:
      # Immich 메인 .env 파일을 컨테이너 내부로 연결합니다.
      - ./.env:/app/.env:ro
    environment:
      # 본인의 postgres 서비스 이름(보통 immich_postgres)과 일치시켜야 합니다.
      - DB_HOSTNAME=immich_postgres
    depends_on:
      - immich_postgres
```

### 6. 컨테이너 빌드 및 실행
```bash
docker compose up -d --build immich-naver-reverse-geocoding
```

---

## 🛠️ 트리거 명령어

### 1. 백그라운드 스케줄러 (기본)
설정한 `INTERVAL_HOURS` 마다 자동으로 주소를 업데이트합니다.

### 2. 수동 강제 업데이트 모드 (`--force`)
기존에 한글화가 누락된 사진이나 과거 사진들을 강제로 다시 번역하고 싶을 때 사용합니다.
```bash
docker compose exec immich-naver-reverse-geocoding node updater.js --force
```

---

## 🚑 트러블슈팅 (장애 복구)
**Q. 주소가 번역되지 않고 영문 그대로 유지됩니다.**
**A.** 네이버 API의 결과가 없거나 자체 매핑 사전(`mapping.json`)에도 해당 지명이 없는 경우입니다. 본 프로젝트는 확실하지 않은 정보를 억지로 추측하여 기록하지 않고 원본 데이터를 보호하도록 설계되었습니다.

**Q. 해외 좌표가 잘못 번역되었습니다.**
**A.** Immich 웹에서 해당 사진 선택 -> **'메타데이터 갱신(Refresh Metadata)'** 실행 -> 이후 다시 `--force` 명령어를 실행하면 방어 로직에 의해 해외 영토는 스킵되고 한국 데이터만 정상 번역됩니다.
