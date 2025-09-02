// あなたのGoogleスプレッドシートのIDをここに貼り付けてください
const SPREADSHEET_ID = '1r5c99QSpnNqkj_YMpd1ml1jmYDh6vjkktoRoDGte4CI';
const SHEET_NAME = 'knowledge_base'; // スプレッドシートのシート名（デフォルトは「シート1」）

/**
 * ウェブアプリとしてアクセスされたときにHTMLを配信する関数
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('chatbot').evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * ユーザーからのメッセージを受け取り、回答を返す関数
 * HTML側から google.script.run で呼び出されます
 * @param {string} userMessage ユーザーからの質問テキスト
 * @returns {string} チャットボットの回答
 */
function processMessage(userMessage) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) {
    return 'エラー: ナレッジベースのシートが見つかりません。設定を確認してください。';
  }

  // データの最終行を取得 (A列とB列にデータがある前提)
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { // ヘッダー行のみの場合はデータなし
    return 'ナレッジベースにデータが登録されていません。';
  }

  // スプレッドシートの全データを取得 (ヘッダー行を除く)
  // getRange(row, column, numRows, numColumns)
  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

  const lowerCaseMessage = userMessage.toLowerCase();
  let bestAnswer = '申し訳ございません。ご質問の意図が分かりかねます。別の言葉でお試しいただくか、お電話（宿の電話番号）にてお問い合わせください。';

  for (let i = 0; i < data.length; i++) {
    const keywordsString = String(data[i][0]).toLowerCase(); // 質問キーワード
    const answer = String(data[i][1]); // 回答

    // 質問キーワードをカンマで分割し、それぞれをチェック
    const keywords = keywordsString.split(',').map(k => k.trim());

    // ユーザーのメッセージにいずれかのキーワードが含まれているかチェック
    for (let j = 0; j < keywords.length; j++) {
      if (keywords[j] !== '' && lowerCaseMessage.includes(keywords[j])) {
        bestAnswer = answer;
        // 一致するものが見つかったら、この質問に対する検索を終了
        return bestAnswer;
      }
    }
  }

  // どのキーワードにも一致しなかった場合のデフォルト回答
  return bestAnswer;
}

/**
 * HtmlTemplateを評価するヘルパー関数 (doGet用)
 */
function include(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}