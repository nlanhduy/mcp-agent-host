# Kịch bản demo chi tiết — 22127086

Tài liệu này là **kịch bản quay video đầy đủ**: mỗi bước ghi rõ *thao tác gì*, *phục vụ yêu cầu
nào của đề bài*, *cơ chế bên dưới vận hành ra sao*, và *đoạn code nào cần mở ra giải thích*.

**Thời lượng:** 10–12 phút.

## Bản đồ cảnh → rubric

| Cảnh | Phút | Yêu cầu đề bài | Trọng số |
|---|---|---|---|
| Mở đầu | 1' | Trình bày kiến trúc tổng thể | — |
| 1 — Stdio server | 2.5' | 3 tool + 1 resource + 1 prompt + `isError` | **20%** |
| 2 — Local HTTP | 1' | Local HTTP server pass Inspector | trong 25% |
| 3 — Public HTTP | 2' | Deploy public + API key + Inspector | **15%** |
| 4 — Agent Host | 2' | Ollama + config parser + tool merging + dispatcher | **25%** |
| 5 — Skill | 3' | Skill index + `use_skill` + SKILL.md + natural language | **15%** |
| 6 — Dual host | 1' | Chạy được trên host MCP thứ hai | trong 25% |

> **Trước khi quay, phải hoàn tất PHẦN 0 — SETUP bên dưới.** Phần đó giải thích từng thứ cần
> cài, vì sao cần, và cách kiểm chứng nó đã đúng.

---
---

# PHẦN 0 — SETUP (làm một lần, không quay)

Mục tiêu của phần này: đảm bảo **mọi thứ chạy ổn định** trước khi bấm ghi hình. Mỗi bước đều
ghi rõ *vì sao cần* và *cách kiểm chứng đã đúng*.

## Bảng tổng quan: cần những gì

| Thành phần | Bắt buộc? | Vì sao cần | Trạng thái máy anh |
|---|---|---|---|
| Node.js 20+ | ✅ Bắt buộc | Chạy toàn bộ code TypeScript đã build | Có (v22.23.1 qua nvm) |
| Ollama + model | ✅ Bắt buộc | LLM engine của Agent Host — Part 1 | Có (`qwen3:4b`) |
| Git | ✅ Bắt buộc | Server stdio gọi `git` thật; và cần repo để nộp | Có (2.50.1) |
| MCP Inspector | ✅ Bắt buộc | Đề yêu cầu chứng minh qua Inspector | Chạy qua `npx`, không cần cài |
| File `.env` | ✅ Bắt buộc | Chứa API key cho server public | Đã có |
| Nơi deploy public | ✅ Bắt buộc | Part 2.3 — 15% điểm | **Đã deploy lên Render** |
| Tài khoản GitHub | ✅ Bắt buộc | Nộp source code + để Render build | **Đã dùng để triển khai** |
| Docker | ⬜ Tuỳ chọn | Chỉ để test image dưới máy trước khi deploy | Có |
| Host MCP thứ hai | ⬜ Tuỳ chọn | Part 4 — nếu bỏ thì mất một phần của 25% | Đang dùng |

---

## Bước 0.1 — Node.js

### Vì sao cần
Toàn bộ project viết bằng TypeScript, biên dịch ra JavaScript và chạy trên Node. Cần **Node 20
trở lên** vì hai lý do cụ thể:

1. **`--env-file-if-exists`** — cờ này (Node 20.6+) là cách các script tự đọc `.env` mà không
   cần thư viện `dotenv` và không cần `export` thủ công.
2. **MCP SDK** dùng các API Web Streams chỉ ổn định từ Node 18 trở lên.

### Cách làm
Máy anh cài Node qua **nvm**, nghĩa là `node` **không có sẵn trong PATH** khi mở terminal mới.
Mỗi terminal đều phải chạy:

```bash
source ~/.nvm/nvm.sh && nvm use 22
```

### Kiểm chứng
```bash
node -v      # phải ra v22.x hoặc v20.x
npm -v
```

> ⚠️ Đây là lỗi hay gặp nhất: mở terminal mới, quên `source`, rồi báo `node: command not found`.
> File [.nvmrc](.nvmrc) đã ghi sẵn `22`, nên `nvm use` không tham số cũng được.

---

## Bước 0.2 — Ollama và model

### Vì sao cần
Đề bài Part 1 yêu cầu rõ:
> *Model: `qwen3.5:4b` (or equivalent lightweight model) hosted via **Ollama***
> *Base URL: `http://localhost:11434/v1` (OpenAI-compatible REST API endpoint)*

Agent Host không tự chạy được nếu không có LLM. Nó gọi `preflight()` ngay khi khởi động và
**thoát luôn** nếu Ollama không phản hồi.

### Vì sao là `qwen3:4b` chứ không phải `qwen3.5:4b`
Tag `qwen3.5:4b` **không tồn tại** trên thư viện Ollama — có thể là nhầm lẫn trong đề. Đề cho
phép *"or equivalent lightweight model"*, nên em dùng `qwen3:4b`.

Tên model cấu hình được ở ba nơi, ưu tiên từ cao xuống thấp:
1. Biến môi trường `OLLAMA_MODEL`
2. Trường `llm.model` trong [mcp_config.json](mcp_config.json)
3. Giá trị mặc định trong code

Nghĩa là đổi model **không cần sửa code**.

### Cách làm
```bash
ollama serve          # nếu chưa chạy (macOS thường tự chạy nền)
ollama pull qwen3:4b
```

### Kiểm chứng
```bash
curl -s localhost:11434/api/tags | head -5    # Ollama sống
ollama list | grep qwen                        # model đã có
```

Kiểm tra sâu hơn — đúng endpoint mà Host dùng:
```bash
curl -s localhost:11434/v1/models | head -5
```

> Chú ý đường dẫn `/v1/` — đây là lớp tương thích OpenAI của Ollama. Host dùng thư viện `openai`
> trỏ vào endpoint này, nên không cần viết client riêng cho Ollama.

### Cân nhắc về tốc độ — nên quyết định ngay bây giờ

`qwen3:4b` là **reasoning model**: nó sinh chain-of-thought trước khi trả lời. Trên máy anh,
mỗi vòng gọi tool mất **khoảng 1 phút**, và skill có 5 vòng → **8–10 phút**.

Ba lựa chọn, chọn trước khi quay:

| Cách | Ưu | Nhược |
|---|---|---|
| Giữ `qwen3:4b`, cắt video | Trung thực nhất, đúng tinh thần đề | Phải dựng video |
| `ollama pull qwen2.5:7b` | Không chain-of-thought, nhanh hơn hẳn, tool-calling tốt | Phải nói rõ đã thay model |
| Tách demo | Quay trực tiếp phần nhanh, phần chậm dùng footage | Video kém liền mạch |

File [mcp_config.json](mcp_config.json) đã đặt sẵn:
```json
"extraBody": { "reasoning_effort": "none" }
```
Đây là tham số Ollama chấp nhận để giảm chain-of-thought — nhờ nó mới còn ~1 phút thay vì ~5 phút
mỗi vòng.

---

## Bước 0.3 — Cài dependencies và build

### Vì sao cần
Project dùng **npm workspaces**: 5 package con chia sẻ chung một `node_modules` và một lockfile.
Chạy `npm install` ở thư mục gốc là cài cho tất cả.

Build là bắt buộc vì Node **chỉ chạy được `.js`**, không chạy trực tiếp `.ts`.

### Cách làm
```bash
cd /Users/maplelabs/22127086
source ~/.nvm/nvm.sh && nvm use 22
npm install
npm run build
```

### Kiểm chứng
```bash
ls packages/*/dist/index.js
```
Phải ra **đúng 5 file**:
```
packages/agent-host/dist/index.js
packages/server-local-http/dist/index.js
packages/server-public-http/dist/index.js
packages/server-stdio/dist/index.js
packages/shared/dist/index.js
```

> ⚠️ **Sửa code trong `src/` mà quên build là chạy code cũ.** Đây là lỗi âm thầm, không báo gì cả.
> Nếu thấy hành vi lạ không khớp với code đang đọc, chạy lại `npm run build` trước tiên.

### Ghi chú về thứ tự build
Lệnh build dùng `tsc --build` với TypeScript project references:
```
tsc --build packages/shared packages/server-stdio packages/server-local-http packages/server-public-http packages/agent-host
```
`packages/shared` phải build trước vì bốn package kia đều import từ nó. `tsc --build` tự hiểu
quan hệ phụ thuộc qua trường `references` trong mỗi `tsconfig.json`.

---

## Bước 0.4 — File `.env`

### Vì sao cần
Có hai loại giá trị không nên nằm trong code:

1. **Bí mật** — `MCP_API_KEY`. Nếu commit lên GitHub thì ai cũng gọi được server public của anh.
2. **Giá trị theo máy** — `DEFAULT_REPO_PATH` khác nhau ở mỗi máy.

### Cách làm
```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```
Dán chuỗi vừa sinh vào `MCP_API_KEY` trong [.env](.env), và đặt:
```
DEFAULT_REPO_PATH=/Users/maplelabs/22127086
```

### Vì sao key phải dài
Server **từ chối khởi động** nếu key ngắn hơn 16 ký tự:

```ts
if (!API_KEY || API_KEY.length < 16) {
  console.error("[team-log] FATAL: set MCP_API_KEY to a random string of at least 16 characters...");
  process.exit(1);
}
```

Đây là chủ ý: thà chết ngay lúc deploy còn hơn chạy được nhưng không được bảo vệ.

### Cách `.env` được nạp — không cần `export`

Các script trong [package.json](package.json) chạy Node với cờ đọc `.env` sẵn:
```json
"host":              "node --env-file-if-exists=.env packages/agent-host/dist/index.js",
"start:local-http":  "node --env-file-if-exists=.env packages/server-local-http/dist/index.js",
"start:public-http": "node --env-file-if-exists=.env packages/server-public-http/dist/index.js"
```

Dùng bản `if-exists` chứ không phải `--env-file` là có lý do: nếu ai clone repo về mà chưa tạo
`.env`, `--env-file` làm Node crash ngay; bản `if-exists` chỉ bỏ qua để server tự báo lỗi bằng
thông báo dễ hiểu của nó.

### Kiểm chứng
```bash
grep -c '^MCP_API_KEY=' .env                      # phải ra 1
grep '^MCP_API_KEY=' .env | cut -d= -f2- | wc -c  # phải > 16
git check-ignore .env && echo "an toàn, .env bị gitignore"
```

### Bí mật không lọt vào git như thế nào

Mở [mcp_config.json](mcp_config.json), chỉ vào:
```json
"headers": { "Authorization": "Bearer ${MCP_API_KEY}" }
```

