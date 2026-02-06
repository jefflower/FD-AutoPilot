#!/bin/bash
# 更新 FD-AutoPilot 配置中的翻译语言

echo "🔍 查找 FD-AutoPilot 配置数据库..."

# 查找配置数据库
SETTINGS_DB=$(find ~/Library/Application\ Support -name "settings.db" -path "*fd-client*" 2>/dev/null | head -1)

if [ -z "$SETTINGS_DB" ]; then
    echo "❌ 未找到配置数据库"
    echo "💡 请在应用的设置页面重新选择翻译语言"
    exit 1
fi

echo "📁 找到配置数据库: $SETTINGS_DB"

# 检查当前值
CURRENT_VALUE=$(sqlite3 "$SETTINGS_DB" "SELECT value FROM settings WHERE key='translation_lang';" 2>/dev/null)
echo "📋 当前翻译语言设置: $CURRENT_VALUE"

if [ "$CURRENT_VALUE" = "cn" ]; then
    echo "🔄 更新翻译语言设置为 zh-CN..."
    sqlite3 "$SETTINGS_DB" "UPDATE settings SET value='zh-CN' WHERE key='translation_lang';"
    
    # 验证更新
    NEW_VALUE=$(sqlite3 "$SETTINGS_DB" "SELECT value FROM settings WHERE key='translation_lang';")
    echo "✅ 更新完成！新值: $NEW_VALUE"
    echo ""
    echo "⚠️  请重启 Tauri 应用以加载新配置"
elif [ "$CURRENT_VALUE" = "zh-CN" ]; then
    echo "✅ 配置已经是正确的值: zh-CN"
else
    echo "ℹ️  当前值: $CURRENT_VALUE"
    echo "💡 如需更改，请在应用的设置页面选择"
fi
