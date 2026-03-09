<<<<<<< HEAD
FROM node:18-alpine
WORKDIR /app
RUN npm init -y && npm install pg dotenv
COPY updater.js .
CMD ["node", "updater.js"]

=======
# 1. 가벼운 Node.js Alpine 이미지 사용
FROM node:18-alpine

# 2. 작업 디렉토리 설정
WORKDIR /app

# 3. 패키지 파일 복사 및 설치 (캐싱 활용)
COPY package*.json ./
RUN npm install --production

# 4. 소스 코드 복사
COPY updater.js ./

# 5. 실행 환경 설정
# 도커 환경에서 로그가 즉시 출력되도록 설정
ENV NODE_ENV=production

# 6. 실행 명령
CMD ["node", "updater.js"]
>>>>>>> 7331ebf1ce1c3c052116dde29bddbdca02d3ff29
