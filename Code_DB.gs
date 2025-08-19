// ========================================
// WHITE HOTEL KAMAKURA 予約システム
// Google Apps Script (Code.gs) - パターンB: シンプル版
// 未成年者同意書はダウンロード + チェックイン時持参方式
// 修正版: 全員が18歳未満の場合のみ同意書必要
// ★カレンダー機能改善版 V5 (構文エラー修正)★
// ========================================

// === 設定 ===
const SPREADSHEET_ID = '1RyPveNY8TuGrdUF4v1awNyEfAKMMcTMmO9755lg2qrI';
const ADMIN_EMAIL = 'white-hotel@archi-prisma.co.jp'; // 管理者用メールアドレス

// === メインエントリーポイント ===
function doGet(e) {
  try {
    return ContentService
      .createTextOutput(JSON.stringify({
        status: 'OK',
        message: 'WHITE HOTEL KAMAKURA Booking System is running',
        timestamp: new Date().toISOString(),
        version: '2.5-calendar-syntaxfix' // バージョン更新
      }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error('doGet エラー:', error);
    return ContentService
      .createTextOutput(JSON.stringify({
        status: 'ERROR',
        message: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    console.log('=== 🎯 doPost 開始 ===');
    console.log('📨 受信したリクエスト (e):', JSON.stringify(e, null, 2));

    let data;

    // URLSearchParams形式とJSON形式の両方に対応
    if (e.parameter && e.parameter.data) {
      data = JSON.parse(e.parameter.data);
      console.log('📨 URLSearchParams経由のデータ:', data);
    } else if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
      console.log('📨 JSON経由のデータ:', data);
    } else {
      console.error('❌ リクエストデータ解析失敗:', {
        hasParameter: !!e.parameter,
        parameterKeys: e.parameter ? Object.keys(e.parameter) : [],
        hasPostData: !!e.postData,
        postDataKeys: e.postData ? Object.keys(e.postData) : []
      });
      throw new Error('リクエストデータが見つかりません');
    }

    let result;

    // === アクション別処理 ===
    switch (data.action) {
      case 'search':
        result = searchAvailableRooms(data);
        break;

      case 'book':
        result = createReservation(data);
        break;

      default:
        result = {
          ok: false,
          msg: `不明なアクション: ${data.action}`
        };
    }

    console.log('✅ 処理完了:', result.ok ? '成功' : '失敗');
    console.log('📤 送信するレスポンス:', JSON.stringify(result, null, 2));

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('❌ doPost エラー:', error);
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        msg: 'サーバーエラーが発生しました: ' + error.message,
        error: error.toString(),
        timestamp: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ========================================
// === 空室検索機能 ===
// ========================================

function searchAvailableRooms(data) {
  try {
    console.log('🔍 空室検索開始:', data);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const roomsSheet = ss.getSheetByName('Rooms');
    const reservationsSheet = ss.getSheetByName('Reservations');

    // 入力データの検証
    if (!data.cin || !data.cout || !data.guests) {
      return {
        ok: false,
        msg: 'チェックイン日、チェックアウト日、宿泊人数を入力してください'
      };
    }

    // 部屋IDを部屋タイプに変換するマッピング
    const roomIdToTypeMap = {
      'room-A': 'triple',
      'room-B': 'twin',
      'room-C': 'semi-twin',
      'room-D': 'single'
    };

    // フロントエンドから部屋IDが送信された場合は部屋タイプに変換
    let searchType = data.type;
    if (searchType && searchType !== 'any' && searchType !== '' && roomIdToTypeMap[searchType]) {
      searchType = roomIdToTypeMap[searchType];
      console.log('部屋ID→部屋タイプ変換:', data.type, '→', searchType);
    }

    // 日付の変換と検証
    const checkinDate = new Date(data.cin);
    const checkoutDate = new Date(data.cout);
    const guestCount = parseInt(data.guests);

    console.log('検索条件:', {
      checkin: checkinDate,
      checkout: checkoutDate,
      guests: guestCount,
      originalType: data.type,
      searchType: searchType
    });

    // 日付の妥当性チェック
    if (isNaN(checkinDate.getTime()) || isNaN(checkoutDate.getTime())) {
      return {
        ok: false,
        msg: '有効な日付を入力してください'
      };
    }

    if (checkinDate >= checkoutDate) {
      return {
        ok: false,
        msg: 'チェックアウト日はチェックイン日より後の日付を選択してください'
      };
    }

    // 過去の日付チェック
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (checkinDate < today) {
      return {
        ok: false,
        msg: '過去の日付は選択できません'
      };
    }

    // 宿泊人数チェック
    if (isNaN(guestCount) || guestCount < 1 || guestCount > 3) {
      return {
        ok: false,
        msg: '宿泊人数は1〜3名で入力してください'
      };
    }

    // 全部屋情報を取得
    const roomsData = roomsSheet.getDataRange().getValues();
    const rooms = roomsData.slice(1); // ヘッダー行除外

    console.log('全部屋データ:', rooms);

    // 予約データを取得（有効な予約のみ）
    let reservations = [];
    if (reservationsSheet.getLastRow() > 1) {
      const reservationsData = reservationsSheet.getDataRange().getValues();
      const allReservations = reservationsData.slice(1); // ヘッダー行除外

      // 空行と無効な予約を除外（より厳密な条件）
      reservations = allReservations.filter(reservation => {
        // 予約ID、チェックイン日、チェックアウト日、部屋IDが全て存在することを確認
        return reservation[0] && reservation[0] !== '' &&  // 予約ID
               reservation[5] && reservation[5] !== '' &&  // チェックイン日
               reservation[6] && reservation[6] !== '' &&  // チェックアウト日
               reservation[8] && reservation[8] !== '' &&  // 部屋ID
               reservation[10] !== 'Cancelled';             // キャンセル済み除外
      });
    }

    console.log('有効な予約データ:', reservations);

    // 空室検索
    const availableRooms = [];

    for (const room of rooms) {
      const roomId = room[0];
      const roomName = room[1];
      const capacity = parseInt(room[2]);
      const roomType = room[3];

      console.log(`\n=== ${roomId} の検証開始 ===`);
      console.log('部屋情報:', { roomId, roomName, capacity, roomType });

      // 宿泊人数チェック
      if (capacity < guestCount) {
        console.log(`${roomId}: 定員不足 (定員${capacity} < 希望${guestCount})`);
        continue;
      }

      // 部屋タイプフィルタ（指定がある場合）
      if (searchType && searchType !== 'any' && searchType !== '') {
        let typeMatch = false;
        if (searchType === 'single' && roomType === 'single') typeMatch = true;
        if (searchType === 'twin' && roomType === 'twin') typeMatch = true;
        if (searchType === 'semi-twin' && roomType === 'semi-twin') typeMatch = true;
        if (searchType === 'triple' && roomType === 'triple') typeMatch = true;

        if (!typeMatch) {
          console.log(`${roomId}: 部屋タイプ不一致 (${roomType} != ${searchType})`);
          continue;
        }
      }

      // 指定期間での予約重複チェック
      let isAvailable = true;
      let conflictDetails = [];

      for (const reservation of reservations) {
        const resRoomId = reservation[8]; // Room ID列
        const resCheckin = new Date(reservation[5]); // Check-in列
        const resCheckout = new Date(reservation[6]); // Check-out列
        const resStatus = reservation[10]; // Status列

        // 日付の有効性をチェック
        if (isNaN(resCheckin.getTime()) || isNaN(resCheckout.getTime())) {
          console.log(`${roomId}: 無効な日付データをスキップ`, {
            resId: reservation[0],
            rawCheckin: reservation[5],
            rawCheckout: reservation[6]
          });
          continue;
        }

        // 同じ部屋の予約のみチェック
        if (resRoomId === roomId) {
          console.log(`${roomId}: 既存予約チェック`, {
            resId: reservation[0],
            resCheckin: resCheckin.toDateString(),
            resCheckout: resCheckout.toDateString(),
            resStatus: resStatus
          });

          // キャンセル済みの予約は除外
          if (resStatus === 'Cancelled') {
            console.log(`${roomId}: キャンセル済み予約をスキップ`);
            continue;
          }

          // 日程重複チェック（改良版）
          // チェックイン日がその日の予約のチェックアウト日と同じでも予約可能
          // チェックアウト日がその日の予約のチェックイン日と同じでも予約可能
          const overlap = (checkinDate < resCheckout && checkoutDate > resCheckin);

          if (overlap) {
            console.log(`${roomId}: 日程重複発見!`, {
              希望: `${checkinDate.toDateString()} - ${checkoutDate.toDateString()}`,
              既存: `${resCheckin.toDateString()} - ${resCheckout.toDateString()}`
            });
            isAvailable = false;
            conflictDetails.push({
              reservationId: reservation[0],
              checkin: resCheckin,
              checkout: resCheckout
            });
            break;
          } else {
            console.log(`${roomId}: 日程重複なし`, {
              希望: `${checkinDate.toDateString()} - ${checkoutDate.toDateString()}`,
              既存: `${resCheckin.toDateString()} - ${resCheckout.toDateString()}`
            });
          }
        }
      }

      // 空室の場合、リストに追加
      if (isAvailable) {
        console.log(`${roomId}: ✅ 空室として追加`);
        availableRooms.push({
          id: roomId,
          name: roomName,
          capacity: capacity,
          type: roomType
        });
      } else {
        console.log(`${roomId}: ❌ 予約済み`, conflictDetails);
      }
    }

    console.log('\n=== 最終結果 ===');
    console.log('空室リスト:', availableRooms);

    return {
      ok: true,
      rooms: availableRooms,
      debug: {
        searchDate: data.cin + ' - ' + data.cout,
        guestCount: guestCount,
        originalType: data.type,
        searchType: searchType,
        totalRoomsChecked: rooms.length,
        totalReservationsChecked: reservations.length,
        availableCount: availableRooms.length
      }
    };

  } catch (error) {
    console.error('❌ 空室検索エラー:', error);
    return {
      ok: false,
      msg: '空室検索中にエラーが発生しました: ' + error.message,
      error: error.toString()
    };
  }
}

// ========================================
// === 予約作成機能 ===
// ========================================

function createReservation(data) {
  try {
    console.log('🎯 予約作成開始:', data);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    console.log('📊 スプレッドシート取得完了');

    const reservationsSheet = ss.getSheetByName('Reservations');
    console.log('📋 Reservationsシート取得完了');

    // === 入力データの検証 ===
    if (!data.name || !data.email || !data.roomId || !data.cin || !data.cout) {
      console.error('❌ 必須項目不足:', {
        name: !!data.name,
        email: !!data.email,
        roomId: !!data.roomId,
        cin: !!data.cin,
        cout: !!data.cout
      });
      return {
        ok: false,
        msg: '必須項目が入力されていません'
      };
    }

    // メールアドレス形式チェック
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return {
        ok: false,
        msg: '有効なメールアドレスを入力してください'
      };
    }

    // === 予約IDを生成 ===
    const reservationId = generateReservationId();
    console.log('🆔 予約ID生成完了:', reservationId);

    // === 宿泊日数を計算 ===
    const checkinDate = new Date(data.cin);
    const checkoutDate = new Date(data.cout);
    const nights = Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24));
    console.log('📅 宿泊日数計算:', nights);

    // === 現在の日時 ===
    const bookingDate = new Date();
    const bookingDateStr = Utilities.formatDate(bookingDate, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
    console.log('⏰ 予約日時:', bookingDateStr);

    // === 全員未成年フラグ処理（強化版） ===
    // 様々な形式に対応 + 下位互換性
    let allMinors = false;
    const checkValue = data.allMinors || data.hasMinors; // 下位互換性

    if (checkValue === 'true' || checkValue === true ||
        checkValue === 'yes' || checkValue === '1' ||
        checkValue === 1) {
      allMinors = true;
    }

    console.log('👶 受信データ allMinors:', data.allMinors);
    console.log('👶 受信データ hasMinors:', data.hasMinors);
    console.log('👶 判定対象値:', checkValue);
    console.log('👶 判定結果 allMinors:', allMinors);
    console.log('👶 データ型:', typeof checkValue);

    // 念のため、受信データ全体もログ出力
    console.log('📦 受信データ全体:', JSON.stringify(data, null, 2));

    // === 予約データを準備 ===
    const reservationData = [
      reservationId,           // A: Reservation ID
      data.name,              // B: Name
      data.email,             // C: Email
      data.phone || '',       // D: Phone
      parseInt(data.guests),  // E: Guests
      data.cin,              // F: Check-in
      data.cout,             // G: Check-out
      nights,                // H: Nights
      data.roomId,           // I: Room ID
      parseFloat(data.price), // J: Price
      'Confirmed',           // K: Status
      bookingDateStr,        // L: Booking Date
      'Website',             // M: Source
      allMinors ? 'Yes' : 'No' // N: All Minors ★修正済み★
    ];

    console.log('📝 予約データ準備完了:', reservationData);

    // === スプレッドシートに追記 ===
    try {
      reservationsSheet.appendRow(reservationData);
      console.log('✅ スプレッドシート追記成功');

    } catch (writeError) {
      console.error('❌ appendRow エラー:', writeError);
      throw new Error('スプレッドシートへの書き込みに失敗しました: ' + writeError.message);
    }

    // === 確認メール送信 ===
    try {
      console.log('📧 メール送信開始');

      if (allMinors) {
        sendAllMinorConsentEmail(data.email, data.name, reservationId, data);
        console.log('📄 全員未成年用メール送信完了');
      } else {
        sendConfirmationEmail(data.email, data.name, reservationId, data);
        console.log('📬 通常メール送信完了');
      }

    } catch (emailError) {
      console.error('❌ メール送信エラー:', emailError);
      // メール送信失敗しても予約は成功として扱う
    }

    // === 空室カレンダー更新 ===
    try {
      console.log('📅 空室カレンダー更新開始');
      updateAvailabilityCalendar();
      console.log('📅 空室カレンダー更新完了');
    } catch (calendarError) {
      console.error('❌ 空室カレンダー更新エラー:', calendarError);
      // カレンダー更新失敗しても予約は成功として扱う
    }

    console.log('🎉 予約作成完了:', reservationId);

    return {
      ok: true,
      id: reservationId,
      msg: '予約が完了しました',
      consentRequired: allMinors
    };

  } catch (error) {
    console.error('❌ 予約作成エラー:', error);
    return {
      ok: false,
      msg: '予約作成中にエラーが発生しました: ' + error.message,
      error: error.toString()
    };
  }
}

// ========================================
// === ユーティリティ関数 ===
// ========================================

// === 予約ID生成関数 ===
function generateReservationId() {
  const prefix = 'WHK-';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return prefix + timestamp + random;
}

// === 部屋IDを表示名に変換する関数 ===
function getRoomDisplayName(roomId) {
  const roomDisplayMap = {
    'room-A': 'Room A',
    'room-B': 'Room B',
    'room-C': 'Room C',
    'room-D': 'Room D'
  };

  return roomDisplayMap[roomId] || roomId;
}

// ========================================
// === メール送信機能 ===
// ========================================

// === 通常の確認メール送信 ===
function sendConfirmationEmail(email, name, reservationId, reservationData) {
  const subject = `【ホワイトホテル鎌倉】ご予約確認 - ${reservationId}`;

  // 部屋IDを表示名に変換
  const roomDisplayName = getRoomDisplayName(reservationData.roomId);

  const body = `
${name} 様

ホワイトホテル鎌倉をご利用いただき、誠にありがとうございます。
ご予約が完了いたしましたので、詳細をご確認ください。

【ご予約内容】
予約番号: ${reservationId}
お名前: ${name}
チェックイン: ${reservationData.cin}
チェックアウト: ${reservationData.cout}
宿泊人数: ${reservationData.guests}名
お部屋: ${roomDisplayName}
ご宿泊料金: ¥${parseInt(reservationData.price).toLocaleString()}

【重要なご案内】
・チェックイン時間: 15:00〜21:00
・チェックアウト時間: 10:00
・お支払い: 現地にて現金でお支払いください

何かご不明な点がございましたら、お気軽にお問い合わせください。

ホワイトホテル鎌倉
〒248-0012 神奈川県鎌倉市御成町2-20
TEL: 080-8851-5250
Email: white-hotel@archi-prisma.co.jp
`;

  try {
    MailApp.sendEmail(email, subject, body, {
      bcc: ADMIN_EMAIL,
      from: ADMIN_EMAIL
    });
    console.log('通常確認メール送信完了:', email);
  } catch (error) {
    console.error('メール送信失敗:', error);
    throw error;
  }
}

// === 全員未成年者用確認メール送信 ===
function sendAllMinorConsentEmail(email, name, reservationId, reservationData) {
  const subject = `【ご予約確認】未成年者宿泊同意書のご準備について - 予約番号${reservationId}`;

  // 部屋IDを表示名に変換
  const roomDisplayName = getRoomDisplayName(reservationData.roomId);

  const body = `
${name} 様

ホワイトホテル鎌倉をご利用いただき、誠にありがとうございます。
未成年の方のみでのご予約を承りました。

【ご予約内容】
予約番号: ${reservationId}
お名前: ${name}
チェックイン: ${reservationData.cin}
チェックアウト: ${reservationData.cout}
宿泊人数: ${reservationData.guests}名
お部屋: ${roomDisplayName}
ご宿泊料金: ¥${parseInt(reservationData.price).toLocaleString()}

【重要】未成年者宿泊同意書について
未成年の方のみでのご宿泊には、同意書が必要です。
チェックイン時に必ず下記をご持参ください：

📄 同意書ダウンロード：
https://white-hotel.archi-prisma.co.jp/documents/minor_consent_form.pdf

【必須手順】
1. 上記URLから同意書をダウンロード・印刷
2. 保護者様が手書きで必要事項を記入・署名・押印
3. チェックイン時に記入済みの原本をご持参

【記入必須項目】
・保護者氏名・フリガナ・住所
・電話番号・メールアドレス・続柄
・宿泊者名・宿泊日程
・署名・印鑑・記入日

⚠️ 重要なお願い ⚠️
未成年者宿泊同意書の記入済み原本をお持ちでない場合は、
申し訳ございませんがご宿泊をお断りいたします。
必ず手書きで記入・署名した原本をご持参ください。

【チェックイン情報】
・チェックイン時間: 15:00〜21:00
・チェックアウト時間: 10:00
・お支払い: 現地にて現金でお支払いください

ご不明な点がございましたら、お気軽にお問い合わせください。

ホワイトホテル鎌倉
〒248-0012 神奈川県鎌倉市御成町2-20
TEL: 080-8851-5250
Email: white-hotel@archi-prisma.co.jp
`;

  try {
    MailApp.sendEmail(email, subject, body, {
      bcc: ADMIN_EMAIL,
      from: ADMIN_EMAIL
    });
    console.log('全員未成年用確認メール送信完了:', email);
  } catch (error) {
    console.error('未成年者メール送信失敗:', error);
    throw error;
  }
}

// ========================================
// === 管理・デバッグ機能 ===
// ========================================

// === 予約情報取得（全員未成年確認用） ===
function getReservationInfo(reservationId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Reservations');
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === reservationId) { // 予約ID照合
        return {
          found: true,
          reservationId: data[i][0],
          name: data[i][1],
          email: data[i][2],
          guests: data[i][4],
          checkin: data[i][5],
          checkout: data[i][6],
          roomId: data[i][8],
          status: data[i][10],
          allMinors: data[i][13] === 'Yes' // N列: All Minors
        };
      }
    }

    return { found: false, message: '予約が見つかりません' };

  } catch (error) {
    console.error('予約情報取得エラー:', error);
    return { found: false, error: error.message };
  }
}

// === メニュー追加機能 ===
function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('★ホテル管理')
      .addItem('空室カレンダーを手動更新', 'manualUpdateCalendar')
      .addToUi();
}

