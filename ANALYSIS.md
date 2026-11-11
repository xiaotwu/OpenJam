# OpenJam 项目全面分析

对 OpenJam（自托管协作白板）当前代码库的系统性梳理。基于 main 分支（commit `61b0b9a`）。

## 一、项目概览

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 19 + TypeScript + Vite 7 + Tailwind 4 | 单页应用，canvas 自绘 + CRDT 协作 |
| 后端 | Go 1.22 + Gin | REST API + WebSocket，`go:embed` 嵌入前端 |
| 存储 | PostgreSQL（主数据）、Redis（缓存/多实例 PubSub，可选）、MinIO（导出文件，可选） | |
| 部署 | Dockerfile（多阶段）、docker-compose、Makefile 单二进制 | |

核心数据流：前端 `ElementStore`（操作日志 CRDT）→ WebSocket 广播实时操作 → `POST /rooms/:id/save` 落库整板快照到 `rooms.board_data`。

## 二、确认可编译

- 前端 `tsc -b`：通过（strict 模式无报错）。
- 后端 `go build ./...` / `go vet ./...`：通过。

## 三、存在的主要问题（按严重度排序）

### 🔴 P0 — 功能正确性 / 数据安全

#### 1. `MINIO_BUCKET` 配置被忽略（环境变量与代码不一致）
- `docker-compose.yml`、`server/.env.example` 都声明了 `MINIO_BUCKET=openjam-exports`。
- 但 `config.Config` 没有读取该变量，`storage.Init` 硬编码 `bucketName = "openjam"`。
- 结果：用户以为改了 bucket 名，实际始终写 `openjam`；若 MinIO 里只有 `openjam-exports`，导出会 500。
- **修复**：`config` 增加 `MinioBucket` 字段读取 `MINIO_BUCKET`（默认 `openjam`），`storage.Init` 接收 bucket 参数。

#### 2. `SESSION_SECRET` 被读取但从未使用（会话安全形同虚设）
- `config.Load()` 读 `SESSION_SECRET`，但整个项目没有任何地方引用 `cfg.SessionSecret`。
- 会话 token 直接是 32 字节随机数存库（`sessions` 表），本身可接受；但变量名暗示"会话加密"且 README/`.env.example` 都强调要改，实际改了无任何效果——属于误导性配置 + 未实现的预留。
- **修复**：要么删除该字段和相关文档说明（明确"当前为占位"），要么用于 HMAC 签名 cookie/Token。建议至少在启动时当 `ENVIRONMENT=production` 且 secret 为默认值时拒绝启动。

#### 3. `board_data`（整板快照）与 `operations`（操作日志）双写，无一致性保证
- 保存板：`SaveBoard` 覆盖 `rooms.board_data` 全量 JSON。
- 加入房间：`HandleWebSocket` 同步的是 `operations` 表全部历史操作（`GetOperationsByRoom`），而**不是** `board_data`。
- 前端加入房间时 `sync` 消息只消费 `users`，**完全没有处理 `operations`**（见下条），而是走 HTTP `loadBoard` 读 `board_data`。
- 后果：
  - `operations` 表无限增长，导出 JSON 用的是它而非 `board_data`，可能与用户实际看到的板不一致。
  - 两条数据路径（WS operations vs HTTP board_data）可能产生冲突，尤其当多人编辑时各自 `saveBoard` 会互相覆盖（last-write-wins，无乐观锁/版本号）。
- **修复方向**：明确单一真源。推荐以 `board_data` 快照为主、`operations` 仅用于实时增量同步且定期 compaction；`SaveBoard` 加 `updated_at` 乐观锁或版本号，拒绝覆盖过期版本；加入房间时下发最新 `board_data` + 之后增量 ops。

#### 4. 前端 `sync` 消息未消费 `operations`，协作同步不完整
- `useCollaboration.ts` 的 `handleMessage` 中 `case 'sync'` 只 `setCollaborators(sync.users)`，忽略了 `sync.operations`。
- `wsClient.ts` 的 `SyncPayload` 类型注释甚至把 `operations` 声明了却没用。
- 后端 `client.handleJoin` 下发了完整 operations，前端丢弃，纯靠 HTTP `loadBoard`。新加入者只能看到"上一次保存的快照"，看不到保存之后其他人的实时操作历史。
- **修复**：`sync` 分支里把 `sync.operations` 通过 `reconstructOperation` + `elementStore.loadFromSync` 应用；或在协议上明确 sync 只发 presence、board 走 HTTP，并确保 HTTP load 与 WS join 之间无窗口丢失。