File này **commit lên git** nhưng chỉ chứa placeholder. Host thay thế `${MCP_API_KEY}` bằng giá
trị thật lúc đọc config (hàm `expandEnv` trong [config.ts](packages/agent-host/src/config.ts#L65)).

---

## Bước 0.5 — Public HTTP server đã deploy trên Render

> **Phần này không còn là hướng dẫn deploy nữa.** Server public của em đã được triển khai lên
> Render, nên ở đây chỉ cần giải thích vai trò của Render và những gì người chấm sẽ thấy.

### Đề bài yêu cầu gì

> **Part 2.3 — Public HTTP MCP Server**
> - Transport: Deployed remote HTTP endpoint
> - Authentication: Secured with API Key Protection (`Authorization: Bearer <token>`)
> - Must be accessible on the public internet
> - Must pass validation using the MCP Inspector

### Render đang làm gì trong bài này

Render chỉ đóng vai trò **nơi host server public**. Nó không thay đổi logic MCP bên trong, mà
chỉ cung cấp ba thứ:

1. **URL công khai** để người chấm có thể gọi từ bên ngoài.
2. **HTTPS tự động** để endpoint an toàn và hợp lệ trên internet.
3. **Môi trường chạy ổn định** với biến `PORT` và `MCP_API_KEY` được inject lúc khởi động.

### Ý nghĩa của Render với server này

- `/health` vẫn mở không cần key để Render kiểm tra service còn sống.
- `/mcp` mới là endpoint MCP thật, và nó bắt buộc có `Authorization: Bearer <token>`.
- Dữ liệu standup được ghi vào file JSON trên container, nên nếu Render redeploy thì dữ liệu có
  thể mất nếu không gắn volume.

### Hai hạn chế cần nhớ khi quay demo

**Container ngủ khi rảnh.** Sau một thời gian không có request, Render có thể cold start lại.
→ Trước khi quay, nên gọi `/health` một lần để đánh thức container.

**Ổ đĩa ephemeral.** Nếu redeploy, dữ liệu trên disk container có thể không còn.
→ Đây là hành vi đã giải thích trong README và resource `teamlog://config/settings`.

### Kiểm chứng trên Render

Khi cần kiểm tra, chỉ cần dùng ba điều sau:

1. `PUBLIC_URL` trỏ tới URL Render.
2. `MCP_API_KEY` trùng với key local trong `.env`.
3. Gọi `/health` trước, rồi mới gọi `/mcp` với bearer token.

> Nếu các bước này đúng, nghĩa là phần deploy Render đã hoàn tất và không cần quay lại phần setup.

---

## Bước 0.6 — Đăng ký với host MCP thứ hai (Part 4)

### Vì sao cần
Part 4 yêu cầu server chạy được trên **hai host độc lập**. Nếu bỏ bước này thì mất một phần
trong 25% "Overall Integration".

### Cách làm
Nếu host thứ hai của anh/chị hỗ trợ import cấu hình MCP theo file JSON chuẩn như trong repo,
thì trỏ nó tới cùng ba server đó: `git-inspector`, `code-analyzer`, và `team-log`.

### Kiểm chứng
Mở host thứ hai và kiểm tra rằng 3 server đã xuất hiện trong danh sách MCP tools/resources.

Nếu host đó có cơ chế skill riêng, chỉ cần dùng cùng nội dung `skills/daily-standup/SKILL.md`.
Phần quan trọng là workflow vẫn chạy trên **hai client độc lập**, không phụ thuộc vào một
agent duy nhất.

---

## Bước 0.7 — Chạy thử toàn bộ trước khi quay

Đây là bài kiểm tra cuối. Nếu bước này chạy trót lọt thì quay video sẽ ổn.

### Dọn cổng trước

```bash
lsof -ti:3001,3002 | xargs kill -9 2>/dev/null; echo "đã dọn"
```

**Vì sao bước này quan trọng nhất:** nếu còn server cũ giữ cổng, server mới **không bind được**
nhưng client vẫn kết nối vào server cũ — với API key khác. Triệu chứng là
`✗ team-log Invalid API key`, khiến anh đi tìm nhầm hướng (tưởng sai key).

Server đã in thông báo rõ ràng khi gặp trường hợp này:
```
[code-analyzer] FATAL: port 3001 is already in use.
  Another server is still running there. Find and stop it with:
    lsof -ti:3001 | xargs kill -9
```

### Bật 3 terminal

Mỗi terminal đều bắt đầu bằng `cd /Users/maplelabs/22127086 && source ~/.nvm/nvm.sh && nvm use 22`

```bash
# Terminal 1
npm run start:local-http
# → [code-analyzer] listening on http://localhost:3001/mcp

# Terminal 2
npm run start:public-http
# → [team-log] listening on http://localhost:3002/mcp
# → [team-log] API key authentication is ENABLED

# Terminal 3
npm run host
```

### Kết quả phải thấy

```
✓ Connected to http://localhost:11434/v1 using qwen3:4b
✓ code-analyzer (3 tools)
✓ team-log (3 tools)
✓ git-inspector (3 tools)
✓ 1 skill(s) from ./skills

10 tools in context (including use_skill).
```

**Bốn dấu ✓ và con số 10.** Thiếu bất kỳ dòng nào là chưa sẵn sàng quay.

### Chạy thử vài lệnh

```
/tools        → thấy 9 tool có namespace + use_skill
/resources    → thấy resource của các server
/prompts      → thấy standup_report
/skills       → thấy daily-standup
/exit         → thoát trong ~1 giây, không treo
```

### Làm nóng model — bước cuối cùng, đừng bỏ

```bash
curl -s localhost:11434/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"qwen3:4b","messages":[{"role":"user","content":"hi"}]}' >/dev/null && echo "model đã nóng"
```

**Vì sao:** lần suy luận đầu tiên Ollama phải nạp 2.5 GB trọng số từ ổ cứng vào RAM — mất
**khoảng 90 giây**. Không làm nóng trước thì video có 90 giây màn hình đứng im ngay lúc quan
trọng nhất.

### Đảm bảo có commit gần đây

```bash
git log --oneline -5
```

Skill đọc commit trong 1 ngày gần nhất. Không có commit mới → skill báo "không có hoạt động" →
demo mất ý nghĩa. Nếu commit cũ, khi demo hãy nói *"in the last 7 days"* thay vì "hôm qua".

---

## Checklist SETUP hoàn tất

- [ ] `node -v` ra v20+ sau khi `source ~/.nvm/nvm.sh`
- [ ] `ollama list` có model, `curl localhost:11434/v1/models` phản hồi
- [ ] `npm install && npm run build` → đủ 5 file `dist/index.js`
- [ ] `.env` có `MCP_API_KEY` dài >16 ký tự, và `git check-ignore .env` xác nhận bị bỏ qua
- [ ] Code đã push lên GitHub, `.env` **không** có trong `git ls-files`
- [x] Render deploy xong, server public đã có URL và API key hoạt động
- [ ] Host MCP thứ hai thấy đủ 3 server
- [ ] Chạy thử 3 terminal → **4 dấu ✓ và 10 tools**
- [ ] Đã làm nóng model
- [ ] Có commit trong vòng 1 ngày

---

## Thứ tự khuyến nghị

Nếu làm từ đầu, theo thứ tự này để không phải chờ:

1. **Bước 0.1–0.4** (Node, Ollama, build, `.env`) — ~15 phút
2. **Bước 0.7** chạy thử dưới máy — xác nhận code chạy được trước khi lo deploy
3. **Render đã deploy sẵn** — chỉ kiểm tra URL và API key trước khi quay
4. **Host MCP thứ hai** (Bước 0.6) — nhanh
5. **Chạy thử lần cuối + làm nóng model** — ngay trước khi bấm ghi

---
---

# MỞ ĐẦU — Kiến trúc tổng thể (1 phút)

## Mục đích cảnh này

Cho người chấm bản đồ tổng thể trước khi đi vào chi tiết. Nếu không có cảnh này, các cảnh sau
sẽ rời rạc và người xem không hiểu vì sao lại có tận ba server.

## Hình cần chuẩn bị

Sơ đồ trong [README.md](README.md), hoặc vẽ lên slide:

```
                 ┌──────────────────────────────────────┐
                 │      Agent Host  (MCP Client)        │
                 │  config loader · tool merger         │
                 │  Ollama engine  · call dispatcher    │
                 │  skill engine (use_skill)            │
                 └───────┬───────────┬──────────────┬───┘
            stdio        │      HTTP │         HTTPS│ + Bearer key
                 ┌───────▼──┐  ┌─────▼──────┐  ┌────▼─────────┐
                 │ git-     │  │ code-      │  │ team-log     │
                 │ inspector│  │ analyzer   │  │ (deployed)   │
                 └──────────┘  └────────────┘  └──────────────┘
```

## Lời thoại

> "Em xây dựng một hệ thống agentic hoàn chỉnh quanh Model Context Protocol, gồm bốn thành phần.
>
> **Thứ nhất — Agent Host.** Đây là MCP Client, chạy bằng LLM local qua Ollama. Nó có ba nhiệm
> vụ: đọc file cấu hình để biết có những server nào, kết nối tới từng server rồi gộp toàn bộ
> tool của chúng thành một danh sách duy nhất cho model, và định tuyến lệnh gọi từ model về
> đúng server sở hữu tool đó.
>
> **Thứ hai — ba MCP server trên ba transport khác nhau.** Một server chạy trên stdio, một
> server HTTP ở localhost, và một server HTTP đã deploy lên internet có bảo vệ bằng API key.
>
> **Thứ ba — Skill Engine** theo mẫu Agent Skills của Anthropic. Nó cho phép kích hoạt một quy
> trình nhiều bước chỉ bằng câu tiếng Anh bình thường, không cần slash command.
>
> **Thứ tư — tính tương thích song song.** Toàn bộ server và skill chạy được trên cả agent của
> em lẫn host thứ hai."

## Ý cần nhấn mạnh

> "Điều quan trọng cần hiểu là **ba transport không phải ba giao thức khác nhau**. Chúng cùng
> nói một ngôn ngữ MCP: cùng `initialize`, cùng `tools/list`, cùng `tools/call`. Khác biệt duy
> nhất là **đường vận chuyển** các message JSON-RPC đó: qua ống stdin/stdout, hay qua HTTP.
>
> Đó chính là lý do ở Cảnh 4 anh sẽ thấy Agent Host xử lý cả ba server bằng **cùng một class
> `Client`** của MCP SDK, chỉ khác đối tượng transport truyền vào."

---
---

# CẢNH 1 — Stdio MCP Server (2.5 phút)

## Yêu cầu đề bài mà cảnh này giải quyết

> **Part 2.1 — Stdio MCP Server (20%)**
> - Transport: stdio
> - At least 3 Tools
> - At least 1 Resource
> - At least 1 Prompt Template
> - Error Handling: proper `isError` flag

Cảnh này phải cho thấy **đủ cả bốn gạch đầu dòng**. Thiếu một cái là mất điểm.

## Thao tác mở đầu

```bash
npm run inspect:stdio
```

Lệnh này thực chất là:
```
npx @modelcontextprotocol/inspector node packages/server-stdio/dist/index.js
```

Trình duyệt mở MCP Inspector → bấm **Connect**.

## Lời thoại khi Connect — giải thích stdio transport

> "Chú ý là em **không hề bật server này lên trước**. Anh chị để ý dòng lệnh: em đưa cho
> Inspector câu lệnh `node packages/server-stdio/dist/index.js`, chứ không đưa một URL.
>
> Inspector nhận câu lệnh đó và **tự spawn tiến trình con**. Sau đó nó ghi JSON-RPC request vào
> **stdin** của tiến trình con, và đọc response từ **stdout**. Không có cổng mạng nào, không có
> HTTP.
>
> Đó là toàn bộ bản chất của stdio transport, và cũng là lý do nó phù hợp cho server chạy cục bộ:
> vòng đời server gắn với vòng đời client, client tắt là server tắt theo, không có tiến trình
> mồ côi."

### Bốn khái niệm cần giải thích rõ ở đây

Nếu người chấm hỏi sâu, hoặc nếu muốn nói kỹ hơn, đây là bốn thứ cần nắm chắc.

**a) Vì sao đưa câu lệnh chứ không đưa URL**

MCP có nhiều transport. Đưa URL **chỉ có nghĩa khi server đã tự chạy sẵn và đang lắng nghe một
cổng mạng**. Server stdio thì không lắng nghe cổng nào cả — nó chỉ đọc/ghi stdin/stdout, nên
không tồn tại URL nào để đưa. Thứ duy nhất mô tả được nó là **cách để sinh ra nó**.

| | stdio | HTTP/SSE |
|---|---|---|
| Server chạy ở đâu | Máy cục bộ, do client tự khởi động | Máy chủ riêng, đã chạy sẵn |
| Client cần biết gì | **Câu lệnh để chạy server** | **URL** (`https://...`) |
| Kênh truyền | stdin/stdout của tiến trình con | Cổng mạng TCP |
| Vòng đời | Gắn với client | Độc lập |

> "Nói ngắn gọn: với HTTP thì client *tìm đến* server; với stdio thì client *tạo ra* server."

**b) Inspector là gì**

`@modelcontextprotocol/inspector` — công cụ debug chính thức của MCP. Nó đóng vai **một MCP
client giả lập có giao diện web**, để xem server khai báo những tool/resource/prompt gì và gọi
thử chúng mà không cần viết host riêng. Trong lúc phát triển, nó thay thế vai trò của Claude
Desktop hoặc Agent Host ở Cảnh 4.

**c) Spawn tiến trình con là gì**

"Spawn" là việc một tiến trình (Inspector) yêu cầu hệ điều hành tạo ra một tiến trình mới
(server), giữ quan hệ **cha – con**. Điểm mấu chốt: khi tạo tiến trình con, tiến trình cha
**giữ được ba đường ống (pipe)** nối vào con:

| fd | Tên | Hướng |
|---|---|---|
| 0 | `stdin` | cha **ghi** vào → con **đọc** |
| 1 | `stdout` | con **ghi** vào → cha **đọc** |
| 2 | `stderr` | con ghi log/lỗi → cha đọc |

Bình thường khi gõ `node index.js` ở terminal, ba đường ống này nối vào bàn phím và màn hình.
Khi Inspector spawn server, chúng nối vào chính Inspector. Đây là "kênh truyền" — hoàn toàn nằm
trong bộ nhớ của hệ điều hành, **không đi qua card mạng**.

Vì là quan hệ cha–con nên Inspector tắt thì pipe đóng, server đọc được EOF trên stdin và tự
thoát → không có tiến trình mồ côi.

**d) JSON-RPC là gì**

Một quy ước định dạng cho việc "gọi hàm từ xa", mã hoá bằng JSON. MCP dùng **JSON-RPC 2.0** làm
ngôn ngữ chung cho cả ba transport.

```jsonc
// Request  — client → server
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}

// Response — server → client
{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"git_recent_commits"}]}}
```

- `method` — tên thao tác (`initialize`, `tools/list`, `tools/call`, `resources/read`…)
- `id` — để ghép request với response, vì có thể gửi nhiều request cùng lúc và response về
  không theo thứ tự
