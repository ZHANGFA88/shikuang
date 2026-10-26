# 观潮情绪层 · Mac 一次性回填包（v2 · compose exec）

## owner 两步（不得超过「取包入仓根 + 一条命令」）

```bash
git pull
bash sentiment-mac-bundle/run.sh
```

前提：bundle 已由主聊天提交进仓根（`sentiment-mac-bundle/`，与 `scripts/`、
`docker-compose.yml` 同级）；Mac 部署机上 docker compose 五容器正常运行，
`.env` 为日常日报那套模型配置（含 qwen3.7-plus 与有效密钥）。

> v1（宿主机 node 直跑）已作废：Mac 标准部署无仓根 bind 挂载、密钥只进后端容器，
> 宿主机 node 不是部署形态。v2 全程走 compose exec。

## 跑完会发生什么（按序，全部自动；构建镜像需数分钟，属正常）

1. 模块文件落入宿主机 `modules/sentiment/`（评分、提示词、迁移、回填、导出）
   与 `packages/backend/src/publication/sentiment.ts`（模块 server 插口的读取层依赖，
   仅被回填脚本的模型步骤注册所 import，本身无路由）。
   **不改 `site/modules/`**，样板路由与排程均不挂载，生产接口零变化。
   另请注意：提交进仓的只能是 `sentiment-mac-bundle/` 本目录，`site/modules/` 的样板注册
   绝不能随包进 Mac 仓（否则样板路由会在生产挂载）。
2. `docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com worker` +
   `docker compose up -d worker`：把模块文件烘焙进 worker 镜像并重启 worker 一次
   （compose 已设 stop_grace_period 210s，在途付费调用会先完成再停；国内镜像参数因
   compose 文件未接 NPM_REGISTRY 而显式传入，免得首跑卡在拉包上）。api/web 不动。
3. `docker compose exec -T worker node scripts/migrate.ts`：新增一张表
   `sentiment_scores`（单条 `CREATE TABLE IF NOT EXISTS`，字段：方向/把握度/等级/
   理由/证据/模型/提示词版本）。只跑迁移，不跑 seed。
4. `docker compose exec -T worker node modules/sentiment/scripts/backfill.ts --days 30 --limit 200`：
   30 天窗、最多 200 条、最旧优先；每条一次模型判定（方向=市场影响非事件好坏、
   把握度两位小数且永不写 1.0、理由 ≤120 字上游链），走 worker 容器现成调用链与回执，
   只换情绪提示词。已评分条目跳过，中途失败已评部分仍入库。
5. 容器内导出后 `docker compose cp` 取回宿主机仓根：
   `sentiment-export-YYYY-MM-DD.json`（北京时间日期），窗口内全部已评条目 +
   情绪 5 字段，是交回云端样板栈的唯一文件。

## 结果文件（跑完即有，不用贴任何输出）

- `sentiment-backfill-report.txt`：全程记录（构建、迁移、回填、导出取回）。
- `sentiment-export-YYYY-MM-DD.json`：请把这个 JSON 交回架构，后端组导入云端样板栈后
  出三主题人工复算自查表，前端样板仍读云端端点。

## 安全与重跑

- 不删不改任何已有表与数据；只新增一张表与上述文件。
- 重跑安全：迁移已应用则跳过、回填只补未评分、导出覆盖同日文件；镜像重建可重复执行。
- 若回填中途失败：看报告尾部的退出码与回填输出即可定位，重跑自动续补，无需清表。
- 若导出取回失败：报告会给出手动取回命令（文件仍在 worker 容器 `/app/` 内）。
