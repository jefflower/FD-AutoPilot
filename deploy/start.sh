#!/bin/bash
# ============================================================
# FD-AutoPilot 启动脚本
# ============================================================
# 用法: ./start.sh [start|stop|restart|status]
# ============================================================

set -e

APP_NAME="fd-server"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
JAR_FILE=$(ls -1 "$APP_DIR"/fd-server-app*.jar 2>/dev/null | head -1)
PID_FILE="$APP_DIR/fd-server.pid"
LOG_DIR="$APP_DIR/logs"
ENV_FILE="$APP_DIR/.env"

# 默认 JVM 参数
JAVA_OPTS="${JAVA_OPTS:--Xmx512m -Xms256m -XX:+UseG1GC}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 加载环境变量
load_env() {
    if [ -f "$ENV_FILE" ]; then
        log_info "加载环境变量: $ENV_FILE"
        set -a
        source "$ENV_FILE"
        set +a
    else
        log_warn "未找到 .env 文件: $ENV_FILE"
        log_warn "请复制 .env.production.example 为 .env 并填写配置"
    fi
}

# 前置检查
check_prerequisites() {
    log_info "检查运行环境..."

    # Java
    if ! command -v java &> /dev/null; then
        log_error "未找到 java，请安装 JDK 21+"
        exit 1
    fi
    java_version=$(java -version 2>&1 | head -1)
    log_info "Java: $java_version"

    # Node.js（n8n 需要）
    if ! command -v node &> /dev/null; then
        log_warn "未找到 node，n8n 将无法启动"
    else
        log_info "Node: $(node --version)"
    fi

    # n8n
    if ! command -v n8n &> /dev/null; then
        log_warn "未找到 n8n，请运行: npm install -g n8n"
    else
        log_info "n8n: $(n8n --version 2>/dev/null || echo 'installed')"
    fi

    # JAR 文件
    if [ -z "$JAR_FILE" ]; then
        log_error "未找到 fd-server JAR 文件"
        log_error "请先构建: cd fd-server && mvn package -Pwith-frontend -DskipTests"
        exit 1
    fi
    log_info "JAR: $JAR_FILE"

    # PostgreSQL 连通性
    if [ -n "$DB_URL" ]; then
        log_info "数据库: $DB_URL"
    fi
}

start() {
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log_warn "$APP_NAME 已在运行 (PID: $pid)"
            return 0
        fi
        rm -f "$PID_FILE"
    fi

    load_env
    check_prerequisites

    mkdir -p "$LOG_DIR"

    log_info "启动 $APP_NAME..."
    nohup java $JAVA_OPTS \
        -jar "$JAR_FILE" \
        --spring.profiles.active=${SPRING_PROFILES_ACTIVE:-prod} \
        > "$LOG_DIR/fd-server.log" 2>&1 &

    echo $! > "$PID_FILE"
    log_info "$APP_NAME 已启动 (PID: $!)"
    log_info "日志: tail -f $LOG_DIR/fd-server.log"
    log_info "n8n 将由 fd-server 自动拉起（如 n8n.enabled=true）"
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        log_warn "$APP_NAME 未在运行"
        return 0
    fi

    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
        log_info "停止 $APP_NAME (PID: $pid)..."
        kill "$pid"
        # 等待进程退出
        for i in $(seq 1 30); do
            if ! kill -0 "$pid" 2>/dev/null; then
                break
            fi
            sleep 1
        done
        if kill -0 "$pid" 2>/dev/null; then
            log_warn "进程未在 30 秒内退出，强制终止"
            kill -9 "$pid"
        fi
        log_info "$APP_NAME 已停止"
    fi
    rm -f "$PID_FILE"
}

status() {
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log_info "$APP_NAME 运行中 (PID: $pid)"
            # 检查健康
            if curl -sf http://localhost:9988/actuator/health > /dev/null 2>&1; then
                log_info "健康检查: OK"
            else
                log_warn "健康检查: 未响应（可能还在启动中）"
            fi
            return 0
        fi
    fi
    log_warn "$APP_NAME 未运行"
    return 1
}

case "${1:-start}" in
    start)   start ;;
    stop)    stop ;;
    restart) stop; sleep 2; start ;;
    status)  status ;;
    *)
        echo "用法: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