#### 5. `crdt.ts` 的 `CRDTStore` 是死代码，且文档宣传 "CRDT-based" 名不副实
- `CRDTStore`（draw/erase/undo/clear）只被 `lib/index.ts` 导出，无任何组件引用。实际画板用的是 `ElementStore`，其"CRDT"只是 vector clock 时间戳排序 + `applyRemote` 按 opId 去重，**没有真正的 CRDT 合并语义**（无 Yjs/Automerge）。
- `getVisibleOperations` 的 undo 逻辑（标记 undone opId）是线性撤销，多人并发 undo 会跨用户误撤销他人操作。
- 文档 `docs/index.md`、README 宣传 "CRDT-based conflict resolution" 属于过度宣传。
- **修复**：要么实现真正的 CRDT（推荐引入 Yjs/Automerge，或至少 LWW 元素 map），要么修正文档措辞为 "operation-log + last-writer-wins"。

### 🟠 P1 — 安全 / 健壮性

#### 6. 缺少速率限制（后端唯一显式 TODO）
- `handler/websocket.go:39` 留有 `TODO: Add per-IP rate limiting`。
- 实际不仅 WS，注册/登录/保存/导出全部无 rate limit。注册接口可被刷量，登录可被爆破（虽有 bcrypt，但无锁定/延迟）。
- **修复**：引入 `golang.org/x/time/rate` 或 Gin 中间件做 IP 级限流，登录额外加失败计数。

#### 7. `board_data` 写入无 schema 校验
- `SaveBoardRequest.Elements/Stamps/Pages` 都是 `interface{}`，直接 `json.Marshal` 存库。
- 任意 JSON 结构都会被接受并覆盖，恶意/损坏客户端可写入无法渲染的数据。
- **修复**：定义 `Element` 的 Go 结构（已在前端有完整类型），后端落库前至少做 `json.Unmarshal` 到结构校验。

#### 8. `LoadBoard` 在房间不存在时返回空板而非 404
- `room.go:277` 当 `ErrRoomNotFound` 时返回 `{"name":"Untitled Board","elements":[]}` 且 200。
- 这掩盖了无权限/错误 ID，且会被 `autosave` 当成"空板"覆盖回去，可能误删数据。
- **修复**：区分"不存在"（404）和"存在但空"。前端对 404 应停止 autosave（`autosaveReady=false` 已有部分保护，但 LoadBoard 200 走不到 `boardLoadError` 分支）。

#### 9. MinIO 未初始化时导出路径崩溃不一致
- `storage.Init` 失败只打 warning 继续启动；`ExportPNG/ExportJSON/GetExport` 调用 `storage.UploadFile` 时返回 `"storage not initialized"` 500。
- 用户点导出会突然失败，无前端提示该功能不可用。
- **修复**：启动日志显著标注；前端导出按钮根据 `/health` 或新增 `/api/capabilities` 禁用。

#### 10. WebSocket 连接用 query token，易被日志/代理泄漏
- `?token=...` 拼接在 URL 里。虽然 WebSocket 无法用标准 header，但 token 会进代理日志、浏览器历史。
- **修复**：改用短期一次性 ticket（`POST /api/ws/ticket` 换 30s 有效 ticket），或用 cookie 认证（已有 `wb_session` cookie，可直接复用 `CheckOrigin` + cookie）。

### 🟡 P2 — 代码质量 / 可维护性

#### 11. 两套锁文件并存（`bun.lock` 与 `package-lock.json`）
- `bun install --frozen-lockfile` 失败（lockfile 与 package.json 不同步），`package-lock.json` 又是 npm 的，混用导致 CI/构建不稳定。
- **修复**：选定一个包管理器（README 已推荐 bun），删除 `package-lock.json`，`bun install` 后提交更新的 `bun.lock`。

#### 12. `OpenJamCanvas.tsx` 巨型组件（约 1000+ 行未完整展示）
- 一个组件里塞了：工具状态、画布状态、分享设置、自动保存、导出、对齐、分页、widget 渲染、上下文菜单……
- 大量 `useCallback` 依赖手动管理，`selectedColor`、`clipboard`、`showStampPicker` 等状态有"声明后 `void` 抑制警告"的反模式。
- **修复**：按职责拆分（`useBoardState`、`useShareState`、`useExport`、`useAlignDistribute`），widget 渲染移到独立模块。

#### 13. 大量 `as never` / `any` 绕过类型检查
- `useCollaboration.ts:107` `wsClient.sendOperation(op.opType as never, {...} as never, ...)`、`WidgetRenderer` 的 `handleWidgetUpdate: (data: any)`。
- 后端 `Operation.Payload interface{}` + `json.Unmarshal` 到 `map[string]interface{}`，前端 `reconstructOperation` 用 string 强转。
- 跨端类型契约靠手维护，易漂移。
- **修复**：用 zod/共享 schema（可从 Go struct 生成 TS 类型）。

