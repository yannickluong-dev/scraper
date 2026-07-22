FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=8788
EXPOSE 8788
CMD ["npm", "start"]