function manualUpdateCalendar() {
  console.log('=== 手動カレンダー更新 ===');
  try {
    updateAvailabilityCalendar();
    SpreadsheetApp.getUi().alert('空室カレンダーを更新しました。');
  } catch (e) {
    console.error('手動カレンダー更新エラー:', e);
    SpreadsheetApp.getUi().alert('カレンダーの更新中にエラーが発生しました。\n\n' + e.message);
  }
}

// ========================================
// === 空室カレンダー機能 (★★★構文エラー修正版★★★) ===
// ========================================

/**
 * 空室カレンダーシートを更新します。
 * 常に「7月15日」から「10月14日」までのカレンダーを生成し、月別稼働率も表示します。
 * 日付のタイムゾーン問題を修正し、曜日表示を確実にします。
 */
function updateAvailabilityCalendar() {
  try {
    console.log('📅 [修正版 V5] 空室カレンダー更新開始');

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    // スプレッドシートのタイムゾーンを取得。未設定の場合はスクリプトのタイムゾーンを使用
    const timezone = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
    const resSheet = ss.getSheetByName('Reservations');
    const roomsSheet = ss.getSheetByName('Rooms');
    const availName = 'Availability';

    // 1. 部屋ID一覧を 'Rooms' シートから取得
    if (!roomsSheet) {
      throw new Error("シート 'Rooms' が見つかりません。");
    }
    const roomsData = roomsSheet.getDataRange().getValues().slice(1);
    const rooms = roomsData.map(r => r[0]).filter(r => r).sort(); // A列 (Room ID)
    const roomsCount = rooms.length;
    if (roomsCount === 0) {
      console.log('📅 Roomsシートに部屋が登録されていないため、処理を中断します。');
      return;
    }
    console.log('📅 対象部屋:', rooms);

    // 2. 有効な予約データを取得し、日付を正しく解釈する
    let parsedReservations = [];
    if (resSheet && resSheet.getLastRow() > 1) {
      const validReservations = resSheet.getDataRange().getValues().slice(1)
        .filter(function(r) { // 互換性のため通常の関数を使用
          return r[0] && r[5] && r[6] && r[8] && r[10] !== 'Cancelled' &&
            !isNaN(new Date(r[5]).getTime()) &&
            !isNaN(new Date(r[6]).getTime());
        });
      
      // 予約データを、日付比較しやすいように事前に解析します。
      parsedReservations = validReservations.map(function(r) {
        // タイムゾーンを考慮して日付文字列に変換し、それを元に新しいDateオブジェクトを生成します
        // これにより、実行時間による日付のズレを防ぎます
        var checkinStr = Utilities.formatDate(new Date(r[5]), timezone, "yyyy-MM-dd");
        var checkoutStr = Utilities.formatDate(new Date(r[6]), timezone, "yyyy-MM-dd");
        return {
          roomId: r[8],
          checkin: new Date(checkinStr + 'T00:00:00'),
          checkout: new Date(checkoutStr + 'T00:00:00')
        };
      });
    }
    console.log(`📅 有効な予約件数: ${parsedReservations.length}`);

    // 3. カレンダーの表示期間を決定（毎年7/15から10/14まで）
    const year = new Date().getFullYear();
    // 月は0から始まるため、7月は「6」、10月は「9」
    const firstDate = new Date(year, 6, 15);
    const lastDate = new Date(year, 9, 14);
    console.log(`📅 カレンダー期間: ${Utilities.formatDate(firstDate, timezone, 'yyyy/MM/dd')} - ${Utilities.formatDate(lastDate, timezone, 'yyyy/MM/dd')}`);

    // 4. Availabilityシートを再生成
    let availSheet = ss.getSheetByName(availName);
    if (availSheet) ss.deleteSheet(availSheet);
    availSheet = ss.insertSheet(availName, 0);

    // 5. 日付列と空室状況マトリクス、月別稼働率を同時に生成
    const datesCol = [];
    const availabilityMatrix = [];
    const monthlyStats = {}; // 月別統計データ

    for (let d = new Date(firstDate); d <= lastDate; d.setDate(d.getDate() + 1)) {
      const currentDate = new Date(d);
      currentDate.setHours(0,0,0,0); // 比較のため時刻をリセット

      // 曜日をスクリプト側でフォーマットして、ロケール問題を回避
      const formattedDate = Utilities.formatDate(currentDate, timezone, 'yyyy/MM/dd (E)');
      datesCol.push([formattedDate]);

      // 月別統計の準備
      const monthKey = Utilities.formatDate(currentDate, timezone, 'yyyy-MM');
      if (!monthlyStats[monthKey]) {
        monthlyStats[monthKey] = { daysInView: 0, bookedRoomDays: 0 };
      }
      monthlyStats[monthKey].daysInView++;

      // その日の予約状況を計算
      let dailyBookedRooms = 0;
      const matrixRow = rooms.map(function(room) { // 互換性のため通常の関数を使用
        const isBooked = parsedReservations.some(function(r) {
          return r.roomId === room && r.checkin.getTime() <= currentDate.getTime() && currentDate.getTime() < r.checkout.getTime();
        });
        if (isBooked) {
          dailyBookedRooms++;
          return 'Booked';
        }
        return 'Free';
      });
      availabilityMatrix.push(matrixRow);
      monthlyStats[monthKey].bookedRoomDays += dailyBookedRooms;
    }

    // 6. シートに書き込み (日付と空室状況)
    availSheet.getRange(1, 1).setValue('Date');
    availSheet.getRange(1, 2, 1, roomsCount).setValues([rooms]);
    if (datesCol.length > 0) {
      // 日付列はフォーマット済み文字列なので、setNumberFormatは不要
      availSheet.getRange(2, 1, datesCol.length, 1).setValues(datesCol);
      availSheet.getRange(2, 2, availabilityMatrix.length, availabilityMatrix[0].length).setValues(availabilityMatrix);
    }

    // 7. 月別稼働率レポートを計算・準備
    const occupancyReport = [['■月別稼働率', '']];
    const sortedMonthKeys = Object.keys(monthlyStats).sort();
    for (const monthKey of sortedMonthKeys) {
      const stats = monthlyStats[monthKey];
      const totalRoomNightsInView = roomsCount * stats.daysInView;
      const rate = totalRoomNightsInView > 0 ? stats.bookedRoomDays / totalRoomNightsInView : 0;
      occupancyReport.push([monthKey, rate]);
    }

    // 8. 稼働率レポートをシートに書き込み (空室状況の横)
    const reportStartColumn = 2 + roomsCount + 1; // Date列 + rooms列 + 1列空白
    if (occupancyReport.length > 0) {
      const reportRange = availSheet.getRange(1, reportStartColumn, occupancyReport.length, 2);
      reportRange.setValues(occupancyReport);
      // スタイル設定
      reportRange.getCell(1, 1).setFontWeight('bold');
      availSheet.getRange(2, reportStartColumn + 1, occupancyReport.length - 1, 1).setNumberFormat('0.0%');
    }

    // 9. 全体のスタイルと書式設定
    availSheet.getRange(1, 1, 1, roomsCount + 1).setFontWeight('bold').setBackground('#f3f3f3');
    availSheet.setFrozenRows(1);
    availSheet.setFrozenColumns(1);
    const rules = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Booked').setBackground('#ffcccc').setFontColor('#9c0006')
        .setRanges([availSheet.getRange(2, 2, availSheet.getMaxRows(), roomsCount)]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Free').setBackground('#ccffcc').setFontColor('#006400')
        .setRanges([availSheet.getRange(2, 2, availSheet.getMaxRows(), roomsCount)]).build()
    ];
    availSheet.setConditionalFormatRules(rules);
    availSheet.autoResizeColumns(1, roomsCount + 1);
    availSheet.autoResizeColumn(reportStartColumn);
    availSheet.autoResizeColumn(reportStartColumn + 1);

    console.log('📅 空室カレンダーと月別稼働率の更新完了');

  } catch (error) {
    console.error('❌ 空室カレンダー更新エラー:', error);
    throw error; // エラーを再スローして呼び出し元に通知
  }
}