#### 14. 组件名 `_boardId` 与解构 `boardId: _boardId` 的"下划线抑制未用"是反模式
- `OpenJamCanvas` 解构 `boardId: _boardId` 后内部大量用 `_boardId`，说明它其实被用；`showStampPicker` 同理。用 `void` 掩盖 ESLint 警告而非修正逻辑。
- **修复**：恢复正常命名，真正未用的变量直接删除。

#### 15. 无任何测试
- 前后端均无单元/集成测试（`*_test.go`、`*.test.ts` 均为 0）。
- CRDT 合并、权限校验、save/load 这类关键逻辑零覆盖，重构风险高。
- **修复**：优先给 `model.GetRoomAccess`（权限矩阵）、`elementStore.applyRemote/loadFromSync`（去重/合并）、`useAutoSave`（竞态/离线）加测试。

### 🟢 P3 — 体验 / 文档

#### 16. README 与文档夸大功能
- "CRDT-based conflict resolution"、"Secure - Session-based authentication"（secret 未启用）、"Export - Save as images"（依赖可选 MinIO，未说明）。
- **修复**：如实标注当前状态与依赖。

#### 17. `GetExport` 预签名 URL 仅 15 分钟且无 token，谁拿到链接都能下载
- `storage.GetPresignedURL` 15min 有效，URL 可在此窗口被任何人访问；`exports/{roomID}/...` 路径可被枚举猜测。
- **修复**：缩短有效期、路径用不可猜 UUID（已有 `uuid.New()[:8]`，建议用完整 UUID）、或走服务端代理下载。

#### 18. `cleanupExpiredSessions` 每小时一次，无配置
- 硬编码 `time.NewTicker(time.Hour)`。
- **修复**：可配置间隔；高并发下考虑批量删除。

## 四、建议的任务清单（可执行）

> 优先级：P0 必须修；P1 应修；P2/P3 迭代修。下列任务粒度适合单个 PR。

### P0
1. **修 `MINIO_BUCKET` 配置链路**：`config.Config.MinioBucket` + `storage.Init(..., bucket)`，默认 `openjam`，docker-compose/`.env.example` 对齐。
2. **处理 `SESSION_SECRET`**：要么删除该配置项与文档，要么在 production 下强制非默认值启动校验。
3. **统一 board 真源**：决定 `board_data` 为权威，`operations` 改为"会话期间增量、定期 compaction"；`SaveBoard` 加 `version`/`updated_at` 乐观锁。
4. **前端消费 `sync.operations`**：`useCollaboration` 的 sync 分支调用 `loadFromSync(reconstructed)`，保证新加入者拿到完整状态。
5. **修正 `CRDTStore` 死代码与文档**：删除 `crdt.ts` 或接入它；同步修正 docs/README 的 "CRDT" 措辞。

### P1
6. 全局限流中间件（IP 级），登录失败计数与延迟。
7. 后端 `SaveBoard` 增加 `Element` 结构校验（反序列化到 typed struct）。
8. `LoadBoard` 区分 404 vs 空板；前端对 404 停止 autosave 并提示。
9. MinIO 不可用时前端禁用导出 + 启动日志显式警告。
10. WebSocket 认证改 cookie 或一次性 ticket，移除 query token。

### P2
11. 选定单一包管理器，清掉 `package-lock.json`，修复 `bun install --frozen-lockfile`。
12. 拆分 `OpenJamCanvas`：抽 hooks、独立 `WidgetRenderer` 文件。
13. 前后端共享类型/schema，消除 `as never`/`any`。
14. 清理 `void _x` / `_boardId` 反模式。
15. 为 `GetRoomAccess`、`elementStore` 合并、`useAutoSave` 补单元测试。

### P3
16. README/docs 如实标注功能状态与可选依赖。
17. `GetExport` 缩短有效期 + 完整 UUID 路径或服务端代理下载。
18. `cleanupExpiredSessions` 间隔可配置。

## 五、验证方式建议
- 后端：`go test ./...`（需先补测试）、`docker compose up` 跑通注册→建板→协作→保存→重载→导出全流程。
- 前端：`bun run build` + `bun run dev`，浏览器覆盖登录、新建板、多人光标、离线自动保存恢复、分页、widget 渲染。
- 因当前无测试，任何重构都应先补关键路径的集成测试作为安全网。