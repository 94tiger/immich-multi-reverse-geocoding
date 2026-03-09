# Immich Naver Reverse Geocoding Worker

Immich의 사진 위치 정보(위도/경도)를 네이버 지도 API를 사용하여 한글 주소로 자동 변환해주는 도커 서비스입니다.

## ✨ 주요 기능
- **정확한 한글 지명**: OpenStreetMap 기반의 부정확한 한글 지명을 네이버 API 기반의 표준 지명으로 교체합니다.
- **자동 스케줄링**: 설정한 주기(기본 24시간)마다 새로운 사진을 감지하여 업데이트합니다.

## 🚀 시작하기

### 1. 네이버 API 키 발급
- [Naver Cloud Platform](https://www.ncloud.com/)에서 'Maps' 서비스를 신청하고 `Client ID`와 `Client Secret`을 발급받으세요.

### 2. Docker Compose 설정
`docker-compose.yml` 파일에 아래 서비스를 추가합니다.

```yaml
  naver-geocoding:
    image: node:18-alpine
    container_name: naver_geocoding
    working_dir: /app
    volumes:
      - ./naver-reverse-geocoding:/app
      - ./.env:/app/.env:ro
    command: sh -c "npm init -y && npm install pg dotenv && node updater.js"
    restart: always
    depends_on:
      - immich-postgres
