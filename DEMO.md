# Demo Runbook on Windows — 22127086

Tài liệu này là runbook để setup và demo repo trên Windows bằng PowerShell. Mục tiêu là đi từ clone sạch đến một buổi demo ổn định, có thể chạy hoàn toàn trên máy cục bộ mà không cần lệnh bash/macOS.

## 0. Repo này làm gì

Repo gồm 4 phần chính:

- `packages/agent-host`: agent host, đọc `mcp_config.json`, nối tool từ nhiều server và chạy skill `use_skill`.
- `packages/server-stdio`: MCP server qua stdio, tên `git-inspector`, có 3 tool, 1 resource và 1 prompt.
- `packages/server-local-http`: MCP server HTTP cục bộ, tên `code-analyzer`, có 3 tool và 1 resource.
- `packages/server-public-http`: MCP server HTTP công khai, tên `team-log`, có 3 tool và auth bằng `MCP_API_KEY`.

Luồng demo tốt nhất là: host khởi động, tự nối 3 server, rồi khi nhập câu tự nhiên `Generate my daily status report based on my local commits`, model gọi `use_skill`, sau đó gọi tool qua cả 3 server và cuối cùng ghi standup vào team log.

## 1. Yêu cầu trước khi setup

- Windows 10/11.
- Node.js 20+.
- Git.
- Ollama đã cài và đang chạy.

Kiểm tra nhanh trong PowerShell:

```powershell
node --version
npm --version
git --version
curl.exe http://localhost:11434/api/tags
```

Nếu `curl.exe` báo lỗi, mở Ollama trước rồi thử lại.

## 2. Setup lần đầu trên Windows

1. Mở PowerShell tại thư mục repo.

```powershell
Set-Location D:\YEAR4\22127086
```

2. Cài dependencies và build toàn bộ workspace.

```powershell
npm install
npm run build
```

3. Tạo `.env` ở root repo. File này không commit lên git.

```powershell
$apiKey = node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
@"
MCP_API_KEY=$apiKey
DEFAULT_REPO_PATH=D:\YEAR4\22127086
OLLAMA_MODEL=qwen3:4b
"@ | Set-Content .env -Encoding utf8
```

4. Pull model của Ollama.

```powershell
ollama pull qwen3:4b
```

Nếu máy yếu và bạn muốn demo nhanh hơn, đổi tạm model trong session host sang `qwen2.5:7b` ở bước chạy host.

5. Xác nhận build xong và `.env` đã có key.

```powershell
Get-ChildItem packages/*/dist/index.js | Select-Object FullName
Get-Content .env | Select-String '^MCP_API_KEY='
```

## 3. Cách chạy demo

Mở 4 terminal PowerShell, đều đứng trong `D:\YEAR4\22127086`.

### Terminal 1 — local HTTP server

```powershell
npm run start:local-http
```

Server này chạy ở `http://localhost:3001/mcp`.

### Terminal 2 — public HTTP server

```powershell
npm run start:public-http
```

Server này chạy ở `http://localhost:3002/mcp` và sẽ đọc `MCP_API_KEY` từ `.env`.

### Terminal 3 — agent host

```powershell
npm run host
```

Nếu muốn chạy nhanh hơn trong buổi demo:

```powershell
$env:OLLAMA_MODEL = 'qwen2.5:7b'
npm run host
```

### Terminal 4 — Inspector và lệnh kiểm tra

```powershell
npm run inspect:stdio
```

Sau đó mở Inspector trên browser, connect và demo stdio server trước. Khi cần kiểm tra HTTP local hoặc HTTP public, dùng `npm run inspect` rồi chọn transport phù hợp.

## 4. Những điểm cần show khi demo

### 4.1. Kiểm tra stdio server trong Inspector

Trong Inspector, show theo thứ tự này:

1. Tab Tools: 3 tool `git_recent_commits`, `git_diff_stats`, `git_search_files`.
2. Tab Resources: `gitinspector://config/settings`.
3. Tab Prompts: `standup_report`.
4. Chạy `git_recent_commits` với `repo_path = D:\YEAR4\22127086` và `since = 7 days ago`.
5. Chạy lại với `repo_path = D:\nope` để show `isError`.

