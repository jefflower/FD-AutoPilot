#!/bin/bash

# Claude Code CLI 升级脚本
# 用途: 自动检测并升级 Claude Code 到最新版本

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # 无颜色

# 日志函数
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# 分隔线
separator() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# 检查命令是否存在
check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 未安装，请先安装 $1"
        exit 1
    fi
}

# 获取当前版本
get_current_version() {
    if command -v claude &> /dev/null; then
        claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown"
    else
        echo "未安装"
    fi
}

# 获取最新版本
get_latest_version() {
    npm view @anthropic-ai/claude-code version 2>/dev/null || echo "unknown"
}

# 检测安装方式
detect_install_method() {
    if npm list -g 2>/dev/null | grep -q "@anthropic-ai/claude-code"; then
        echo "npm"
    elif brew list 2>/dev/null | grep -qi claude; then
        echo "brew"
    elif command -v claude &> /dev/null; then
        echo "manual"
    else
        echo "none"
    fi
}

# 主函数
main() {
    separator
    echo -e "${BLUE}🚀 Claude Code CLI 升级工具${NC}"
    separator
    echo ""

    # 检查必要的命令
    log_info "检查系统环境..."
    check_command "npm"

    # 检测安装方式
    log_info "检测安装方式..."
    INSTALL_METHOD=$(detect_install_method)

    if [ "$INSTALL_METHOD" = "none" ]; then
        log_error "未检测到 Claude Code 安装"
        echo ""
        log_info "请先安装 Claude Code:"
        echo "  npm install -g @anthropic-ai/claude-code"
        exit 1
    fi

    log_success "检测到安装方式: ${INSTALL_METHOD}"
    echo ""

    # 获取版本信息
    log_info "获取版本信息..."
    CURRENT_VERSION=$(get_current_version)
    LATEST_VERSION=$(get_latest_version)

    echo "  当前版本: ${YELLOW}${CURRENT_VERSION}${NC}"
    echo "  最新版本: ${GREEN}${LATEST_VERSION}${NC}"
    echo ""

    # 版本比较
    if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
        log_success "已经是最新版本！"
        exit 0
    fi

    if [ "$LATEST_VERSION" = "unknown" ]; then
        log_error "无法获取最新版本信息，请检查网络连接"
        exit 1
    fi

    # 询问用户是否升级
    separator
    log_warning "发现新版本可用: ${CURRENT_VERSION} → ${LATEST_VERSION}"
    echo ""
    read -p "是否继续升级? (y/N): " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "用户取消升级"
        exit 0
    fi

    echo ""
    separator

    # 执行升级
    case $INSTALL_METHOD in
        npm)
            log_info "使用 npm 升级 Claude Code..."
            echo ""
            if npm update -g @anthropic-ai/claude-code; then
                log_success "升级成功！"
            else
                log_error "升级失败"
                echo ""
                log_info "尝试强制重新安装:"
                echo "  npm uninstall -g @anthropic-ai/claude-code"
                echo "  npm install -g @anthropic-ai/claude-code"
                exit 1
            fi
            ;;
        brew)
            log_info "使用 Homebrew 升级 Claude Code..."
            echo ""
            if brew upgrade claude; then
                log_success "升级成功！"
            else
                log_error "升级失败，请查看上面的错误信息"
                exit 1
            fi
            ;;
        manual)
            log_warning "检测到手动安装，请使用原安装方式升级"
            exit 1
            ;;
    esac

    echo ""
    separator

    # 验证升级
    log_info "验证升级结果..."
    NEW_VERSION=$(get_current_version)
    echo "  升级后版本: ${GREEN}${NEW_VERSION}${NC}"

    if [ "$NEW_VERSION" = "$LATEST_VERSION" ]; then
        echo ""
        log_success "✨ Claude Code 已成功升级到最新版本！"
    else
        echo ""
        log_warning "版本验证异常，请手动检查"
    fi

    echo ""
    separator
}

# 运行主函数
main "$@"
