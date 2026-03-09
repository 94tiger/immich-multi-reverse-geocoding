# 📍 Immich Naver Reverse Geocoding Worker

Immich의 사진 위치 정보(위도/경도)를 **NAVER Maps API**를 사용하여 정확한 한국 표준 주소로 자동 변환해주는 백그라운드 워커입니다.

## 🌟 왜 이 프로젝트가 필요한가요?
Immich의 기본 역지오코딩(OSM)은 한국 지명이 영어로 표시되거나 어색한 경우가 많습니다. 본 프로젝트는 네이버의 정확한 지적 데이터를 활용하여 '시/군/구/동' 단위의 깔끔한 한글 주소를 제공합니다.

## ✨ 주요 특징
- **국내 좌표 필터링 (Geofencing)**: 대한민국 영토(Lat 33-43, Lon 124-132) 내의 사진만 골라내어 처리합니다. 해외 여행 사진은 건드리지 않아 안전하고 효율적입니다.
- **압도적인 처리량**: 월 3,000,000회의 넉넉한 네이버 API 무료 쿼터를 활용합니다.
- **지능형 스캔**: 이미 한글 주소가 있거나 해외 좌표인 사진은 건너뛰어 API 호출을 최적화합니다.
- **실전 검증 완료**: **15만 장 이상의 대규모 라이브러리**에서 안정적인 동작을 확인했습니다.
- **심리스한 통합**: 기존 Immich 환경에 컨테이너 하나만 추가하여 즉시 적용 가능합니다.

## 🚀 설치 방법

기존 Immich가 설치된 폴더(docker-compose.yml이 있는 곳)에서 진행하세요.

### 1. 환경 변수 설정 (`.env`)
기존 `.env` 파일 하단에 아래 내용을 추가합니다.

```env
# NAVER Cloud Platform ([https://www.ncloud.com/](https://www.ncloud.com/))
NAVER_CLIENT_ID=여러분의_ID
NAVER_CLIENT_SECRET=여러분의_SECRET

# 워커 동작 설정 (선택 사항)
INTERVAL_HOURS=24    # 업데이트 실행 주기 (시간)
STEP_DELAY_MS=100    # 사진당 지연 시간 (밀리초)

### 2. 서비스 추가 (docker-compose.yml)
services: 항목 아래에 워커 서비스를 추가합니다.

YAML
  naver-reverse-geocoding:
    build: ./naver-reverse-geocoding
    container_name: naver_reverse_geocoding
    restart: always
    volumes:
      - ./.env:/app/.env:ro
    environment:
      - DB_HOSTNAME=immich_postgres  # Immich DB 서비스 이름에 맞게 수정
    depends_on:
      - immich-postgres              # DB 서비스 이름에 맞게 수정
### 3. 파일 배치 및 실행
naver-reverse-geocoding 폴더를 생성하고 그 안에 updater.js와 Dockerfile을 넣습니다.

아래 명령어로 서비스를 시작합니다.

Bash
docker compose up -d --build naver-reverse-geocoding
🔍 자주 묻는 질문 (FAQ)
Q. 해외 사진 주소가 지워지면 어떡하나요?
A. SQL 쿼리 단계에서 한국 좌표 범위 밖의 데이터는 아예 가져오지 않으므로 해외 데이터는 안전하게 보존됩니다.

Q. 진행 상황 확인 방법?
A. docker logs -f naver_reverse_geocoding 명령어를 통해 실시간 로그(1,000장 단위 진행률)를 확인할 수 있습니다.

Developed with focus on accuracy and reliability for Korean Immich users.