Nếu muốn nói ngắn gọn với người xem: lỗi tool không làm đứt MCP connection, nó quay về như một kết quả có thể đọc được.

### 4.2. Kiểm tra local HTTP server

Trong `npm run inspect`, chọn:

- Transport: Streamable HTTP
- URL: `http://localhost:3001/mcp`

Rồi show 3 tool của `code-analyzer` và resource `codeanalyzer://config/settings`.

### 4.3. Kiểm tra public HTTP server

Nếu demo public server local, hãy dùng `curl.exe` để tránh alias PowerShell.

```powershell
$publicUrl = 'http://localhost:3002'
$apiKey = (Get-Content .env | Select-String '^MCP_API_KEY=').Matches.Value.Split('=',2)[1]

curl.exe -s -o NUL -w "HTTP %{http_code}`n" -X POST "$publicUrl/mcp" -H 'content-type: application/json' -d '{}'

curl.exe -s -i -X POST "$publicUrl/mcp" `
  -H "Authorization: Bearer $apiKey" `
  -H 'content-type: application/json' `
  -H 'accept: application/json, text/event-stream' `
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Khi connect bằng Inspector vào server này, thêm header:

```text
Authorization: Bearer <MCP_API_KEY>
```

### 4.4. Demo end-to-end trong host

Trong terminal của host, show các lệnh sau:

```text
/tools
/resources
/prompts
/skills
```

Sau đó nhập đúng câu này:

```text
Generate my daily status report based on my local commits
```

Luồng bạn cần thấy là:

1. `use_skill`
2. `git-inspector__git_recent_commits`
3. `git-inspector__git_diff_stats`
4. `code-analyzer__find_todos`
5. `team-log__log_standup`

Cuối cùng, nhập:

```text
List my standup entries
```

để show rằng dữ liệu vừa ghi đã được đọc lại từ team log.

## 5. Những câu nói ngắn nên dùng khi demo

- `Agent host` chỉ merge tool từ nhiều MCP server thành một danh sách phẳng.
- `use_skill` chỉ load `SKILL.md` khi thật sự cần, nên context ban đầu nhẹ.
- `team-log` yêu cầu bearer token, còn `/health` vẫn mở.
- `isError` cho phép model nhìn thấy lỗi tool và tự sửa input.

## 6. Troubleshooting nhanh trên Windows

- Nếu `npm run host` báo không kết nối được Ollama, kiểm tra `curl.exe http://localhost:11434/api/tags` trước.
- Nếu port 3001 hoặc 3002 bị chiếm, tìm PID rồi dừng nó:

```powershell
Get-NetTCPConnection -LocalPort 3001,3002 -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess,State
Stop-Process -Id <PID> -Force
```

- Nếu `team-log` thoát ngay khi start, kiểm tra lại `MCP_API_KEY` trong `.env` và đảm bảo độ dài đủ lớn.
- Nếu model quá chậm, đổi tạm sang `qwen2.5:7b` cho buổi demo.

## 7. Nếu cần demo public server trên Render

1. Push repo lên GitHub.
2. Vào Render và tạo service từ `render.yaml`.
3. Đặt biến môi trường `MCP_API_KEY` trên Render.
4. Endpoint sẽ là `https://<service>.onrender.com/mcp`.
5. Trước khi quay, gọi một lần:

```powershell
curl.exe https://<service>.onrender.com/health
```

Free tier có thể sleep khi idle, nên phải gọi `/health` để đánh thức trước khi show MCP call đầu tiên.

## 8. Checklist trước khi bấm record

- `npm run build` đã chạy xong.
- `ollama pull qwen3:4b` đã có model.
- `.env` có `MCP_API_KEY` và `DEFAULT_REPO_PATH` đúng.
- Terminal 1, 2, 3 đang chạy ổn.
- Inspector đã connect được với stdio server.
- Repo có đủ commit gần đây để skill `daily-standup` tạo được nội dung.
