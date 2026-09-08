# Cloudflare 배포

사이트와 API를 같은 Cloudflare Worker에서 제공하고, 공유 데이터는 D1의 `shared_bosses` 테이블에 저장한다.

현재 설정된 D1: `union-db`

처음 한 번:
```sh
npm install
npx wrangler login
npm run db:remote
```

배포:
```sh
npm run deploy:cloudflare
```

로컬 테스트:
```sh
npm run db:local
npm run dev:cloudflare
```

Cloudflare 주소에서는 정적 페이지와 `/api/shared-bosses`가 같은 origin으로 동작한다.
