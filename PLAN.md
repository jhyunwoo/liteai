# LiteAI

이 프로젝트는 여러 무료 AI API를 웹 환경에서 사용할 수 있게 하는 프로젝트야. 이 프로젝트의 최우선 목표는 매우 적은 인터넷 통신 만으로 AI 채팅 기능을 구현해서 저데이터 환경에서도 AI를 사용할 수 있게 하는거야.

## 목표
- 매우 적은 크기의 초기 로딩
- 채팅 기능을 위한 데이터 통신 최소화
- 여러 무료 AI 모델 연동 (Ollama, Cerebras, Groq, Cloudflare Workers AI 등)
- 무료 Search API 연동 (Ollama Search, SearXNG, Brave Search 등)
- MCP 연동 기능
- 개인 파일 저장 및 수정 기능 (코딩 포함)
- 개인 에이전트 기능 지원
- LLM이 생성한 마크다운 형식을 파싱해서 보여줘야 함

## 서비스 구조
### Web
- Pure HTML, CSS, JavaScript

### Back-End
- Hono.js + Bun으로 구성
- Bun Sqlite 사용하여 매우 빠른 CRUD 구현
- Bun Redis를 사용하여 빠른 데이터 접근이 필요한 곳에 사용
