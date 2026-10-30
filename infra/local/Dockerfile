FROM node:22.17.0-bookworm-slim
WORKDIR /workspace
COPY . .
RUN npm ci
RUN npm run build:packages
ENV NEXT_TELEMETRY_DISABLED=1
CMD ["npm", "run", "dev"]
