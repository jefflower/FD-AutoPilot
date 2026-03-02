#!/bin/bash
# ============================================================
# FD-AutoPilot 开发环境联合启动脚本
# 同时启动 fd-server (Spring Boot) 和 n8n (工作流引擎)
# ============================================================
# 用法:
#   ./start-dev.sh              # 启动所有服务
#   ./start-dev.sh --server-only  # 仅启动 fd-server
#   ./start-dev.sh --n8n-only     # 仅启动 n8n
#   ./start-dev.sh stop           # 停止所有服务
#   ./start-dev.sh status         # 查看服务状态
# ============================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
PID_DIR="$PROJECT_ROOT/.pids"

# PostgreSQL 工具路径（Homebrew 安装）
PSQL="$(command -v psql 2>/dev/null || find /opt/homebrew/Cellar/postgresql* -name psql -type f 2>/dev/null | head -1)"
PG_ISREADY="$(command -v pg_isready 2>/dev/null || find /opt/homebrew/Cellar/postgresql* -name pg_isready -type f 2>/dev/null | head -1)"

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

mkdir -p "$LOG_DIR" "$PID_DIR"

# ---- PostgreSQL 连通性检查 ----
check_postgres() {
    echo -e "${YELLOW}[CHECK]${NC} 检查 PostgreSQL 连通性..."
    if [ -n "$PG_ISREADY" ] && $PG_ISREADY -h localhost -p 5432 -U fdadmin -d fd_autopilot -q 2>/dev/null; then
        echo -e "${GREEN}[OK]${NC} PostgreSQL 连通"
    elif [ -n "$PSQL" ]; then
        PGPASSWORD=fdadmin123 $PSQL -h localhost -U fdadmin -d fd_autopilot -c "SELECT 1;" -q 2>/dev/null
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}[OK]${NC} PostgreSQL 连通"
        else
            echo -e "${RED}[ERROR]${NC} PostgreSQL 不可达 (localhost:5432/fd_autopilot)"
            exit 1
        fi
    else
        echo -e "${YELLOW}[WARN]${NC} 未找到 psql/pg_isready，跳过连通性检查"
    fi
}

# ---- 确保 n8n schema 存在 ----
ensure_n8n_schema() {
    if [ -n "$PSQL" ]; then
        echo -e "${YELLOW}[CHECK]${NC} 检查 n8n schema..."
        PGPASSWORD=fdadmin123 $PSQL -h localhost -U fdadmin -d fd_autopilot -c \
            "CREATE SCHEMA IF NOT EXISTS n8n AUTHORIZATION fdadmin;" -q 2>/dev/null
        echo -e "${GREEN}[OK]${NC} n8n schema 就绪"
    fi
}

# ---- 启动 fd-server ----
start_server() {
    if [ -f "$PID_DIR/fd-server.pid" ] && kill -0 "$(cat "$PID_DIR/fd-server.pid")" 2>/dev/null; then
        echo -e "${YELLOW}[SKIP]${NC} fd-server 已在运行 (PID: $(cat "$PID_DIR/fd-server.pid"))"
        return
    fi
    echo -e "${YELLOW}[START]${NC} 启动 fd-server..."
    cd "$PROJECT_ROOT/fd-server"
    nohup mvn spring-boot:run -pl fd-server-app \
        -Dspring-boot.run.jvmArguments="-Xmx512m" \
        > "$LOG_DIR/fd-server.log" 2>&1 &
    echo $! > "$PID_DIR/fd-server.pid"
    echo -e "${GREEN}[OK]${NC} fd-server 启动中 (PID: $!, 端口: 9988)"
    echo "    日志: $LOG_DIR/fd-server.log"
}

# ---- 启动 n8n ----
start_n8n() {
    if [ -f "$PID_DIR/n8n.pid" ] && kill -0 "$(cat "$PID_DIR/n8n.pid")" 2>/dev/null; then
        echo -e "${YELLOW}[SKIP]${NC} n8n 已在运行 (PID: $(cat "$PID_DIR/n8n.pid"))"
        return
    fi
    echo -e "${YELLOW}[START]${NC} 启动 n8n..."
    # 加载 n8n 环境变量
    if [ -f "$PROJECT_ROOT/n8n/.env" ]; then
        set -a
        source "$PROJECT_ROOT/n8n/.env"
        set +a
    else
        echo -e "${RED}[ERROR]${NC} n8n/.env 不存在，请从 n8n/.env.example 复制并配置"
        exit 1
    fi
    nohup n8n start > "$LOG_DIR/n8n.log" 2>&1 &
    echo $! > "$PID_DIR/n8n.pid"
    echo -e "${GREEN}[OK]${NC} n8n 启动中 (PID: $!, 端口: ${N8N_PORT:-5678})"
    echo "    日志: $LOG_DIR/n8n.log"
    echo "    访问: http://localhost:${N8N_PORT:-5678}"
}

# ---- 停止服务 ----
stop_all() {
    echo -e "${YELLOW}[STOP]${NC} 停止所有服务..."
    for service in fd-server n8n; do
        if [ -f "$PID_DIR/$service.pid" ]; then
            PID=$(cat "$PID_DIR/$service.pid")
            if kill -0 "$PID" 2>/dev/null; then
                # fd-server 是 mvn 进程，需要杀掉整个进程树
                if [ "$service" = "fd-server" ]; then
                    pkill -P "$PID" 2>/dev/null
                fi
                kill "$PID" 2>/dev/null
                echo -e "${GREEN}[OK]${NC} $service 已停止 (PID: $PID)"
            else
                echo -e "${YELLOW}[INFO]${NC} $service 进程已不存在 (PID: $PID)"
            fi
            rm -f "$PID_DIR/$service.pid"
        else
            echo -e "${YELLOW}[INFO]${NC} $service 无 PID 文件"
        fi
    done
}

# ---- 服务状态 ----
show_status() {
    echo "========== FD-AutoPilot 服务状态 =========="
    for service in fd-server n8n; do
        if [ -f "$PID_DIR/$service.pid" ] && kill -0 "$(cat "$PID_DIR/$service.pid")" 2>/dev/null; then
            echo -e "  $service: ${GREEN}运行中${NC} (PID: $(cat "$PID_DIR/$service.pid"))"
        else
            echo -e "  $service: ${RED}未运行${NC}"
        fi
    done
    echo "============================================"
}

# ---- 主逻辑 ----
case "${1:-start}" in
    stop)
        stop_all
        ;;
    status)
        show_status
        ;;
    --server-only)
        check_postgres
        start_server
        ;;
    --n8n-only)
        check_postgres
        ensure_n8n_schema
        start_n8n
        ;;
    start|"")
        check_postgres
        ensure_n8n_schema
        start_server
        start_n8n
        echo ""
        echo "========== 服务启动完成 =========="
        echo "  fd-server:  http://localhost:9988"
        echo "  fd-web:     http://localhost:5173 (需单独 cd fd-web && npm run dev)"
        echo "  n8n:        http://localhost:${N8N_PORT:-5678}"
        echo "  Swagger UI: http://localhost:9988/swagger-ui.html"
        echo "=================================="
        ;;
    *)
        echo "用法: $0 [start|stop|status|--server-only|--n8n-only]"
        exit 1
        ;;
esac
