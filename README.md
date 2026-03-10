# 🌍 Immich 지능형 한국어 역지오코딩 워커 (Naver API + Mapping Hybrid)

[Immich](https://immich.app/)의 자체 역지오코딩(OSM)이 가진 한계(불완전한 한국어 주소, 지명 생략 등)를 해결하기 위한 **하이브리드 역지오코딩 스케줄러**입니다. 네이버 API와 통계청 공공데이터 기반의 매핑 사전을 결합하여, 해외 주소는 보존하면서 한국의 모든 영토를 가장 안전하고 정확하게 한글화합니다.



---

## ✨ 핵심 기능 및 로직 (Safety-First)

본 프로젝트는 메타데이터 오염을 방지하기 위해 확실한 근거가 있는 경우에만 업데이트를 수행하는 **2단계 검증 로직**을 따릅니다.

1. **[1순위] 네이버 역지오코딩 API:** 육지 좌표를 "시/도 + 시/군/구 + 읍/면/동" 단위로 가장 정확하게 변환합니다.
2. **[2순위] 지명 매핑 사전 (`mapping.json`):** 네이버 API 결과가 없는 지역(바다 등)에서 기존 영문 지명을 매핑 사전에 따라 **순수 한글 지명으로 1:1 번역**합니다. (OSM의 행정구역 꼬리 자르기 대응 알고리즘 탑재)

**🛡️ 데이터 보호 원칙:** 확실한 번역 근거가 없거나 해외(일본 등) 좌표로 판단될 경우, **기존 메타데이터를 절대 수정하지 않고 스킵(Skip)**하여 데이터 무결성을 보장합니다. '대한민국 해상' 등 추측성 명칭을 강제로 부여하지 않습니다.

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
git clone [https://github.com/lscya84/immich-naver-reverse-geocoding.git](https://github.com/lscya84/immich-naver-reverse-geocoding.git)
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
