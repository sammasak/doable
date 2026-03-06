FROM alpine:3
RUN apk add --no-cache nodejs
WORKDIR /app
COPY build/ ./build/
COPY node_modules/ ./node_modules/
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENTRYPOINT ["node", "build"]
