#!/bin/bash
# 观潮情绪层 · Mac 一次性回填 v2（compose exec 版，一条命令跑完，owner 只跑一次、不分步、不贴输出）
#
# 用法（在 Mac 仓根执行，bundle 已随仓根取包到位）：
#   bash sentiment-mac-bundle/run.sh
#
# 为什么是 v2：Mac 标准部署是 docker compose 五容器（db/setup/api/worker/web），
# 代码以镜像烘焙（Dockerfile COPY . .，无仓根 bind 挂载），数据库、模型与管理员密钥
# 只交给后端容器（compose env_file）。v1 的宿主机 node 路径在 Mac 上跑不起来，故作废。
# v2 全程走 compose：宿主机拷贝模块文件 → 重建 worker 镜像（烘焙进容器）→ 重启 worker →
# exec 跑迁移/回填/导出 → docker cp 取回导出文件。
#
# 本脚本只写四处，绝不碰生产面：
#   ① 宿主机 modules/sentiment/（新增模块文件：评分、提示词、迁移、回填、导出）
#   ② 宿主机 packages/backend/src/publication/sentiment.ts（模块 server 插口的读取层依赖；
#      仅被回填脚本的模型步骤注册所 import，本身无路由；不注册进 site/modules/ 就不生效）
#   ③ 数据库新增一张表 sentiment_scores（迁移 sentiment_0001_scores.sql，单条 CREATE TABLE IF NOT EXISTS）
#   ④ 仓根两个结果文件：sentiment-backfill-report.txt、sentiment-export-YYYY-MM-DD.json
# 不改 site/modules/（不注册样板路由、不挂排程）、不改任何生产接口与现有数据、
# 不删不改已有表、不重跑 seed。重跑安全：迁移已应用则跳过、回填只补未评分条目、
# 导出覆盖同日文件。唯一可见的生产影响：worker 容器按新镜像重启一次
# （compose 已设 stop_grace_period 210s，在途付费调用会先完成再停）。
set -u
BUNDLE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$BUNDLE/.." && pwd)"
cd "$REPO" || { echo "ABORT: cannot cd to repo root $REPO"; exit 1; }

