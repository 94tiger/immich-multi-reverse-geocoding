# 1. 가볍고 안정적인 Node.js 18 알프레인 버전을 기반으로 합니다.
FROM node:18-alpine

# 2. 컨테이너 내 작업 디렉토리를 /app으로 설정합니다.
WORKDIR /app

# 3. 별도의 package.json 파일 없이도 실행 시 필요한 라이브러리(pg, dotenv)를 설치합니다.
RUN npm init -y && npm install pg dotenv

# 4. 작성한 소스코드(updater.js)를 컨테이너 내부로 복사합니다.
COPY updater.js ./

# 5. 노드 실행 명령어를 입력합니다.
CMD ["node", "updater.js"]
