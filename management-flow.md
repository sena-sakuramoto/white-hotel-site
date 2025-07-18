
## 管理者向け：未成年者予約の確認・管理フロー

1.  **新規予約の通知:**
    *   未成年者を含む予約が入ると、管理者のメールアドレス（`ADMIN_EMAIL`）に「【重要】親権者同意書原本のご提出について」という件名のメールがBCCで届きます。

2.  **スプレッドシートの確認:**
    *   `Reservations`シートを開き、`status`列が「**同意書確認待ち**」になっている行を探します。
    *   該当行の`consentFileId`列に、アップロードされた同意書のファイルIDが記録されています。

3.  **同意書の確認方法:**
    *   **方法A: 手動で開く**
        1.  Google Driveで「未成年同意書」フォルダを開きます。
        2.  ファイル名 `同意書_{予約ID}_{日付}.pdf` を見つけて開きます。
    *   **方法B: 関数で開く（推奨）**
        1.  スプレッドシートのメニューに「**カスタムメニュー**」が追加されています。
        2.  同意書を確認したい予約の行を選択します。
        3.  「カスタムメニュー」>「**選択した予約の同意書を開く**」をクリックします。
        4.  新しいタブで、該当の同意書PDFが直接開きます。

4.  **内容の確認とステータスの更新:**
    *   同意書の内容（署名・捺印、必要事項の記入）を確認します。
    *   内容に問題がなければ、`status`列を「**同意書確認済み**」に変更します。
    *   （任意）お客様に予約確定の連絡をします。
    *   内容に不備がある場合は、お客様に連絡し、再提出を依頼します。

5.  **チェックイン当日:**
    *   お客様に同意書の**原本**を持参していただきます。
    *   提出された原本と、事前にアップロードされたPDFの内容が一致することを確認します。

---

## 予約IDから同意書を開くGAS関数 (Code.gsに追加)

以下の関数を`Code.gs`の末尾に追加すると、スプレッドシートのメニューからワンクリックで同意書を開けるようになり、管理が非常に効率的になります。

```javascript
// =========================================================================
// === 管理者向け便利機能 ===
// =========================================================================

/**
 * スプレッドシートを開いたときにカスタムメニューを追加する
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('カスタムメニュー')
    .addItem('選択した予約の同意書を開く', 'openConsentForm')
    .addToUi();
}

/**
 * 選択された行の予約IDに対応する同意書を新しいタブで開く
 */
function openConsentForm() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const activeCell = sheet.getActiveCell();
  const row = activeCell.getRow();
  
  // ヘッダー行のインデックスを取得 (例: consentFileIdが11列目)
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const fileIdIndex = headers.indexOf('consentFileId');

  if (fileIdIndex === -1) {
    SpreadsheetApp.getUi().alert('ヘッダーに「consentFileId」列が見つかりません。');
    return;
  }

  const fileId = sheet.getRange(row, fileIdIndex + 1).getValue();

  if (fileId) {
    const url = DriveApp.getFileById(fileId).getUrl();
    const html = `<script>window.open('${url}', '_blank');google.script.host.close();</script>`;
    const userInterface = HtmlService.createHtmlOutput(html);
    SpreadsheetApp.getUi().showModalDialog(userInterface, '同意書を開いています...');
  } else {
    SpreadsheetApp.getUi().alert('この予約には、同意書ファイルが添付されていません。');
  }
}
```
