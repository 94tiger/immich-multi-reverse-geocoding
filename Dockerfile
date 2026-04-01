FROM node:20-alpine

WORKDIR /app

# 런타임 설정 저장용 디렉터리
RUN mkdir -p /data

# 의존성 설치
COPY package.json ./
RUN npm install --production

# 앱 복사
COPY . .

# 웹 UI 포트
EXPOSE 3000

CMD ["node", "src/index.js"]