REPORT="$REPO/sentiment-backfill-report.txt"
BEIJING_TODAY="$(TZ=Asia/Shanghai date +%F)"
EXPORT_NAME="sentiment-export-$BEIJING_TODAY.json"
EXPORT_HOST="$REPO/$EXPORT_NAME"
{
echo "=== 观潮情绪层 Mac 一次性回填报告（v2 · compose exec）==="
echo "时间（北京时间）: $(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')"
echo "仓根: $REPO"
echo ""

# 0. 前置检查
command -v docker >/dev/null 2>&1 || { echo "ABORT: 未找到 docker（请在 Mac 部署机上执行）"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ABORT: docker compose 不可用"; exit 1; }
docker info >/dev/null 2>&1 || { echo "ABORT: docker 守护进程不可达"; exit 1; }
for f in docker-compose.yml .env; do
  if [ ! -e "$f" ]; then echo "ABORT: 缺少 $f（请在仓根执行本脚本）"; exit 1; fi
done
echo "docker: $(docker --version) / $(docker compose version)"
echo ""

# 1. 宿主机落模块文件（随后 bake 进 worker 镜像；容器内无仓根挂载，宿主机拷贝本身不进容器）
mkdir -p modules/sentiment packages/backend/src/publication
cp -R "$BUNDLE/payload/modules/sentiment/." modules/sentiment/
cp "$BUNDLE/payload/packages/backend/src/publication/sentiment.ts" packages/backend/src/publication/sentiment.ts
echo "步骤 1/5 模块文件已落入宿主机 modules/sentiment/ 与 publication 读取层（不含 site/modules 注册，样板路由与排程均未挂载）"
echo ""

# 2. 重建 worker 镜像并重启（烘焙代码进容器；耗时数分钟，属正常，一次完成）
#    注：compose 文件未接 NPM_REGISTRY（Dockerfile 声明了该 ARG 但 compose 未传），
#    故显式加 --build-arg 走国内镜像，免得 Mac 首跑卡在拉包上；
#    未声明的 arg 只告警不失败，此处 Dockerfile 已声明，故正常生效。
echo "步骤 2/5 重建 worker 镜像（docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com worker）："
docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com worker 2>&1 | tail -5
if [ "${PIPESTATUS[0]}" != "0" ]; then echo "ABORT: worker 镜像构建失败"; exit 1; fi
docker compose up -d worker 2>&1 | tail -3
echo "等待 worker 可 exec（最长 180 秒）："
READY=0
for _ in $(seq 1 36); do
  if docker compose exec -T worker node --version >/dev/null 2>&1; then READY=1; break; fi
  sleep 5
done
if [ "$READY" != "1" ]; then echo "ABORT: worker 未能进入可 exec 状态"; exit 1; fi
echo "worker 已按新镜像重启，可 exec"
echo ""

# 3. 建列迁移（容器内 exec，环境由 compose env_file 注入，不用 --env-file；只跑迁移，不跑 seed）
echo "步骤 3/5 迁移输出（docker compose exec -T worker node scripts/migrate.ts）："
docker compose exec -T worker node scripts/migrate.ts 2>&1 | tee /tmp/sentiment-migrate.log
if [ "${PIPESTATUS[0]}" != "0" ]; then echo "ABORT: 迁移失败（见上），回填未执行"; exit 1; fi
grep -q "sentiment_0001_scores.sql" /tmp/sentiment-migrate.log && echo "建列确认：sentiment_0001_scores.sql 已应用" || echo "建列确认：sentiment_0001_scores.sql 未出现在本轮输出（此前已应用亦属正常）"
echo ""

# 4. 回填评分（30 天窗、最多 200 条、最旧优先；复用 worker 容器现成模型配置与调用链，只换情绪提示词）
echo "步骤 4/5 回填输出（docker compose exec -T worker node modules/sentiment/scripts/backfill.ts --days 30 --limit 200）："
docker compose exec -T worker node modules/sentiment/scripts/backfill.ts --days 30 --limit 200 2>&1 | tee /tmp/sentiment-backfill.log
BACKFILL_OK="${PIPESTATUS[0]}"
echo "回填退出码：$BACKFILL_OK（非 0 表示中途失败，已评部分已入库，导出仍会生成，重跑只补未评条目）"
echo ""

# 5. 导出并取回（容器内 /app 写出，docker cp 取回宿主机仓根；
#    先删同日旧导出，避免上次残留文件冒充本次取回成功）
echo "步骤 5/5 导出并取回："
rm -f "$EXPORT_HOST"
docker compose exec -T worker node modules/sentiment/scripts/export.ts --days 30 --out "/app/$EXPORT_NAME" 2>&1 | tee /tmp/sentiment-export.log
docker compose cp "worker:/app/$EXPORT_NAME" "$EXPORT_HOST" 2>&1 | tee -a /tmp/sentiment-export.log
if [ -f "$EXPORT_HOST" ]; then echo "导出已取回：$EXPORT_HOST"; else
  echo "ABORT: 导出未能取回宿主机；容器内文件仍在，可手动执行：docker compose cp worker:/app/$EXPORT_NAME ./$EXPORT_NAME"
  exit 1
fi
echo ""
echo "=== 结果文件（请把导出 JSON 交回架构，用于云端样板栈导入）==="
echo "报告：$REPORT"
echo "导出：$EXPORT_HOST"
echo "写集合：宿主机 modules/sentiment/ + publication 读取层 + sentiment_scores 表 + 上述两个文件；site/modules/ 与生产接口未动；worker 容器按新镜像重启一次。"
} | tee "$REPORT"
