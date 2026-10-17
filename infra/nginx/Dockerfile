FROM node:24-alpine AS build
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/index.html web/tsconfig.json web/vite.config.ts ./
COPY web/src ./src
COPY web/public ./public
ARG VITE_FEATURE_SOURCE=api
ENV VITE_FEATURE_SOURCE=${VITE_FEATURE_SOURCE}
RUN npm run build

FROM nginx:1.28-alpine
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/conf.d/campus-http.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/web/dist /usr/share/nginx/html
EXPOSE 80
