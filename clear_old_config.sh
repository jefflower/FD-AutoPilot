#!/bin/bash
# 清除 FD-AutoPilot 的旧配置数据

echo "🔍 查找 FD-AutoPilot 配置文件..."

# 查找配置数据库
SETTINGS_DB=$(find ~/Library/Application\ Support -name "settings.db" -path "*fd-client*" 2>/dev/null | head -1)

if [ -n "$SETTINGS_DB" ]; then
    echo "📁 找到配置数据库: $SETTINGS_DB"
    echo "🗑️  删除配置数据库..."
    rm "$SETTINGS_DB"
    echo "✅ 配置数据库已删除"
else
    echo "⚠️  未找到配置数据库"
fi

# 查找整个应用数据目录
APP_DATA=$(find ~/Library/Application\ Support -type d -name "*fd-client*" 2>/dev/null | head -1)

if [ -n "$APP_DATA" ]; then
    echo "📁 应用数据目录: $APP_DATA"
    echo "📋 目录内容:"
    ls -la "$APP_DATA"
fi

echo ""
echo "✨ 完成！请重启 Tauri 应用，配置将使用新的默认值 'zh-CN'"
