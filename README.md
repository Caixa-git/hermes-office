# Hermes Office 🏢

**Isometric Kanban Office Viewer** — Hermes Agent 작업 현황을 아이소메트릭 오피스 형태로 시각화합니다.

## 실행

```bash
bash run.sh
```

브라우저에서 [http://localhost:8765](http://localhost:8765) 접속.

## 구조

```
hermes-office/
├── run.sh                  # 실행 스크립트
├── backend/
│   ├── main.py             # FastAPI 서버 + WebSocket
│   └── requirements.txt
└── frontend/
    ├── index.html          # 메인 페이지
    ├── style.css           # 아이소메트릭 CSS
    └── app.js              # WebSocket 클라이언트 + 렌더링
```

## 기능

- **아이소메트릭 오피스** — 각 태스크가 책상으로 표현됨
- **상태별 색상**: done(초록), in_progress(노랑), ready(보라), failed(빨강)
- **실시간 업데이트** — WebSocket으로 5초 간격 상태 반영
- **Activity Feed** — 최근 로그 표시
- **줌/팬** — +/-/0 키 또는 버튼으로 확대/축소
- **클릭 상세** — 태스크 클릭 시 상세 정보 오버레이

## WebSocket

ngrok(HTTPS) 환경과 로컬(HTTP) 환경 모두에서 동작:
```javascript
// app.js — 자동 출처 감지
const WS_PROTO = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTO}//${location.host}/ws`;
```

## 의존성

- Python 3.9+
- fastapi, uvicorn, websockets
- `hermes kanban list` CLI (Hermes Agent)

## Git Flow

```
main       → production-ready
develop    → integration
feature/*  → features
fix/*      → bug fixes
```

## 라이선스

MIT
