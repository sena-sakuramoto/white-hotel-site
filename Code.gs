// =========================================================================
// WHITE HOTEL Kamakura 予約システム - Google Apps Script
// =========================================================================

// === グローバル定数 ===
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID'; // 実際のシートIDに置き換えてください
const SHEET_NAME = 'Reservations';
const ADMIN_EMAIL = 'white-hotel@archi-prisma.co.jp'; // 管理者用メールアドレス

/**
 * WebアプリケーションからのPOSTリクエストを処理するメイン関数
 * @param {Object} e - イベントオブジェクト
 */
function doPost(e) {
  try {
    // POSTされてきたJSONデータをパース
    const params = JSON.parse(e.postData.contents);

    let response;
    switch (params.action) {
      case 'search':
        // searchアクションは現在フロントエンドで完結しているため、基本的には呼ばれない想定
        response = { ok: true, rooms: [] }; // 仮のレスポンス
        break;
      case 'book':
        response = bookRoom(params);
        break;
      default:
        throw new Error('無効なアクションです。');
    }

    return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('doPostエラー:', error, error.stack);
    return ContentService.createTextOutput(JSON.stringify({ ok: false, msg: `サーバーエラー: ${error.message}` })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 予約を確定し、スプレッドシートに記録する
 * @param {Object} data - 予約情報
 */
function bookRoom(data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const reservationId = `WHK-${Utilities.formatDate(new Date(), "JST", "yyyyMMdd")}-${sheet.getLastRow()}`;
  
  // === 未成年同意書機能: フラグをYes/Noに変換 ===
  const allMinors = (data.allMinors === 'true'); // フロントエンドから文字列で来るため変換
  const allMinorsStatus = allMinors ? 'Yes' : 'No';

  // スプレッドシートに書き込むデータ配列を作成
  const newRow = [
    reservationId,
    new Date(),
    data.cin,
    data.cout,
    data.name,
    data.email,
    data.phone,
    data.guests,
    data.type,
    data.price,
    '', // K列 (空)
    '', // L列 (空)
    '', // M列 (空)
    allMinorsStatus // N列
  ];
  sheet.appendRow(newRow);

  // メール送信
  sendConfirmationEmail(data, reservationId);

  // フロントエンドへのレスポンス
  let response = {
    ok: true,
    id: reservationId,
  };

  // === 未成年同意書機能: 特別メッセージ ===
  if (allMinors) { // allMinors (boolean) を使用
      response.special_message = "【重要】ご予約ありがとうございます。チェックイン時に親権者様の同意書原本を必ずご持参ください。詳細は確認メールをご確認ください。";
  }

  return response;
}

/**
 * 予約確認メールを送信する
 * @param {Object} data - 予約情報
 * @param {String} reservationId - 予約ID
 */
function sendConfirmationEmail(data, reservationId) {
  const recipient = data.email;
  let subject = `【ご予約完了】ホワイトホテル鎌倉 - 予約番号: ${reservationId}`;
  let body = `
${data.name} 様

この度は、ホワイトホテル鎌倉にご予約いただき、誠にありがとうございます。
以下の内容でご予約を承りました。

--------------------
予約番号: ${reservationId}
チェックイン: ${data.cin}
チェックアウト: ${data.cout}
人数: ${data.guests}名様
お部屋タイプ: ${data.type}
合計料金: ${data.price.toLocaleString()}円
--------------------

スタッフ一同、お会いできることを心よりお待ちしております。

---
ホワイトホテル鎌倉
TEL: 046-722-4407
Email: ${ADMIN_EMAIL}
`;

  // === 未成年同意書機能: 特別メールテンプレート ===
  if (data.allMinors === 'true') { // data.allMinors (string) を使用
    subject = `【重要】親権者同意書のご準備について - 予約番号: ${reservationId}`;
    body = `
${data.name} 様

この度は、ホワイトホテル鎌倉にご予約いただき、誠にありがとうございます。
ご予約に18歳未満の方が含まれるため、チェックイン時に親権者様の同意書が必要です。

【重要：チェックイン時にご持参いただくもの】
ご宿泊当日は、以下の2点を必ずご持参ください。

1. 親権者様が署名・捺印した「未成年者宿泊に関する保護者同意書」の原本
   下記URLよりダウンロード・印刷してご記入ください。
   ダウンロードURL: https://white-hotel.archi-prisma.co.jp/documents/未成年者宿泊同意書.pdf

2. ご宿泊される未成年者全員分の身分証明書（学生証、健康保険証など）

同意書の原本をご提出いただけない場合は、誠に申し訳ございませんが、ご宿泊をお断りさせていただきます。

--------------------
ご予約内容
--------------------
予約番号: ${reservationId}
チェックイン: ${data.cin}
チェックアウト: ${data.cout}
人数: ${data.guests}名様
お部屋タイプ: ${data.type}
合計料金: ${data.price.toLocaleString()}円
--------------------

ご不明な点がございましたら、お気軽にお問い合わせください。

---
ホワイトホテル鎌倉
TEL: 046-722-4407
Email: ${ADMIN_EMAIL}
`;
  }

  // メール送信
  MailApp.sendEmail(recipient, subject, body, { bcc: ADMIN_EMAIL });
  console.log(`確認メールを送信しました: ${recipient}`);
}

// =========================================================================
// === デバッグ用関数 ===
// =========================================================================

/**
 * 未成年者を含む予約のテスト
 */
function testBookWithMinors() {
  const testData = {
    action: 'book',
    roomId: 'R002',
    name: 'テスト未成年様',
    email: 'test@example.com', // 実際のテスト用メールアドレスに変更してください
    phone: '09033334444',
    cin: '2025-09-10',
    cout: '2025-09-11',
    guests: 2,
    type: 'twin',
    price: 10000,
    allMinors: 'true' // hasMinors から allMinors に変更
  };
  bookRoom(testData);
}

/**
 * 成人のみの予約のテスト
 */
function testBookAdultsOnly() {
    const testData = {
      action: 'book',
      roomId: 'R003',
      name: 'テスト成人様',
      email: 'test@example.com', // 実際のテスト用メールアドレスに変更してください
      phone: '09055556666',
      cin: '2025-09-15',
      cout: '2025-09-16',
      guests: 2,
      type: 'twin',
      price: 10000,
      allMinors: 'false' // hasMinors から allMinors に変更
    };
    bookRoom(testData);
  }