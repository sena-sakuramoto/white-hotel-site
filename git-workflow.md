# Git プッシュワークフロー

このプロジェクトでの Git コミット・プッシュの標準手順です。

## 基本ワークフロー

### 1. 現状確認
```bash
# 変更状況を確認
git status

# 変更内容の詳細を確認
git diff

# 最近のコミット履歴を確認（スタイル参考のため）
git log --oneline -5
```

### 2. ファイルのステージング
```bash
# 特定ファイルをステージング（推奨）
git add <file1> <file2> <file3>

# 例：WiFi関連ファイルの場合
git add house-rules.html index.en.html index.html
```

### 3. コミット作成
```bash
# コミットメッセージはHEREDOC形式で作成
git commit -m "$(cat <<'EOF'
feat: 変更内容の簡潔な説明

・具体的な変更点1
・具体的な変更点2
・具体的な変更点3

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### 4. コミット後確認
```bash
# コミットが正常に作成されたか確認
git status
```

### 5. リモートプッシュ
```bash
# masterブランチにプッシュ
git push origin master
```

## コミットメッセージの形式

### プレフィックス
- `feat:` - 新機能追加
- `fix:` - バグ修正
- `update:` - 既存機能の更新・改善
- `docs:` - ドキュメント更新

### 構造
```
<type>: <簡潔な説明（50文字以内）>

・詳細な変更内容1
・詳細な変更内容2
・詳細な変更内容3

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## 実例

### WiFi設置完了の修正例
```bash
git add house-rules.html index.en.html index.html

git commit -m "$(cat <<'EOF'
feat: WiFi設置完了に伴い表示を更新

・FAQ回答を「準備中」から「完備」に変更
・日英両対応でWiFi利用可能を明記
・ハウスルールに接続案内を追加

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

git push origin master
```

## 注意事項

1. **ファイル指定**: `git add .` ではなく、変更したファイルを明示的に指定する
2. **メッセージ形式**: HEREDOC (`cat <<'EOF'`) を使用して複数行メッセージを作成
3. **プレフィックス**: 変更の種類に応じて適切なプレフィックスを使用
4. **ブランチ**: このプロジェクトはmasterブランチを使用
5. **確認**: 各ステップでgit statusで状況を確認する

## トラブルシューティング

### 改行文字の警告が出る場合
```
warning: in the working copy of 'file.html', LF will be replaced by CRLF
```
これは正常な動作です。Windows環境での改行文字変換の警告で、無視して問題ありません。

### コミットが失敗する場合
- ファイルが正しくステージングされているか確認
- コミットメッセージの形式が正しいか確認
- 必要に応じて `git add` をやり直す