- message **không có `id`** là *notification* — gửi một chiều, không cần trả lời

**"Đọc response từ stdout" nghĩa là gì:** với stdio, mỗi message JSON là **một dòng kết thúc
bằng `\n`** (newline-delimited JSON). Server ghi `process.stdout.write(JSON.stringify(res) + "\n")`;
Inspector lắng nghe sự kiện `data` trên stdout của tiến trình con, gom byte lại, cắt theo `\n`,
parse JSON, khớp `id` với request đã gửi và resolve Promise tương ứng.

**Hệ quả kỹ thuật rất quan trọng cần nói:**

Mở [packages/server-stdio/src/index.ts:1](packages/server-stdio/src/index.ts#L1), chỉ vào comment đầu file:

```ts
/**
 * IMPORTANT: on stdio, stdout *is* the protocol channel. Every diagnostic in
 * this file therefore goes to stderr — a stray console.log would corrupt the
 * JSON-RPC stream and break the connection.
 */
```

> "Vì stdout **chính là kênh giao thức**, nên trong toàn bộ file này em không được phép dùng
> `console.log`. Chỉ một dòng log lạc vào stdout là luồng JSON-RPC hỏng và kết nối đứt. Mọi
> thông báo đều phải đi ra `console.error`, tức stderr."

Cuộn xuống cuối file cho thấy:
```ts
console.error(`[${SERVER_NAME}] stdio MCP server ready (v${SERVER_VERSION})`);
```

---

## 1.1 — Ba Tool

### Thao tác
Mở tab **Tools**. Ba tool hiện ra.

### Lời thoại
> "Ba tool đều xoay quanh việc đọc thông tin từ một repository git:
> `git_recent_commits` đọc lịch sử commit, `git_diff_stats` đo quy mô thay đổi giữa hai
> revision, và `git_search_files` tìm chuỗi trong các file được git quản lý."

### Cơ chế: schema được truyền cho client như thế nào

Mở [packages/server-stdio/src/index.ts:27](packages/server-stdio/src/index.ts#L27):

```ts
server.registerTool(
  "git_recent_commits",
  {
    title: "Recent git commits",
    description:
      "List recent commits in a local git repository. Use this to find out what work was done, by whom, and when.",
    inputSchema: {
      repo_path: z.string().describe("Absolute path to the git repository."),
      since: z.string().optional()
        .describe("Only commits after this date. Accepts git date syntax, e.g. '1 day ago', '2026-08-01'."),
      author: z.string().optional().describe("Filter by author name or email substring."),
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum commits to return."),
    },
  },
  safeTool("git_recent_commits", async ({ repo_path, since, author, limit }) => { ... }),
);
```

> "Đoạn này em sẽ chỉ vào ba thứ: `inputSchema` là phần khai báo dữ liệu đầu vào, `safeTool`
> là lớp bọc xử lý lỗi an toàn, và phần callback phía dưới là logic thật của tool. Khi demo,
> chỉ cần nói rằng MCP SDK tự biến schema này thành JSON Schema để Inspector và LLM cùng dùng."

**Giải thích cơ chế — nói theo trình tự này:**

> "Em khai báo `inputSchema` bằng Zod. Khi server khởi động, MCP SDK **tự chuyển Zod schema
> thành JSON Schema chuẩn**. Rồi khi client gọi `tools/list`, server trả về mảng tool, mỗi tool
> kèm JSON Schema đó.
>
> Nhờ vậy hai chuyện xảy ra tự động:
>
> Một là **Inspector tự sinh form nhập liệu** ở khung bên phải kia — nó biết `repo_path` là
> chuỗi bắt buộc, `limit` là số từ 1 đến 100 với mặc định 20, nên nó render đúng loại input.
>
> Hai là ở Cảnh 4, **Agent Host lấy nguyên JSON Schema này đưa cho LLM**. Em gần như không phải
> chuyển đổi gì, vì MCP dùng JSON Schema và OpenAI function calling cũng dùng JSON Schema."

**Nhấn mạnh `.describe()` — điểm ít người để ý:**

> "Mỗi tham số đều có `.describe()`. Đây **không phải comment cho người đọc code** — chuỗi này
> đi thẳng vào context của LLM.
>
> Ví dụ dòng `'Accepts git date syntax, e.g. 1 day ago'`. Nhờ dòng này mà model 4B biết được
> nó có thể truyền chuỗi tiếng Anh `"1 day ago"` chứ không phải bắt buộc định dạng ISO. Nếu
> thiếu mô tả, model sẽ đoán, và đoán sai thì tool lỗi."

---

## 1.2 — Chạy tool thành công

### Thao tác
Chọn `git_recent_commits`, điền:
```
repo_path: /Users/maplelabs/22127086
since:     7 days ago
```
Bấm **Run Tool**.

### Lời thoại
> "Kết quả trả về là **JSON có cấu trúc**, không phải text thô. Có mảng `commits` với hash, tác
> giả, email, ngày ISO, tiêu đề, nội dung. Có `count`, và quan trọng nhất là **`range`** —
> khoảng revision từ commit cũ nhất đến mới nhất. Lát nữa ở Cảnh 5 anh chị sẽ thấy skill lấy
> đúng trường `range` này để đưa vào bước tiếp theo."

### Cơ chế 1: chống command injection

Mở [packages/shared/src/git.ts](packages/shared/src/git.ts):

```ts
export async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    maxBuffer: MAX_BUFFER,
    timeout: TIMEOUT_MS,
  });
  return stdout;
}
```

> "Em dùng **`execFile` với mảng tham số**, tuyệt đối không dùng `exec` với chuỗi shell.
>
> Khác biệt rất lớn. Nếu em viết `exec('git -C ' + repoPath + ' log')` thì khi ai đó truyền
> `repo_path` là `/tmp; rm -rf ~`, shell sẽ hiểu dấu chấm phẩy là dấu ngăn lệnh và chạy luôn
> lệnh xoá.
>
> Với `execFile` và mảng argv, **không có shell nào tham gia**. Chuỗi `/tmp; rm -rf ~` được
> truyền cho git như một tham số nguyên vẹn, git chỉ báo thư mục không tồn tại.
>
> Đây là điểm quan trọng vì tham số của tool đến từ LLM — mà LLM thì có thể bị prompt injection
> điều khiển."

**`execFile` chính xác là gì — phần dự phòng nếu bị hỏi:**

`execFile(file, args[], options, callback)` thuộc module `child_process` của Node. Nó chạy
**một file thực thi cụ thể** với danh sách tham số **đã tách sẵn**. So sánh với `exec`:

```js
// exec — chuỗi được đưa cho SHELL diễn giải
exec(`git log --author=${author}`)
// author = "x; rm -rf /"  →  shell thấy dấu ; và chạy luôn lệnh rm. Command injection.

// execFile — KHÔNG có shell, mỗi phần tử mảng là 1 tham số nguyên vẹn
execFile("git", ["log", `--author=${author}`])
// author = "x; rm -rf /"  →  git nhận đúng 1 chuỗi "--author=x; rm -rf /",
//                            coi là dữ liệu, không tìm thấy gì. An toàn.
```

| | `exec` | `execFile` |
|---|---|---|
| Có shell trung gian | Có (`/bin/sh -c`) | **Không** |
| Tham số truyền vào | Một chuỗi | Mảng argv |
| `;` `|` `&&` `$(...)` `>` | Có ý nghĩa đặc biệt | Chỉ là ký tự thường |
| Glob `*`, biến `$HOME` | Shell tự expand | Phải tự làm trong code |

> "Vì không qua shell nên mọi ký tự đặc biệt mất ý nghĩa — chúng chỉ còn là ký tự trong chuỗi.
> Đổi lại em cũng mất tiện ích của shell như glob hay pipe, nhưng ở đây em không cần đến chúng.
> Với input đến từ LLM thì đây là đánh đổi hoàn toàn xứng đáng."

### Cơ chế 2: parse `git log` an toàn

```ts
const FIELD  = "";   // ASCII unit separator
const RECORD = "";   // ASCII record separator
const LOG_FORMAT = ["%H", "%h", "%an", "%ae", "%aI", "%s", "%b"].join(FIELD) + RECORD;
```

> "Vấn đề khi parse `git log`: nội dung commit có thể có nhiều dòng, có dấu phẩy, có dấu tab.
> Nếu em tách bằng xuống dòng hay dấu phẩy thì một commit message nhiều dòng sẽ phá vỡ parser.
>
> Em dùng hai ký tự điều khiển ASCII: `0x1F` là *unit separator* ngăn các trường, `0x1E` là
> *record separator* ngăn các commit. Hai ký tự này **không bao giờ xuất hiện trong văn bản
> bình thường**, nên parse luôn đúng."

### Cơ chế 3: chuẩn hoá đường dẫn — nếu còn thời gian

Chạy lại tool nhưng dán `repo_path` có **khoảng trắng thừa ở đầu**:
```
 /Users/maplelabs/22127086
```
Vẫn chạy đúng.

> "Chỗ này em gặp lỗi thật khi test. `path.resolve` của Node **không coi chuỗi có dấu cách đầu
> là đường dẫn tuyệt đối**, nên nó ghép với thư mục hiện tại và sinh ra đường dẫn lặp hai lần,
> báo lỗi rất khó hiểu.
>
> Em viết hàm chuẩn hoá riêng trong [paths.ts](packages/shared/src/paths.ts), xử lý ba trường
> hợp: khoảng trắng thừa, dấu ngoặc kép dính theo khi copy-paste, và ký tự `~` — vì shell tự
> expand `~` còn Node thì không.
>
> Em nghĩ chỗ này quan trọng vì đường dẫn đến tay server từ ba nguồn đều luộm thuộm: người gõ
> tay vào Inspector, người dán vào chat, và LLM sinh ra."

---

## 1.3 — Resource

### Yêu cầu đề bài
> *At least 1 Resource: Static or dynamic data payload accessible via URI*

### Thao tác
Tab **Resources** → bấm `gitinspector://config/settings`.

### Lời thoại — phân biệt Resource với Tool
> "Cần phân biệt rõ hai khái niệm này của MCP.
>
> **Tool là hành động** — model gọi để *làm* một việc gì đó, có thể gây tác dụng phụ.
>
> **Resource là dữ liệu** — được định danh bằng URI, client *đọc* nó. Giống như GET trong REST:
> đọc thì không làm thay đổi gì.
>
> Resource này trả về cấu hình của chính server: version, thư mục repo mặc định, các giá trị
> mặc định của từng tool, và danh sách tool."

### Code

[packages/server-stdio/src/index.ts:187](packages/server-stdio/src/index.ts#L187):

```ts
server.registerResource(
  "settings",
  "gitinspector://config/settings",
  {
    title: "git-inspector settings",
    description: "Static configuration for this server: version, defaults, and capabilities.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({
        server: SERVER_NAME,
        version: SERVER_VERSION,
        transport: "stdio",
        default_repo_path: process.env.DEFAULT_REPO_PATH ?? process.cwd(),
        defaults: { recent_commits_limit: 20, diff_rev_range: "HEAD~1..HEAD", search_limit: 50 },
        tools: ["git_recent_commits", "git_diff_stats", "git_search_files"],
        error_handling: "Tool failures are returned as results with isError=true, never as protocol errors.",
      }, null, 2),
    }],
  }),
);
```

> "Resource này em dùng để minh hoạ rằng server không chỉ có tool. Nó trả về dữ liệu đọc-only
> theo URI, nên khi nói với người chấm em có thể nhấn mạnh: tool là để làm việc, resource là để
> đọc cấu hình hoặc trạng thái."

> "URI scheme `gitinspector://` là do em tự đặt. MCP **không bắt buộc** dùng `http://` hay
> `file://` — URI chỉ cần định danh duy nhất trong phạm vi server đó. Cách đặt tên theo scheme
> riêng giúp client biết ngay resource này thuộc server nào.
>
> `mimeType` cho client biết cách hiển thị. Vì em khai `application/json` nên Inspector tô màu
> cú pháp JSON thay vì hiện text thô."

---

## 1.4 — Prompt Template

### Yêu cầu đề bài
> *At least 1 Prompt Template: Pre-configured prompt template exposed via the MCP protocol*

### Thao tác
Tab **Prompts** → chọn `standup_report` → điền `repo_path` → **Get Prompt**.

### Lời thoại
> "Prompt template là đoạn prompt viết sẵn **do server cung cấp**. Ý tưởng là: người viết server
> hiểu rõ tool của mình nhất, nên họ cũng nên cung cấp luôn cách dùng tool đó hiệu quả.
>
> Ở Claude Desktop, các prompt này hiện ra thành slash command cho người dùng chọn. Ở đây
> Inspector render ra nội dung sau khi đã điền tham số."

### Code

[packages/server-stdio/src/index.ts:227](packages/server-stdio/src/index.ts#L227):

```ts
server.registerPrompt(
  "standup_report",
  {
    title: "Daily standup report",
    argsSchema: {
      repo_path: z.string().describe("Absolute path to the repository to report on."),
      author: z.string().optional(),
      since: z.string().optional(),
    },
  },
  ({ repo_path, author, since }) => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          `Write my daily standup for the repository at ${repo_path}.`,
          "",
          "Steps:",
          `1. Call git_recent_commits with repo_path='${repo_path}', since='${since ?? "1 day ago"}'...`,
          "2. Call git_diff_stats over the range those commits cover...",
          "3. Write the report as markdown with exactly three sections:",
          ...
        ].join("\n"),
      },
    }],
  }),
);

  > "Em sẽ giải thích đây là prompt template có sẵn từ server: client chỉ cần nhập `repo_path`,
  > còn nội dung hướng dẫn đã được server dựng sẵn thành từng bước. Điểm hay là prompt này có thể
  > tái dùng cho mọi client hiểu MCP, không phụ thuộc vào UI cụ thể."
```

> "Điểm cần nhấn: template này **tự chèn tham số vào lời hướng dẫn**. Anh chị thấy nó không nói
> chung chung là 'hãy đọc commit' — nó nói rõ *'gọi `git_recent_commits` với `repo_path` bằng
> đúng giá trị vừa nhập'*.
>
> Nghĩa là prompt và tool của cùng một server **phối hợp với nhau**: server vừa cung cấp công
> cụ, vừa cung cấp hướng dẫn dùng công cụ đó."

**Câu chuyển tiếp sang Cảnh 5 — nên nói để tạo mạch:**
> "Anh chị nhớ prompt template này, vì lát nữa ở phần Skill em sẽ so sánh: prompt template thì
> **client phải chọn thủ công**, còn skill thì **model tự chọn**. Đó là khác biệt then chốt."

---

## 1.5 — `isError` — phần lấy điểm nặng nhất của cảnh

### Yêu cầu đề bài
> *Error Handling: Proper implementation of `isError` flag in tool result payloads to ensure
> graceful LLM error recovery*

Chú ý cụm **"graceful LLM error recovery"** — đề không chỉ hỏi có cờ `isError` hay không, mà hỏi
nó có giúp LLM **phục hồi** được không.

### Thao tác
Quay lại tab Tools, chạy `git_recent_commits` với:
```
repo_path: /nope
```

Kết quả:
```
git_recent_commits failed: Path '/nope' does not exist or is not readable.

Hint: Pass an absolute path to a directory on this machine.
```
Inspector đánh dấu đỏ, nhưng **kết nối vẫn còn**.

### Lời thoại — nói chậm, đây là phần quan trọng nhất

> "Chú ý điều đầu tiên: **kết nối không đứt**. Em vẫn chạy tiếp tool khác được.
>
> MCP phân biệt rất rõ **hai loại lỗi**, và hiểu sai chỗ này là làm hỏng cả agent.
>
> **Loại một — protocol error.** Sai tên tool, request JSON hỏng, thiếu tham số bắt buộc. Cái
> này trả về JSON-RPC error ở tầng giao thức. **Model không bao giờ nhìn thấy nó** — chỉ có host
> xử lý.
>
> **Loại hai — tool execution error.** Tool được gọi đúng, nhưng khi chạy thì thất bại: thư mục
> không tồn tại, git exit code khác 0, mạng lỗi. Cái này **phải trả về như một response thành
> công ở tầng giao thức**, nhưng đánh dấu `isError: true` trong kết quả.
>
> Vì sao phải như vậy? Vì model **cần đọc được thông báo lỗi** để tự sửa tham số rồi thử lại.
> Nếu em để lỗi thoát ra thành protocol error thì model bị mù — nó chỉ biết 'có gì đó hỏng' mà
> không biết hỏng cái gì.
>
> Gần như mọi lỗi mà một tool có thể gặp đều thuộc loại hai."

### Code — cơ chế trung tâm

[packages/shared/src/result.ts:64](packages/shared/src/result.ts#L64):

```ts
export function safeTool<Args>(
  toolName: string,
  handler: (args: Args) => Promise<ToolResult> | ToolResult,
): (args: Args) => Promise<ToolResult> {
  return async (args: Args) => {
    try {
      return await handler(args);
    } catch (error) {
      if (error instanceof ToolError) {
        return fail(`${toolName} failed: ${error.message}`, error.hint);
      }
      const message = error instanceof Error ? error.message : String(error);
      return fail(`${toolName} failed: ${message}`);
    }
  };
}
```

> "Đây là lớp bảo vệ chung cho toàn bộ tool. Khi em giải thích, em có thể nói: thay vì để
> từng tool tự nhớ format lỗi, em bọc nó bằng `safeTool` để mọi lỗi đều trả về đúng kiểu MCP,
> có `isError: true` và thông điệp dễ đọc cho model."

[packages/shared/src/result.ts:42](packages/shared/src/result.ts#L42):

```ts
export function fail(message: string, hint?: string): ToolResult {
  const text = hint ? `${message}\n\nHint: ${hint}` : message;
  return { content: [{ type: "text", text }], isError: true };
}
```

**Giải thích theo trình tự:**

> "`safeTool` là một higher-order function bọc **mọi** tool handler trong cả ba server.
>
> Nhờ nó, em viết tool theo phong cách tự nhiên nhất là `throw` khi gặp lỗi — mà vẫn đảm bảo
> đúng hợp đồng của MCP. Không phải nhớ trả về `isError` ở từng nhánh lỗi.
>
> Và em luôn kèm **`hint`** — một câu chỉ cho model cách sửa. Đây là khác biệt giữa *'lỗi rồi'*
> và *'lỗi rồi, hãy làm thế này'*. Với model 4B, câu hint quyết định nó có tự sửa được hay không."

### Nơi lỗi được sinh ra

[packages/shared/src/git.ts](packages/shared/src/git.ts):

```ts
export async function assertGitRepo(repoPath: string): Promise<string> {
  const abs = normalizePath(repoPath);
  try {
    const info = await stat(abs);
    if (!info.isDirectory()) throw new ToolError(`'${abs}' is not a directory.`);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(
      `Path '${abs}' does not exist or is not readable.`,
      "Pass an absolute path to a directory on this machine.",   // ← đây là hint
    );
  }
  ...
}
```

> "`ToolError` là lớp lỗi riêng, nghĩa là **thông báo này an toàn để cho model đọc nguyên văn**.
> Lỗi khác loại — ví dụ bug trong code em — thì chỉ lấy `message`, không lộ stack trace."

### Điểm cộng: không phải kết quả rỗng nào cũng là lỗi

Nếu còn thời gian, chạy `git_recent_commits` với `since: "10 years ago"` ở một repo mới → trả về
`count: 0` nhưng **không** phải `isError`.

[packages/server-stdio/src/index.ts:47](packages/server-stdio/src/index.ts#L47):

```ts
if (commits.length === 0) {
  return ok({
    repo, filters: { since, author, limit },
    count: 0, commits: [],
    note: "No commits matched. Try widening `since` or dropping `author`.",
  });
}
```

> "Khoảng thời gian không có commit **không phải lỗi** — đó là câu trả lời hợp lệ. Nếu em đánh
> dấu nó là lỗi, model sẽ hiểu nhầm là gọi sai và lặp lại y hệt lệnh đó. Em trả về `count: 0`
> kèm một câu gợi ý, để model biết nên nới rộng điều kiện."

Tương tự với `git grep` — [server-stdio/src/index.ts:147](packages/server-stdio/src/index.ts#L147):

```ts
const { stdout, stderr, code } = await gitRaw(repo, args);

if (code === 1 && !stdout.trim()) {
  return ok({ repo, pattern, glob, count: 0, matches: [], note: "No matches found." });
}
if (code > 1) {
  throw new ToolError(`git grep failed: ${stderr.trim() || `exit code ${code}`}`, ...);
}
```

> "`git grep` **dùng exit code làm dữ liệu**: exit 1 nghĩa là không tìm thấy gì, exit từ 2 trở
> lên mới là lỗi thật. Nếu em coi mọi exit khác 0 là lỗi thì 'không tìm thấy' sẽ bị báo là lỗi.
> Nên em viết riêng hàm `gitRaw` trả về exit code thay vì throw."

### ✅ Tổng kết cảnh 1
Đã cho thấy: **3 tool** ✓ **1 resource** ✓ **1 prompt** ✓ **`isError` + recovery** ✓

---
---

# CẢNH 2 — Local HTTP Server (1 phút)

## Yêu cầu đề bài
> **Part 2.2 — Local HTTP MCP Server**
> - Transport: Local HTTP/SSE stream on localhost
> - Must pass all standard connection, discovery, and execution tests in MCP Inspector

## Thao tác

Terminal 1 đã chạy sẵn từ trước:
```bash
npm run start:local-http
# → [code-analyzer] listening on http://localhost:3001/mcp
```

Inspector: `npm run inspect` → transport **Streamable HTTP** → URL `http://localhost:3001/mcp`
→ **Connect** → chạy thử `find_todos`.

## Lời thoại — so sánh với cảnh 1

> "Khác biệt đầu tiên so với cảnh trước: **server này em phải bật lên trước**, vì nó là một
> tiến trình HTTP độc lập lắng nghe ở cổng 3001. Inspector kết nối qua mạng chứ không spawn
> tiến trình.
>
> Về domain, ba tool ở đây là phân tích code chứ không phải git: `analyze_complexity` đo số
> dòng và độ lồng nhau, `find_todos` quét các marker TODO/FIXME/BUG, `summarize_file` tóm tắt
> cấu trúc file.
>
> Em **cố ý chọn domain khác** với server git. Lý do: lát nữa khi Agent Host gộp tool lại, anh
> chị sẽ thấy nó đang gộp hai bộ tool thật sự khác nhau chứ không phải nhân bản."

## Cơ chế: Streamable HTTP là giao thức có trạng thái

[packages/shared/src/http.ts:77](packages/shared/src/http.ts#L77):

```ts
mcpRouter.post("/", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    if (!isInitializeRequest(req.body)) {
      res.status(400).json(jsonRpcError(-32000, "No valid session. Send an 'initialize' request first."));
      return;
    }
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { transports.set(id, transport!); },
    });
    transport.onclose = () => {
      if (transport?.sessionId) transports.delete(transport.sessionId);
    };
    await createServer().connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});
```

**Giải thích:**

> "Streamable HTTP **có trạng thái**, khác với REST thông thường. Luồng như sau:
>
> Request đầu tiên phải là `initialize`. Server sinh một UUID làm session id, trả về trong
> header `Mcp-Session-Id`. Từ đó trở đi client phải gửi kèm id này ở mọi request.
>
> Có ba endpoint: **`POST /mcp`** để client gửi message lên, **`GET /mcp`** mở luồng SSE để
> server đẩy ngược về client — dùng cho notification và progress, và **`DELETE /mcp`** để đóng
> session.
>
> Em cài đầy đủ cả ba, vì đó chính là những gì MCP Inspector kiểm tra."

**Hai chi tiết kỹ thuật đáng nói:**

**Một — mỗi session một server instance:**
```ts
await createServer().connect(transport);
```
> "Chú ý em gọi `createServer()` mỗi lần, tạo instance mới cho mỗi session. Nếu dùng chung một
> instance thì notification của client này có thể rò sang client khác."

**Hai — dọn session để tránh rò rỉ bộ nhớ:**
```ts
transport.onclose = () => {
  if (transport?.sessionId) transports.delete(transport.sessionId);
};
```
> "Không có dòng này thì mỗi lần client reconnect sẽ để lại một transport chết trong Map. Chạy
> lâu dài trên server deploy là rò rỉ bộ nhớ."

## Điểm về chất lượng code — nên nói

> "Toàn bộ phần plumbing HTTP này nằm trong `packages/shared/src/http.ts` và được **cả server
> local lẫn server public dùng chung**.
>
> Hai server đó chỉ khác đúng một thứ: server public có thêm middleware kiểm tra API key. Viết
> một lần, debug một lần, và khi em sửa lỗi xử lý session thì cả hai server cùng được sửa."

---
---

# CẢNH 3 — Public HTTP Server + API Key (2 phút)

## Yêu cầu đề bài
> **Part 2.3 — Public HTTP MCP Server (15%)**
> - Deployed remote HTTP endpoint
> - Secured with API Key Protection (`Authorization: Bearer <token>`)
> - Must be accessible on the public internet
> - Must pass validation using MCP Inspector

## Chuẩn bị trước (không quay)

Terminal 4:
```bash
export PUBLIC_URL=https://<deployment-cua-anh>.onrender.com
export MCP_API_KEY=$(grep '^MCP_API_KEY=' .env | cut -d= -f2-)
curl -s $PUBLIC_URL/health    # đánh thức container khỏi trạng thái ngủ
```

## 3.1 — Chứng minh nó thật sự public

**Thao tác:** Mở dashboard Render trong trình duyệt, rồi:
```bash
curl -s $PUBLIC_URL/health
# {"status":"ok","server":"team-log","sessions":0}
```

**Lời thoại:**
> "Server này chạy trên internet thật, không phải localhost. Đây là dashboard của Render, còn
> đây là endpoint `/health` gọi từ máy em.
>
> Chú ý `/health` **cố ý không yêu cầu API key**. Lý do: PaaS cần endpoint này để kiểm tra
> container còn sống. Nếu bắt nó phải có key thì health check luôn trả 401 và nền tảng sẽ tưởng
> service chết rồi khởi động lại liên tục."

## 3.2 — Không có key thì bị chặn

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST $PUBLIC_URL/mcp \
  -H 'content-type: application/json' -d '{}'
# HTTP 401
```

## 3.3 — Có key thì vào được

```bash
curl -s -i -X POST $PUBLIC_URL/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' | head -20
```

Chỉ vào header `mcp-session-id` trong output.

**Lời thoại:**
> "Cùng một request, chỉ thêm header `Authorization: Bearer`. Giờ nó qua được, và server trả về
> `mcp-session-id` — session Streamable HTTP vừa được tạo."

## Cơ chế: middleware xác thực

[packages/shared/src/http.ts:31](packages/shared/src/http.ts#L31):

```ts
export function requireBearerToken(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");

    if (scheme?.toLowerCase() !== "bearer" || !token) {
      res.status(401)
         .set("WWW-Authenticate", 'Bearer realm="mcp"')
         .json(jsonRpcError(-32001, "Missing 'Authorization: Bearer <api-key>' header."));
      return;
    }

    if (!secretsMatch(token, apiKey)) {
      res.status(401).json(jsonRpcError(-32001, "Invalid API key."));
      return;
    }

    next();
  };
}
```

Và nơi nó được gắn vào — [server-public-http/src/index.ts](packages/server-public-http/src/index.ts):

```ts
startHttpMcpServer({
  createServer,
  port: PORT,
  serverName: SERVER_NAME,
  guard: requireBearerToken(API_KEY),   // ← chỉ khác server local ở dòng này
});
```

> "Middleware chỉ gắn vào router `/mcp`, còn `/health` nằm ngoài. Và anh chị thấy đây chính là
> **khác biệt duy nhất** giữa server public và server local."

## Ba điểm bảo mật cần giải thích

### Điểm 1 — So sánh chống timing attack

[packages/shared/src/http.ts:18](packages/shared/src/http.ts#L18):

```ts
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so equalise first. The length
  // itself is not secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

> "Em dùng `timingSafeEqual` chứ không dùng `===`.
>
> Lý do: so sánh chuỗi thông thường **dừng ngay tại ký tự khác nhau đầu tiên**. Nghĩa là nếu
> kẻ tấn công gửi key bắt đầu bằng `a`, thời gian phản hồi sẽ hơi khác so với key bắt đầu bằng
> `b` — nếu ký tự đầu đúng thì hàm phải so tiếp ký tự thứ hai.
>
> Chênh lệch chỉ vài nano giây, nhưng gửi hàng nghìn request rồi lấy trung bình là dò được từng
> ký tự một. `timingSafeEqual` luôn so hết toàn bộ độ dài, thời gian không đổi.
>
> Riêng độ dài thì em so bình thường, vì độ dài key không phải bí mật — và `timingSafeEqual`
> sẽ throw nếu hai buffer khác độ dài."

### Điểm 2 — Body lỗi đúng định dạng JSON-RPC

```ts
function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}
```

> "Em trả về body theo đúng cấu trúc JSON-RPC. Nếu trả về HTML 401 mặc định của Express thì
> client MCP sẽ hiển thị một đống HTML khó hiểu thay vì câu 'Invalid API key'."

### Điểm 3 — Từ chối khởi động nếu key không an toàn

[packages/server-public-http/src/index.ts:22](packages/server-public-http/src/index.ts#L22):

```ts
const API_KEY = process.env.MCP_API_KEY;
if (!API_KEY || API_KEY.length < 16) {
  console.error(
    "[team-log] FATAL: set MCP_API_KEY to a random string of at least 16 characters.\n" +
      "  Generate one with: node -e \"console.log(require('crypto').randomBytes(24).toString('hex'))\"",
  );
  process.exit(1);
}
```

> "Server **từ chối khởi động** nếu thiếu key hoặc key ngắn hơn 16 ký tự.
>
> Em nghĩ đây là quyết định đúng: thà chết ngay lúc deploy còn hơn là chạy được nhưng không
> được bảo vệ. Một server public không có key mà trông như vẫn hoạt động bình thường thì nguy
> hiểm hơn nhiều so với một server không khởi động được."

## 3.4 — Inspector với header xác thực

**Thao tác:** `npm run inspect` → Streamable HTTP → URL `$PUBLIC_URL/mcp` → mục
**Authentication** thêm `Authorization: Bearer <key>` → **Connect** → chạy `log_standup`.

> "Đây là bằng chứng server public pass được Inspector, đúng yêu cầu đề bài."

## Nói về deploy

Mở [packages/server-public-http/Dockerfile](packages/server-public-http/Dockerfile):

> "Hai điểm về Dockerfile.
>
> Thứ nhất, nó **build từ thư mục gốc repo** chứ không phải thư mục con, vì server này phụ thuộc
> vào workspace `@hw/shared`. Nếu build context là thư mục con thì không copy được package đó.
>
> Thứ hai, port đọc từ biến môi trường `PORT`. Render, Railway, Fly, Cloud Run đều inject biến
> này, nên **cùng một image chạy được ở mọi nền tảng** không cần sửa code."

**Nói thẳng hạn chế — em nghĩ nên trung thực:**
> "Free tier có hai hạn chế em ghi rõ trong README chứ không giấu.
>
> Một là container **ngủ khi không dùng**, nên request đầu tiên sau một lúc sẽ chờ cold start.
> Đó là lý do trước khi quay em gọi `/health` một lần để đánh thức nó.
>
> Hai là ổ đĩa **ephemeral**, nên dữ liệu standup mất khi redeploy trừ khi mount volume vào
> `DATA_DIR`."

---
---

# CẢNH 4 — Agent Host (2 phút)

## Yêu cầu đề bài
> **Part 1 — Custom Agent Host (25%)**
> - LLM Engine: `qwen3.5:4b` via Ollama, base URL `http://localhost:11434/v1`
> - Configuration Loader: read standardized config file defining stdio and HTTP connections
> - Tool Aggregation & Merging: dynamically query servers, extract tool definitions, register into LLM context
> - Call Dispatcher: intercept tool-call requests, route to respective server, return structured results

Bốn gạch đầu dòng, cảnh này phải chạm đủ.

## Thao tác

Terminal 3:
```bash
npm run host
```

## 4.1 — Đọc banner khởi động

```
✓ Connected to http://localhost:11434/v1 using qwen3:4b
✓ code-analyzer (3 tools)
✓ team-log (3 tools)
✓ git-inspector (3 tools)
✓ 1 skill(s) from ./skills

10 tools in context (including use_skill).
```

**Giải thích từng dòng — bảng này nên nói ra miệng:**

| Dòng | Nghĩa là gì | Đáp ứng yêu cầu nào |
|---|---|---|
| `Connected to :11434` | Bắt tay Ollama qua REST OpenAI-compatible, và **đã kiểm tra model có tồn tại** | LLM Engine Configuration |
| `code-analyzer (3)` | Kết nối HTTP tới Terminal 1, gọi `tools/list`, đăng ký 3 tool | Tool Aggregation |
| `team-log (3)` | Kết nối HTTP + gửi Bearer header lấy từ `.env` | Tool Aggregation |
| `git-inspector (3)` | Host **tự spawn tiến trình con** qua stdio | Configuration Loader |
| `1 skill(s)` | Đọc `skills/*/SKILL.md`, nạp index vào system prompt | Skill Support |
| `10 tools` | 9 tool MCP + 1 tool `use_skill` do Host tự cung cấp | — |

**Ý cần nhấn:**
> "Ba dòng ✓ giữa là ba transport hoàn toàn khác nhau. Nhưng từ góc nhìn của Host, chúng **giống
> hệt nhau** — đều là một object `Client` của MCP SDK. Chỉ khác đối tượng transport truyền vào
> lúc kết nối. Đó là giá trị của việc có một giao thức chuẩn."

### Code: preflight — vì sao kiểm tra LLM trước

[packages/agent-host/src/llm.ts:48](packages/agent-host/src/llm.ts#L48):

```ts
async preflight(): Promise<{ ok: boolean; message: string }> {
  try {
    const models = await this.client.models.list();
    const available = models.data.map((model) => model.id);
    if (!available.some((id) => id === this.settings.model || id.startsWith(`${this.settings.model}`))) {
      return {
        ok: false,
        message:
          `Model '${this.settings.model}' is not available on ${this.settings.baseUrl}.\n` +
          `  Pulled models: ${available.join(", ") || "(none)"}\n` +
          `  Fix with: ollama pull ${this.settings.model}`,
      };
    }
    return { ok: true, message: `Connected to ${this.settings.baseUrl} using ${this.settings.model}` };
  } catch (error) {
    return { ok: false, message: `Could not reach the LLM at ${this.settings.baseUrl}: ...\n  Is Ollama running? Start it with: ollama serve` };
  }
}
```

> "Em kiểm tra LLM **trước khi** kết nối server, vì kết nối ba server mất vài giây và spawn cả
> tiến trình con. Nếu Ollama chưa chạy thì phát hiện sớm, báo luôn câu lệnh cần chạy để sửa,
> thay vì để người dùng chờ rồi mới lỗi."

## 4.2 — Configuration Loader

**Thao tác:** Mở [mcp_config.json](mcp_config.json).

```json
{
  "llm": {
    "baseUrl": "http://localhost:11434/v1",
    "model": "qwen3:4b",
    "temperature": 0.3,
    "maxIterations": 10,
    "extraBody": { "reasoning_effort": "none" }
  },
  "skillsPath": "./skills",
  "mcpServers": {
    "git-inspector": { "type": "stdio", "command": "node", "args": ["./packages/server-stdio/dist/index.js"], "cwd": "." },
    "code-analyzer": { "type": "http", "url": "http://localhost:3001/mcp" },
    "team-log": { "type": "http", "url": "http://localhost:3002/mcp",
                  "headers": { "Authorization": "Bearer ${MCP_API_KEY}" } }
  }
}
```

### Cơ chế 1: schema giống Claude Desktop — giải quyết luôn Part 4

[packages/agent-host/src/config.ts:13](packages/agent-host/src/config.ts#L13):

```ts
const StdioServerSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  disabled: z.boolean().default(false),
});

const HttpServerSchema = z.object({
  type: z.enum(["http", "streamable-http", "sse"]),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  disabled: z.boolean().default(false),
});

const ServerSchema = z.union([HttpServerSchema, StdioServerSchema]);
```

> "Em cố ý làm schema này **giống hệt định dạng `claude_desktop_config.json`**.
>
> Đây là một quyết định thiết kế chứ không phải trùng hợp. Nhờ nó, **một cấu trúc file duy nhất
> mô tả được server cho cả hai host**. Em giải quyết yêu cầu tương thích song song ở Part 4 bằng
> một quyết định thiết kế, thay vì phải viết và bảo trì hai bộ config khác nhau.
>
> Zod dùng `z.union` để phân biệt hai loại: có `url` thì là HTTP, có `command` thì là stdio."

### Cơ chế 2: bí mật không nằm trong git

[packages/agent-host/src/config.ts:65](packages/agent-host/src/config.ts#L65):

```ts
function expandEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (match, name: string) => {
      const resolved = process.env[name];
      if (resolved === undefined) {
        console.warn(`[config] ${match} is referenced in the config but not set in the environment...`);
        return match;
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map(expandEnv);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandEnv(v)]));
  }
  return value;
}
```

> "Đoạn này xử lý bí mật theo kiểu placeholder. Khi demo, em chỉ cần chỉ vào chuỗi
> `${MCP_API_KEY}` trong config và nói rằng host sẽ tự thay bằng giá trị thật từ môi trường,
> nên key không bao giờ nằm cứng trong file commit."

> "Chỉ vào dòng `"Authorization": "Bearer ${MCP_API_KEY}"` trong config.
>
> File config **commit lên git** chỉ chứa placeholder `${MCP_API_KEY}`. Key thật nằm trong
> `.env`, và `.env` bị gitignore. Host thay thế lúc đọc config, đệ quy qua cả object lồng nhau
> và mảng.
>
> Nếu biến chưa được set, em cảnh báo rõ ràng chứ không thay bằng chuỗi rỗng — vì `Bearer ` với
> token rỗng sẽ gây lỗi 401 rất khó truy nguyên."

### Cơ chế 3: validate bằng Zod, báo lỗi tử tế

[packages/agent-host/src/config.ts:87](packages/agent-host/src/config.ts#L87):

```ts
const parsed = ConfigSchema.safeParse(expandEnv(json));
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`${absPath} does not match the expected schema:\n${issues}`);
}
```

> "Config sai thì báo đúng **đường dẫn tới trường bị sai** và lý do, ví dụ
> `mcpServers.team-log.url: Invalid url`. Không phải một `TypeError` mơ hồ ở đâu đó sâu trong code."

## 4.3 — Tool Merging — trung tâm của Part 1

**Thao tác:** Gõ `/tools`.

Màn hình hiện các tool nhóm theo server, tên dạng `git-inspector__git_recent_commits`.

### Lời thoại — giải thích vì sao cần namespace

> "Đây là phần cốt lõi nhất của Agent Host.
>
> Vấn đề: LLM chỉ nhìn thấy **một danh sách phẳng** các function. Nó không có khái niệm 'server'.
>
> Giả sử em có hai server, một cái quản lý file và một cái quản lý database, và **cả hai đều có
> tool tên `search`**. Khi model gọi `search`, Host không biết phải gửi request về server nào.
> Mà model cũng không phân biệt được hai cái đó khác nhau.
>
> Giải pháp của em: đặt tên theo namespace `<server>__<tool>`, và giữ một **bảng dispatch** ánh
> xạ từ tên đầy đủ về đúng client sở hữu nó."

### Code

[packages/agent-host/src/mcp-manager.ts:102](packages/agent-host/src/mcp-manager.ts#L102):

```ts
const NS = "__";

private async indexTools(connection: Connection): Promise<void> {
  const { tools } = await connection.client.listTools();
  for (const tool of tools) {
    const qualifiedName = `${connection.name}${NS}${tool.name}`;
    this.catalog.set(qualifiedName, {
      qualifiedName,
      serverName: connection.name,     // ← để biết gọi về server nào
      toolName: tool.name,             // ← tên thật để gửi cho server
      description: tool.description ?? tool.title ?? tool.name,
      inputSchema: tool.inputSchema,
    });
  }
}
```

> "Ở đoạn này em sẽ giải thích vì sao phải namespace tool. Nếu không thêm tiền tố server,
> model sẽ thấy một danh sách tool phẳng và rất dễ gọi nhầm. Namespace vừa tránh đụng tên,
> vừa cho Host biết phải định tuyến request về client nào."

> "`catalog` vừa là danh sách tool để đưa cho model, vừa là bảng dispatch. Mỗi entry nhớ hai
> thứ: **server nào sở hữu** và **tên thật của tool** ở server đó.
>
> Vì sao dùng hai dấu gạch dưới? Vì OpenAI chỉ cho phép tên function khớp `[A-Za-z0-9_-]`. Dấu
> `__` an toàn; dấu chấm, dấu hai chấm, dấu gạch chéo đều không hợp lệ."

### Code: chuyển MCP schema sang OpenAI

[packages/agent-host/src/llm.ts:95](packages/agent-host/src/llm.ts#L95):

```ts
export function toOpenAiTool(entry: CatalogEntry): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: sanitizeToolName(entry.qualifiedName),
      description: `[${entry.serverName}] ${entry.description}`,
      parameters: entry.inputSchema as Record<string, unknown>,
    },
  };
}
```

> "Việc chuyển đổi rất nhẹ, và đó là điểm hay của MCP: **`inputSchema` vốn đã là JSON Schema**
> — đúng định dạng mà OpenAI function calling cần. Em chỉ đổi tên và thêm tiền tố tên server
> vào description, để model biết tool này đến từ đâu.
>
> Nếu MCP dùng một định dạng schema riêng thì chỗ này sẽ phải viết một converter phức tạp."

### Code: kết nối song song, chịu lỗi

[packages/agent-host/src/mcp-manager.ts:56](packages/agent-host/src/mcp-manager.ts#L56):

```ts
async connectAll(): Promise<void> {
  const entries = Object.entries(this.config.mcpServers).filter(([, s]) => !s.disabled);

  await Promise.all(
    entries.map(async ([name, server]) => {
      try {
        const connection = await this.connect(name, server);
        this.connections.set(name, connection);
        await this.indexTools(connection);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.failures.push({ server: name, reason });
      }
    }),
  );
}
```

> "Hai điểm.
>
> Một là kết nối **song song** bằng `Promise.all`, không phải tuần tự. Ba server kết nối cùng
> lúc nên khởi động nhanh hơn hẳn.
>
> Hai là **một server chết không làm chết cả Host**. Lỗi được bắt riêng cho từng server, ghi vào
> mảng `failures` rồi bỏ qua. Đó là lý do lúc nãy khi server `team-log` chưa bật, Host vẫn chạy
> với hai server còn lại và báo `✗ team-log`. Demo chạy được với hai trên ba server vẫn hơn là
> không demo được gì."

### Code: một Client, hai transport

[packages/agent-host/src/mcp-manager.ts:75](packages/agent-host/src/mcp-manager.ts#L75):

```ts
private async connect(name: string, server: ServerConfig): Promise<Connection> {
  const client = new Client({ name: "hw-agent-host", version: "1.0.0" }, { capabilities: {} });

  if (isHttpServer(server)) {
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers },      // ← Bearer token đi vào đây
    });
    await client.connect(transport);
    return { name, client, close: () => transport.close() };
  }

  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd: server.cwd ? resolveFromConfig(this.config, server.cwd) : undefined,
    env: { ...(process.env as Record<string, string>), ...(server.env ?? {}) },
    stderr: "pipe",
  });
  await client.connect(transport);
  return { name, client, close: () => transport.close() };
}
```

> "Đây là chỗ minh hoạ rõ nhất ý em nói lúc mở đầu: **cùng một class `Client`**, chỉ khác đối
> tượng transport. Phần code phía sau — `listTools`, `callTool`, `listResources` — hoàn toàn
> không cần biết server đang chạy trên transport nào.
>
> Chú ý dòng `env`: tiến trình con **kế thừa toàn bộ môi trường của Host** rồi mới ghi đè bằng
> `env` riêng trong config. Nhờ vậy biến như `DEFAULT_REPO_PATH` tới được server con mà không
> phải khai lại."

## 4.4 — Resource và prompt cũng được gộp

**Thao tác:** Gõ `/resources`, rồi `/prompts`.

### Output sẽ thấy

```
you › /resources
  codeanalyzer://config/settings   [code-analyzer]  settings
  gitinspector://config/settings   [git-inspector]  settings
  teamlog://config/settings        [team-log]       settings
Read one with: /resources <uri>

you › /prompts
  standup_report  [git-inspector]  Prompt template that turns a repository's
                                   recent commits into a daily standup update.
```

### Đọc output này như thế nào

**Ba dòng `/resources`** — mỗi dòng là một resource, ba cột: **URI định danh**, **server nào
cung cấp**, **tên hiển thị**. Có đúng ba dòng vì cả ba server đều khai báo resource cấu hình
của mình.

> "Điểm cần nhấn ở đây là **scheme của URI do server tự đặt** — `gitinspector://`,
> `codeanalyzer://`, `teamlog://` không phải scheme chuẩn của internet, chúng chỉ có ý nghĩa
> trong phạm vi server đó. Và vì Host của em gộp resource từ cả ba server vào một danh sách,
> nên em phải giữ lại thông tin **resource này thuộc server nào** — đó là cột trong ngoặc vuông.
> Không có nó thì lúc `readResource(uri)` Host không biết định tuyến về đâu.
>
> Khác biệt bản chất so với tool: **resource là đọc dữ liệu, không có tác dụng phụ, do người
> dùng chủ động chọn; tool là hành động, có thể gây tác dụng phụ, do model chủ động gọi.**"

**Một dòng `/prompts`** — chỉ `git-inspector` khai báo prompt template.

> "Prompt template là hội thoại viết sẵn do server cung cấp, người dùng chủ động kích hoạt — ở
> Claude Desktop nó hiện ra thành slash command. Nó **không phải tool**: server không thực thi
> gì cả, chỉ trả về danh sách message đã dựng sẵn để nhét vào context.
>
> Đây là cách server đóng gói know-how: người viết server hiểu dữ liệu của mình nhất, nên họ
> cũng biết cách hỏi model hiệu quả nhất."

### Vì sao phải bắt lỗi

> "Đề bài yêu cầu server có resource và prompt. Em không dừng ở chỗ Inspector đọc được — **Host
> của em cũng gọi `listResources()` và `listPrompts()` trên tất cả server và gộp lại**.
>
> Ở đây có một chi tiết: server nào không khai báo capability resource sẽ throw khi gọi
> `listResources`. Em bắt lỗi đó và bỏ qua, vì không có resource **không phải là lỗi**."

Cụ thể: trong handshake `initialize`, server tự khai báo mình hỗ trợ những gì —

```json
{"capabilities": {"tools": {}, "resources": {}, "prompts": {}}}
```

Server nào **không** khai `resources` mà client vẫn gọi `listResources()` thì SDK trả lỗi
JSON-RPC **`-32601 Method not found`**. Vì Host gọi mù trên tất cả server nên phải bọc
`try/catch` từng server một:

[packages/agent-host/src/mcp-manager.ts:189](packages/agent-host/src/mcp-manager.ts#L189):

```ts
for (const connection of this.connections.values()) {
  try {
    const { resources } = await connection.client.listResources();
    for (const resource of resources) {
      found.push({ server: connection.name, uri: resource.uri, name: resource.name });
    }
  } catch {
    // Servers that declare no resource capability throw here. Not an error.
  }
}
```

**Câu nên nói thêm để ăn điểm — nếu bị hỏi "sao không kiểm tra trước?":**

> "Bắt lỗi là phương án **phòng thủ**. Phương án đúng giao thức hơn là đọc `capabilities` mà
> server trả về lúc `initialize`, rồi **chỉ gọi khi server có khai báo** — vừa tránh một vòng
> request thừa, vừa phân biệt được 'server không hỗ trợ' với 'server hỗ trợ nhưng lỗi thật'.
> Em chọn `try/catch` vì nó chịu được cả trường hợp server khai capability nhưng cài thiếu, còn
> kiểm tra capability trước thì không."

---
---

# CẢNH 5 — Skill chạy end-to-end (3 phút)

## Yêu cầu đề bài
> **Part 3 — Skill System Integration (15%)**
> - System Prompt Skill Index: dynamic index summarizing all skills with name and description
> - Skill Dispatch Tool: `use_skill(skill_name)` retrieving full instructions from SKILL.md
> - Skill Definition: at least ONE custom skill, multi-step workflow invoking own MCP tools
> - Triggering: must trigger reliably from plain natural language, without slash commands

## 5.1 — Giải thích cơ chế TRƯỚC khi chạy

Vì bước chạy mất vài phút, nên giải thích trước rồi vừa chờ vừa thuyết minh.

**Thao tác:** Gõ `/skills`.

**Lời thoại — đây là phần lý thuyết quan trọng nhất:**

> "Skill Engine hoạt động theo nguyên tắc **progressive disclosure** — tiết lộ dần, chia hai tầng.
>
> **Tầng một — lúc khởi động.** Host quét thư mục `skills/`, đọc frontmatter YAML của mỗi file
> `SKILL.md`, và chèn **chỉ `name` và `description`** vào system prompt. Chỉ khoảng một dòng cho
> mỗi skill. Rất rẻ, luôn có sẵn trong context, và đủ để model nhận ra một yêu cầu có khớp với
> skill nào không.
>
> **Tầng hai — khi cần.** Nội dung đầy đủ của SKILL.md **chỉ được nạp khi model gọi `use_skill`**.
> Skill của em dài 3.4 KB. Nếu nhét thẳng vào system prompt thì nó chiếm context ngay cả khi
> người dùng chỉ hỏi 'hôm nay thời tiết thế nào'.
>
> Và đây chính là **câu trả lời cho yêu cầu 'trigger từ ngôn ngữ tự nhiên'**: model không cần
> slash command, vì nó đã có sẵn description trong system prompt để đối chiếu với yêu cầu."

### Code: tầng một — sinh skill index

[packages/agent-host/src/skills.ts:85](packages/agent-host/src/skills.ts#L85):

```ts
export function renderSkillIndex(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const rows = skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");

  return [
    "## Available skills",
    "",
    rows,
    "",
    "When the user's request matches one of these skills, your FIRST action must be to call",
    "the `use_skill` tool with that skill's name. It returns step-by-step instructions.",
    "Follow those instructions exactly, calling the tools they name in the order given.",
    "Do not guess the steps of a skill from its description alone.",
  ].join("\n");
}
```

> "Đây là phần em sẽ nói khi giải thích skill: host không nạp toàn bộ nội dung skill ngay từ
> đầu, mà chỉ chèn một danh sách ngắn vào system prompt để model biết skill nào đang tồn tại.
> Khi có khớp ngữ nghĩa thì mới gọi `use_skill`."

> "Bốn dòng hướng dẫn cuối mới là phần **làm việc thật**, không phải danh sách skill.
>
> Em phát hiện điều này khi test: **không có câu 'FIRST action must be to call use_skill'**, model
> 4B sẽ đọc description rồi **tự bịa ra các bước** thay vì nạp hướng dẫn thật. Nó thấy chữ
> 'standup' và 'git commits' rồi tự suy ra quy trình — thường là sai.
>
> Và câu cuối `'Do not guess the steps from its description alone'` là để chặn đúng hành vi đó."

### Code: system prompt hoàn chỉnh

[packages/agent-host/src/agent-loop.ts:74](packages/agent-host/src/agent-loop.ts#L74):

```ts
private systemPrompt(): string {
  const { mcp, skills, defaultRepoPath } = this.options;
  const servers = mcp.serverNames.join(", ") || "(none connected)";

  return [
    "You are an engineering assistant with access to tools from several MCP servers.",
    "",
    `Connected servers: ${servers}.`,
    `Tool names are namespaced as <server>__<tool>. There are ${mcp.listTools().length} tools available.`,
    "",
    "Rules:",
    "- Use tools to obtain facts. Never invent commit hashes, file paths, dates, or counts.",
    `- When a tool needs a repository path and the user did not name one, use: ${defaultRepoPath}`,
    "- If a tool result says it is an error, read the message, fix the arguments, and try once more.",
    "  If it fails again, tell the user plainly what failed. Do not pretend it succeeded.",
    "- When you have the information you need, answer directly. Do not call more tools.",
    "",
    renderSkillIndex(skills),
  ].filter(Boolean).join("\n");
}
```

> "System prompt được **sinh động** từ trạng thái thực tế: tên server đang kết nối, số tool đang
> có, danh sách skill đang nạp. Không phải chuỗi hardcode.
>
> Ba luật đáng chú ý:
>
> Luật *'Never invent commit hashes'* — chống model bịa dữ liệu thay vì gọi tool.
>
> Luật về `defaultRepoPath` — nhờ nó mà người dùng chỉ cần nói 'my local commits' chứ không phải
> gõ đường dẫn tuyệt đối.
>
> Luật về lỗi — bảo model đọc thông báo lỗi và thử lại một lần, và **không được giả vờ là thành
> công**. Đây là chỗ khép lại vòng tròn với `isError` ở Cảnh 1."

### Code: tầng hai — tool `use_skill`

[packages/agent-host/src/agent-loop.ts:21](packages/agent-host/src/agent-loop.ts#L21):

```ts
const USE_SKILL_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "use_skill",
    description:
      "Load the full step-by-step instructions for a named skill. Call this first whenever the user's request matches a skill listed in the system prompt.",
    parameters: {
      type: "object",
      properties: {
        skill_name: { type: "string", description: "The exact name of the skill, as listed under 'Available skills'." },
      },
      required: ["skill_name"],
    },
  },
};
```

Và cách nó được đăng ký — [agent-loop.ts:62](packages/agent-host/src/agent-loop.ts#L62):

```ts
constructor(private readonly options: AgentOptions) {
  this.tools = [USE_SKILL_TOOL];        // ← tool của Host, đứng đầu danh sách

  for (const entry of options.mcp.listTools()) {
    const sanitized = sanitizeToolName(entry.qualifiedName);
    this.nameMap.set(sanitized, entry.qualifiedName);
    this.tools.push(toOpenAiTool(entry));    // ← rồi tới tool của các server
  }

  this.messages.push({ role: "system", content: this.systemPrompt() });
}
```

> "`use_skill` **không đến từ server MCP nào** — Host tự implement. Nhưng nó được đẩy vào **cùng
> mảng `tools`** với tool của server, nên model thấy một mặt phẳng thống nhất. Model không cần
> biết tool nào của Host, tool nào của server.
>
> Đây cũng là lý do con số hiện ra là **10 tool** chứ không phải 9."

## 5.2 — Mở SKILL.md cho người chấm xem

**Thao tác:** Mở [skills/daily-standup/SKILL.md](skills/daily-standup/SKILL.md).

Chỉ vào frontmatter:

```yaml
---
name: daily-standup
description: Generate a daily standup or status report from a local git repository. Use this
  whenever the user asks what they worked on, wants a status report, a daily update, a standup,
  a summary of recent commits, or asks to log their progress for the team.
---
```

> "Description này được viết **dày các từ khoá kích hoạt**: 'daily status report', 'standup',
> 'what they worked on', 'summary of recent commits', 'log their progress'.
>
> Đây không phải mô tả cho người đọc — nó là **tín hiệu để model nhận diện**. Càng nhiều cách
> diễn đạt khác nhau thì càng nhiều kiểu câu hỏi kích hoạt được skill."

Cuộn xuống phần Steps:

> "Sáu bước. Mỗi bước gọi đích danh một tool MCP em tự viết, và **trải qua cả ba server**:
> bước 1–2 dùng server stdio, bước 3 dùng server HTTP local, bước 5 dùng server public.
>
> Đề bài yêu cầu skill phải *'invoke your own custom MCP tools'* — đây chính là chỗ đó."

Chỉ vào bước 5:

```markdown
### 5. Record it — do not skip this step

You have not finished the skill until `team-log__log_standup` has been called and returned
`"saved": true`. Do not write your final answer before that call.
```

> "Chỗ này em viết mạnh như vậy vì lần test đầu **model bỏ qua bước cuối**. Nó viết xong bản
> standup rồi trả lời luôn, không ghi vào log.
>
> Model 4B có xu hướng dừng khi thấy đã 'trả lời được câu hỏi'. Nên em phải nói rõ điều kiện
> hoàn thành: chưa gọi `log_standup` và nhận `saved: true` thì chưa xong."

Chỉ vào phần xử lý trường hợp biên:

```markdown
If the range's two halves are the same hash (`abc123..abc123`, which happens when there is
only one commit), that range is empty by definition. Use `abc123~1..abc123` instead.
```

> "Đây cũng là lỗi phát hiện lúc test: khi repo chỉ có một commit thì `range` là
> `abc123..abc123`, và `git diff` trên khoảng đó trả về rỗng. Em ghi cách xử lý thẳng vào skill."

## 5.3 — Chạy thật

**Thao tác:** Gõ chính xác:
```
Generate my daily status report based on my local commits
```

**Lời thoại trước khi Enter:**
> "Không có slash command. Không có `/use-skill`. Chỉ là một câu tiếng Anh bình thường, đúng như
> đề bài yêu cầu."

**Thuyết minh theo từng dòng hiện ra:**

| Màn hình | Lời thoại |
|---|---|
| `→ use_skill {"skill_name":"daily-standup"}` | "Model **tự nhận ra** yêu cầu khớp với skill và gọi `use_skill`. Đây là tầng hai của progressive disclosure." |
| `← use_skill Loaded skill (3478 chars)` | "3.4 KB hướng dẫn vừa vào context. Trước lệnh gọi này, model chỉ có một dòng description." |
| `→ git-inspector__git_recent_commits` | "Bước 1 của skill. Namespace `git-inspector` cho biết đây là **server stdio**." |
| `→ git-inspector__git_diff_stats` | "Bước 2. Chú ý nó truyền đúng `range` mà bước 1 trả về — dữ liệu chảy từ tool này sang tool kia." |
| `→ code-analyzer__find_todos` | "Bước 3. Namespace đổi — giờ là **server HTTP local**, transport hoàn toàn khác." |
| `→ team-log__log_standup` | "Bước 4. **Server public**, request này có kèm Bearer token." |
| Bản standup markdown | "Một câu tiếng Anh vừa điều khiển 5 lệnh gọi tool qua 3 transport khác nhau." |

## 5.4 — Cơ chế: vòng lặp dispatch

Vừa chờ vừa mở [packages/agent-host/src/agent-loop.ts:106](packages/agent-host/src/agent-loop.ts#L106):

```ts
async send(userMessage: string): Promise<string> {
  this.messages.push({ role: "user", content: userMessage });

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const reply = await llm.chat(this.messages, this.tools);
    const toolCalls = this.extractToolCalls(reply);

    if (toolCalls.length === 0) {
      // Model không gọi tool nữa → đây là câu trả lời cuối cùng
      const content = stripReasoning(reply.content ?? "");
      this.messages.push({ role: "assistant", content: reply.content ?? "" });
      return content || "(the model produced no text)";
    }

    this.messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: toolCalls });

    for (const call of toolCalls) {
      const outcome = await this.dispatch(call);
      this.messages.push({ role: "tool", tool_call_id: call.id, content: outcome });
    }
  }

  return `Stopped after ${maxIterations} tool-calling rounds without reaching an answer...`;
}
```

> "Đoạn này là vòng lặp điều phối trung tâm. Khi trình bày, em có thể nói ngắn gọn: model
> trả về tool call thì Host chạy tool, đẩy kết quả ngược lại vào hội thoại, rồi hỏi tiếp cho
> đến khi model không gọi tool nữa."

> "Vòng lặp rất đơn giản, và đó là chủ ý.
>
> Gửi toàn bộ hội thoại kèm danh sách tool cho model. Nếu model trả về `tool_calls` thì định
> tuyến từng cái về server sở hữu nó, rồi **đẩy kết quả vào hội thoại dưới dạng message
> `role: "tool"`** kèm `tool_call_id` để model biết kết quả này ứng với lệnh gọi nào. Rồi hỏi lại.
>
> Khi model không gọi tool nữa, nghĩa là nó đã đủ thông tin — đó là câu trả lời cuối.
>
> Giới hạn 10 vòng để tránh lặp vô hạn. Nếu chạm giới hạn thì báo rõ cho người dùng chứ không
> im lặng."

### Code: hàm dispatch

[packages/agent-host/src/agent-loop.ts:152](packages/agent-host/src/agent-loop.ts#L152):

```ts
private async dispatch(call: ChatCompletionMessageToolCall): Promise<string> {
  const rawName = call.function.name;

  let args: Record<string, unknown> = {};
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    const message = `Arguments for ${rawName} were not valid JSON. Re-issue the call with a valid JSON object.`;
    return `ERROR: ${message}`;
  }

  // Nhánh 1 — tool của Host
  if (rawName === "use_skill") {
    const skill = findSkill(skills, String(args.skill_name ?? ""));
    if (!skill) return `ERROR: No skill named '...'. Available skills: ...`;
    return `Instructions for the '${skill.name}' skill. Follow them step by step:\n\n${skill.body}`;
  }

  // Nhánh 2 — tool của server MCP
  const qualifiedName = this.nameMap.get(rawName) ?? rawName;
  const outcome = await mcp.callTool(qualifiedName, args);

  return outcome.isError ? `ERROR: ${outcome.text}` : outcome.text;
}
```

> "Đây là chỗ rất đáng giải thích: `use_skill` được xử lý ngay trong Host, còn tool MCP thì
> được tra qua bảng rồi mới gọi xuống server tương ứng. Em có thể nói đây là lớp cầu nối giữa
> mô hình ngôn ngữ và các server MCP khác nhau."

> "Hàm dispatch có hai nhánh: `use_skill` xử lý ngay tại Host, còn lại thì tra bảng và gọi qua
> MCP.
>
> Chú ý cả khi arguments không parse được thành JSON, em cũng trả về `ERROR:` để model sửa,
> chứ không throw."

### Hai chi tiết rút ra từ thực tế — nên nhấn mạnh

**Chi tiết 1 — truyền cờ `isError` sang model:**

```ts
return outcome.isError ? `ERROR: ${outcome.text}` : outcome.text;
```

> "Đây là chỗ khép lại vòng tròn với Cảnh 1.
>
> Vấn đề: định dạng tool message của OpenAI **không có trường nào để đánh dấu lỗi**. Chỉ có
> `role`, `tool_call_id`, và `content` là chuỗi. Cờ `isError` của MCP không có chỗ để đặt.
>
> Nên em đưa nó vào text với tiền tố `ERROR:`. Em test thấy model nhỏ **nhận ra ngay chữ ERROR
> đứng đầu** và sửa tham số; còn nếu lỗi bị chôn trong một JSON dài thì nó thường đọc lướt qua.
>
> Đây là ví dụ cho thấy hai giao thức — MCP và OpenAI function calling — không map 1-1 với nhau,
> và Host phải làm cầu nối."

**Chi tiết 2 — cứu tool call khi model viết sai chỗ:**

[packages/agent-host/src/agent-loop.ts:190](packages/agent-host/src/agent-loop.ts#L190):

```ts
private extractToolCalls(reply): ChatCompletionMessageToolCall[] {
  if (reply.tool_calls?.length) return reply.tool_calls;            // dạng 1 — đúng chuẩn

  const content = stripThinking(reply.content ?? "");
  const tagged = [...content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)]
    .map((m) => m[1]);                                              // dạng 2 — có thẻ bọc
  const candidates = tagged.length > 0 ? tagged : this.bareJsonCandidates(content);  // dạng 3

  // ... parse từng candidate thành ChatCompletionMessageToolCall
}
```

> "Qwen viết lệnh gọi tool theo **ba dạng khác nhau**, và cùng một model có lúc dùng dạng này,
> lúc dùng dạng kia:
>
> **Dạng một** — điền đúng vào trường `tool_calls` có cấu trúc. Đây là hợp đồng OpenAI, SDK tự
> hiểu.
>
> **Dạng hai** — viết thành text trong nội dung, bọc trong thẻ `<tool_call>{...}</tool_call>`.
> Đây là định dạng gốc của Qwen rò rỉ qua lớp tương thích OpenAI của Ollama.
>
> **Dạng ba** — xả thẳng một object JSON trần vào nội dung, không có thẻ bọc nào cả.
>
> Chỉ dạng một là SDK xử lý được. Nếu không cứu hai dạng còn lại, Host sẽ tưởng model đã trả lời
> xong và **in nguyên đống JSON ra cho người dùng** — tool không hề được gọi."

**Cái bẫy ở dạng ba — nên nói, vì nó cho thấy em có nghĩ tới hệ quả:**

```ts
const known = new Set(this.tools.map((t) => t.function.name));
// chỉ nhận khi `name` khớp một tool có thật trong catalogue
```

> "Dạng ba nguy hiểm hơn hai dạng kia vì nó **không có dấu hiệu nào để nhận biết**. Nếu em nhận
> bừa mọi object JSON, thì một câu trả lời hợp lệ tình cờ là JSON cũng sẽ bị đem đi gọi tool.
>
> Nên em thêm ràng buộc: chỉ coi là tool call khi trường `name` **khớp đúng tên một tool đang có
> trong catalogue**. Ngoài ra em cũng không đẩy đoạn text đó ngược vào lịch sử hội thoại — vì làm
> vậy là dạy model rằng in tool call ra text là chấp nhận được."
>
> "Em nghĩ đây là chi tiết đáng nói nhất về mặt kỹ thuật thực chiến: **khác biệt giữa demo chạy
> được và demo đứng hình** nhiều khi nằm ở những chỗ như thế này."

**Chi tiết 3 — chấp nhận tên tool thiếu namespace:**

[packages/agent-host/src/mcp-manager.ts:135](packages/agent-host/src/mcp-manager.ts#L135):

```ts
resolve(name: string): CatalogEntry | undefined {
  const exact = this.catalog.get(name);
  if (exact) return exact;

  const bareMatches = this.listTools().filter((entry) => entry.toolName === name);
  return bareMatches.length === 1 ? bareMatches[0] : undefined;
}
```

> "Model nhỏ hay quên namespace, gọi thẳng `find_todos` thay vì `code-analyzer__find_todos`.
>
> Em chấp nhận tên trần **nếu nó không nhập nhằng** — tức chỉ đúng một server có tool tên đó.
> Nếu hai server cùng có thì từ chối, vì đoán bừa còn tệ hơn báo lỗi.
>
> Không có xử lý này thì Host sẽ từ chối những lệnh gọi mà về bản chất là đúng."

## 5.5 — Chứng minh dữ liệu đã lưu thật

**Thao tác:** Gõ:
```
List my standup entries
```

> "Lệnh này gọi `team-log__list_standups`, đọc lại từ **server public** đúng bản standup vừa ghi.
>
> Đây là bằng chứng bước 5 thật sự chạy chứ không phải model bịa ra là đã lưu."

---
---

## CẢNH 6 — Host MCP thứ hai (1 phút)

## Yêu cầu đề bài
> **Part 4 — Dual Host Interoperability**
> Your custom MCP servers and skills must work seamlessly across two independent client
> environments: a second MCP client, and your custom Agent Host.

## Thao tác

Mở một MCP client thứ hai đã cấu hình cùng 3 server, rồi hỏi: *"write my standup"*.

## Lời thoại

> "Cùng ba server đó, giờ chạy trên một client MCP thứ hai. Không sửa một dòng code nào trong
> server — chỉ trỏ client đó tới cùng các endpoint.
>
> Và cùng một workflow SKILL.md. Điều quan trọng là workflow này không phụ thuộc vào một agent
> duy nhất; bất kỳ client nào hiểu MCP và hỗ trợ skill tương đương đều có thể dùng lại."

**Kết luận cảnh — ý quan trọng nhất:**
> "Điểm cần nhấn: **server và skill không phụ thuộc vào agent của em**. Chúng là MCP thuần. Host
> nào tuân thủ chuẩn cũng dùng được — client MCP thứ hai, Cursor, hay agent tự viết.
>
> Đó là toàn bộ lý do giao thức này tồn tại: viết server một lần, dùng ở mọi nơi. Giống như LSP
> đã làm với editor."

---
---

# KẾT — Tổng kết (30 giây)

> "Tóm lại, em đã xây dựng:
>
> Một **Agent Host** chạy LLM local, đọc config chuẩn, gộp tool từ nhiều server và định tuyến
> lệnh gọi.
>
> **Ba MCP server** trên ba transport: stdio, HTTP local, và HTTP public có xác thực — server
> stdio có đủ 3 tool, resource, prompt template và xử lý `isError` đúng chuẩn.
>
> Một **Skill Engine** kích hoạt bằng ngôn ngữ tự nhiên, điều phối tool qua cả ba server.
>
> Và tất cả **chạy được trên hai host độc lập**.
>
> Điểm em tâm đắc nhất là cách xử lý `isError`, vì nó là khác biệt giữa một agent gặp lỗi thì
> đứng im, và một agent đọc được thông báo lỗi rồi tự sửa. Đó là chỗ mà hiểu đúng đặc tả giao
> thức tạo ra khác biệt thật sự về hành vi."

---
---

# PHỤ LỤC A — Câu hỏi có thể bị hỏi

### "Vì sao dùng `qwen3:4b` mà không phải `qwen3.5:4b` như đề?"
> Tag `qwen3.5:4b` **không tồn tại** trên thư viện Ollama. Em dùng `qwen3:4b` theo đúng câu
> *"or equivalent lightweight model"* trong đề. Tên model cấu hình được qua biến `OLLAMA_MODEL`
> hoặc trường `llm.model` trong `mcp_config.json`, nên đổi sang model khác không cần sửa code.

### "Vì sao server stdio không cần bật tay?"
> Vì stdio transport nghĩa là **client spawn server thành tiến trình con** và giao tiếp qua
> stdin/stdout. Không có cổng mạng. Vòng đời server gắn với client.
>
> Hệ quả: trong server stdio, **stdout là kênh giao thức**, nên mọi log phải ghi ra stderr. Một
> dòng `console.log` lạc chỗ sẽ làm hỏng luồng JSON-RPC.

### "JSON-RPC là gì, và vì sao MCP dùng nó?"
> Một quy ước định dạng cho việc gọi hàm từ xa, mã hoá bằng JSON: `method` là tên thao tác,
> `params` là tham số, `id` để ghép request với response. MCP dùng JSON-RPC 2.0 làm **ngôn ngữ
> chung cho cả ba transport** — nhờ đó stdio và HTTP chỉ khác nhau ở *đường vận chuyển*, còn nội
> dung message hoàn toàn giống nhau.
>
> Với stdio, mỗi message là một dòng kết thúc bằng `\n` (newline-delimited JSON).

### "Vì sao dùng `execFile` mà không dùng `exec`?"
> `exec` đưa chuỗi cho shell diễn giải, nên `;` `|` `&&` `$(...)` có ý nghĩa đặc biệt — một
> `repo_path` độc hại là chạy được lệnh tuỳ ý. `execFile` không có shell trung gian: mỗi phần tử
> trong mảng argv là một tham số nguyên vẹn, ký tự đặc biệt chỉ còn là ký tự thường.
>
> Đánh đổi là mất glob và pipe của shell, nhưng ở đây không cần đến chúng — mà tham số thì đến
> từ LLM, vốn có thể bị prompt injection điều khiển.

### "`isError` khác gì với việc throw lỗi?"
> Throw ra ngoài sẽ thành **JSON-RPC protocol error** — model không nhìn thấy, chỉ host xử lý.
>
> `isError: true` là response **thành công ở tầng giao thức** nhưng đánh dấu tool thất bại, nên
> model đọc được thông báo và tự sửa tham số.
>
> Gần như mọi lỗi tool gặp phải đều thuộc loại thứ hai, nên em bọc tất cả handler bằng `safeTool`.

### "Vì sao phải namespace tên tool?"
> Model chỉ thấy **một danh sách phẳng**, không có khái niệm server. Hai server có thể cùng đặt
> tên tool là `search`. Namespace vừa tránh trùng tên, vừa là **khoá để Host định tuyến ngược**
> về đúng server.
>
> Dùng `__` vì OpenAI chỉ cho phép tên function khớp `[A-Za-z0-9_-]`.

### "Nếu một server chết thì sao?"
> `connectAll()` bắt lỗi **từng server riêng biệt**, ghi vào mảng `failures` rồi bỏ qua. Host vẫn
> chạy với các server còn lại và báo `✗` cho server hỏng.

### "Vì sao dùng `timingSafeEqual` mà không dùng `===`?"
> So sánh chuỗi thông thường **dừng ở ký tự khác nhau đầu tiên**, nên thời gian phản hồi tiết lộ
> được bao nhiêu ký tự đầu đã đúng. Gửi nhiều request rồi lấy trung bình là dò được từng ký tự.
> `timingSafeEqual` luôn so hết toàn bộ độ dài.

### "Skill khác gì prompt template của MCP?"
> Đây là câu hỏi hay nhất, và câu trả lời làm rõ ranh giới kiến trúc:
>
> **Prompt template** do **server** cung cấp qua giao thức MCP. Client phải **chọn thủ công**.
> Nó chỉ điều phối được tool của chính server đó.
>
> **Skill** nằm ở phía **host**, không thuộc giao thức MCP. Model **tự chọn** dựa trên description
> trong system prompt, và nó **điều phối được tool từ nhiều server khác nhau** — như skill của
> em dùng cả ba server.

### "Vì sao gộp resource và prompt vào Host, đề đâu có bắt?"
> Đề yêu cầu server phải có resource và prompt. Nhưng nếu Host không đọc được chúng thì chúng chỉ
> tồn tại cho Inspector. Em cài `listResources` và `listPrompts` để chứng minh Host là một MCP
> client **đầy đủ**, không chỉ biết gọi tool.

### "Vì sao mỗi HTTP session tạo một `McpServer` mới?"
> Vì Streamable HTTP là stateful. Dùng chung một instance thì notification của client này có thể
> rò sang client khác. Tạo mới cho mỗi session là cách cô lập đơn giản nhất.

---

# PHỤ LỤC B — Xử lý sự cố khi đang quay

| Hiện tượng | Nguyên nhân & cách sửa |
|---|---|
| `✗ team-log Invalid API key` | **Luôn là** server cũ còn giữ cổng, không phải sai key. `lsof -ti:3002 \| xargs kill -9` rồi bật lại Terminal 2 |
| `✗ code-analyzer ECONNREFUSED` | Terminal 1 chưa chạy |
| `FATAL: port 3001 is already in use` | Chạy đúng lệnh mà nó gợi ý |
| Model bỏ bước `log_standup` | Hỏi tiếp *"Now log that standup to the team log."* Model 4B đôi khi bỏ bước cuối |
| Đường dẫn báo lỗi lạ, lặp hai lần | Khoảng trắng thừa khi dán — đã có `normalizePath` xử lý, build lại nếu chưa |
| Model trả về JSON thô thay vì câu trả lời | Tool call bị viết vào text — `extractToolCalls` xử lý, build lại nếu chưa |
| Chạy rất chậm | Bình thường, ~1 phút/vòng. Xem phần tốc độ trong [DEMO.md](DEMO.md) |

---

# PHỤ LỤC C — Checklist trước khi bấm ghi

- [ ] `source ~/.nvm/nvm.sh && nvm use 22` ở **mọi** terminal
- [ ] `lsof -ti:3001,3002 | xargs kill -9` — dọn cổng
- [ ] `npm run build` — kiểm tra đủ 5 file dist
- [ ] Ollama đang chạy, model đã pull
- [ ] **Đã làm nóng model** — tránh 90 giây màn hình đứng im
- [ ] `git log --oneline -5` có commit trong vòng 1 ngày
- [ ] Terminal 1 và 2 đang chạy, thấy đủ dòng log khởi động
- [ ] `PUBLIC_URL` và `MCP_API_KEY` đã export ở Terminal 4
- [ ] Server public đã thức dậy: `curl $PUBLIC_URL/health`
- [ ] Phóng to font terminal cho dễ đọc trên video
- [ ] Mở sẵn các file cần chỉ vào: `mcp_config.json`, `SKILL.md`, `result.ts`, `mcp-manager.ts`
