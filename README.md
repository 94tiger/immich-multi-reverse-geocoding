# 🌍 Immich 지능형 한국어 역지오코딩 워커 (Naver API + OSM Hybrid)

[Immich](https://immich.app/)의 자체 역지오코딩(OSM)이 가진 한계(해상 좌표 누락, 행정구역 생략 등)를 극복하기 위해 제작된 **하이브리드 역지오코딩 스케줄러**입니다. 네이버 API와 통계청 공공데이터를 결합하여 해외 주소는 보존하면서 한국의 모든 영토와 바다를 100% 한글화합니다.

---

## ✨ 핵심 기능 및 로직

사진의 GPS 좌표를 바탕으로 다음 3단계 방어 로직을 거쳐 주소를 업데이트합니다.

1. **[1순위] 네이버 역지오코딩 API:** 육지 좌표를 "시/도 + 시/군/구 + 읍/면/동" 단위로 가장 정확하게 변환합니다.
2. **[2순위] 자체 매핑 사전 (`mapping.json`):** 네이버 API가 실패하는 바다(해상) 좌표 등의 경우, 통계청 기반 3,500개 매핑 사전을 참조하여 한글로 번역합니다. (OSM의 행정구역 꼬리 자르기에 대응하는 알고리즘 탑재)
3. **[3순위] 해외 데이터 원본 보호:** 사전에 없는 좌표일 경우, 원본 메타데이터가 '대한민국(Korea)'일 때만 `대한민국 해상`으로 기입하며, 해외 영토(예: 일본 후쿠오카)는 업데이트를 건너뛰어 글로벌 메타데이터를 안전하게 보호합니다.

---

## 🚀 설치 및 세팅 방법

### 1. 저장소 클론 (Clone)
Immich가 설치된 메인 폴더(예: `/docker/immich/`)로 이동하여 저장소를 다운로드합니다.
```bash
git clone [https://github.com/lscya84/immich-naver-reverse-geocoding.git](https://github.com/lscya84/immich-naver-reverse-geocoding.git)
cd immich-naver-reverse-geocoding
```

### 2. 매핑 사전 데이터 준비 (`mapping.csv`)
1. [통계분류포털(KSSC)](https://kssc.kostat.go.kr/) 접속 -> **한국행정구역분류** 게시판에서 최신 `.xlsx` 파일 다운로드.
2. **`2. 항목표(기준시점)`** 시트를 **`CSV (쉼표로 분리)`** 형식으로 저장.
3. 파일명을 **`mapping.csv`**로 변경하여 `immich-naver-reverse-geocoding` 폴더 안에 넣습니다.
4. 아래 명령어로 JSON 사전을 생성합니다.
```bash
node make_mapping.js
```

### 3. 환경 변수 (`.env`) 설정 추가
**Immich 메인 폴더의 `.env` 파일** 하단에 아래 내용을 추가합니다.
```env
# Naver Reverse Geocoding 설정
NAVER_CLIENT_ID=본인의_클라이언트_ID
NAVER_CLIENT_SECRET=본인의_클라이언트_시크릿
INTERVAL_HOURS=24
STEP_DELAY_MS=100
```

### 4. docker-compose.yml 수정
Immich 메인 폴더의 `docker-compose.yml` 파일 `services:` 항목 아래에 다음 내용을 추가합니다.
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

### 5. 컨테이너 빌드 및 실행
```bash
docker compose up -d --build immich-naver-reverse-geocoding
```

---

## 🛠️ 트리거 명령어

### 1. 백그라운드 스케줄러 (기본)
설정한 `INTERVAL_HOURS` 마다 자동으로 주소가 누락되었거나 한글이 아닌 사진들을 업데이트합니다.

### 2. 수동 강제 업데이트 모드 (`--force`)
기존의 모든 한국 사진을 강제로 다시 번역하고 싶을 때 사용합니다.
```bash
docker compose exec immich-naver-reverse-geocoding node updater.js --force
```
> **⚠️ 주의:** 네이버 API 요금 한도에 유의하여 필요할 때만 수동으로 사용하세요.

---

## 🚑 트러블슈팅 (장애 복구)
**Q. 해외 좌표가 '대한민국 해상'으로 잘못 번역되었습니다.**
**A.** Immich 웹에서 해당 사진 선택 -> **'메타데이터 갱신(Refresh Metadata)'** 실행 -> 이후 다시 `--force` 명령어를 실행하면 방어 로직에 의해 해외 영토는 스킵되고 한국 바다만 정상 번역됩니다.
