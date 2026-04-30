// ========================================
// WHITE HOTEL KAMAKURA 予約システム 
// Google Apps Script (Code.gs) - パターンB: シンプル版
// 未成年者同意書はダウンロード + チェックイン時持参方式
// 修正版: 全員が18歳未満の場合のみ同意書必要
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
        version: '2.0-simple'
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
        return reservation[0] && reservation[0] !== '' &&  // 予約ID
               reservation[5] && reservation[5] !== '' &&  // チェックイン日
               reservation[6] && reservation[6] !== '' &&  // チェックアウト日
               reservation[8] && reservation[8] !== '' &&  // 部屋ID
               reservation[10] !== 'Cancelled';             // キャンセル済み除外
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
    const checkValue = data.allMinors || data.hasMinors;  // 下位互換性
    
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
      reservationId,           // A: Reservation ID
      data.name,              // B: Name
      data.email,             // C: Email
      data.phone || '',       // D: Phone
      parseInt(data.guests),  // E: Guests
      data.cin,              // F: Check-in
      data.cout,             // G: Check-out
      nights,                // H: Nights
      data.roomId,           // I: Room ID
      parseFloat(data.price), // J: Price
      'Confirmed',           // K: Status
      bookingDateStr,        // L: Booking Date
      'Website',             // M: Source
      allMinors ? 'Yes' : 'No' // N: All Minors ★修正済み★
    ];

    console.log('📝 予約データ準備完了:', reservationData);

    // === 実際にデータがある最後の行を特定 ===
    const allData = reservationsSheet.getDataRange().getValues();
    console.log('📊 全データ行数:', allData.length);
    
    // ヘッダー行を除いて、実際にデータがある行を特定
    let actualLastRow = 1; // ヘッダー行
    for (let i = 1; i < allData.length; i++) {
      const row = allData[i];
      // 予約IDがある行を実際のデータ行とみなす
      if (row[0] && row[0] !== '') {
        actualLastRow = i + 1; // 1-indexed
      }
    }
    
    const nextRow = actualLastRow + 1;
    console.log('📍 実際の最終データ行:', actualLastRow);
    console.log('📍 書き込み先行:', nextRow);

    // === スプレッドシートの特定の行に書き込み ===
    try {
      const range = reservationsSheet.getRange(nextRow, 1, 1, reservationData.length);
      range.setValues([reservationData]);
      console.log('✅ スプレッドシート書き込み成功 (行:', nextRow, ')');
      
    } catch (writeError) {
      console.error('❌ setValues エラー:', writeError);
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
// === お盆料金設定機能 ===
// ========================================

// === お盆期間かどうかをチェックする関数 ===
function isObonPeriod(checkinDateStr) {
  const checkinDate = new Date(checkinDateStr);
  const year = checkinDate.getFullYear();
  
  // お盆期間: 8/12-16 (チェックイン日ベース)
  const obonStart = new Date(year, 7, 12); // 8月は7 (0ベース)
  const obonEnd = new Date(year, 7, 16);
  
  return checkinDate >= obonStart && checkinDate <= obonEnd;
}

// === お盆料金適用の基本料金計算 ===
function calculateObonPrice(basePrice, checkinDateStr) {
  if (isObonPeriod(checkinDateStr)) {
    console.log('🎋 お盆料金適用: 基本料金 ×1.5');
    return Math.round(basePrice * 1.5);
  }
  return basePrice;
}

// ========================================
// === 空室カレンダー機能 ===
// ========================================

// === 空室カレンダーを更新する関数 ===
function updateAvailabilityCalendar() {
  try {
    console.log('📅 空室カレンダー更新開始');
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const resSheet = ss.getSheetByName('Reservations');
    const availName = 'Availability';

    // 1. 予約データ取得
    const data = resSheet.getDataRange().getValues().slice(1); // ヘッダー行除外
    if (data.length === 0) {
      console.log('📅 予約データが空のため、カレンダー更新をスキップ');
      return;
    }

    // 2. 期間算出（有効な予約のみ）
    const validReservations = data.filter(r => 
      r[0] && r[5] && r[6] && r[8] && r[10] !== 'Cancelled'
    );
    
    if (validReservations.length === 0) {
      console.log('📅 有効な予約がないため、カレンダー更新をスキップ');
      return;
    }

    const checkIns = validReservations.map(r => new Date(r[5])); // F列 (Check-in)
    const checkOuts = validReservations.map(r => new Date(r[6])); // G列 (Check-out)
    const firstDate = new Date(Math.min(...checkIns));
    const lastDate = new Date(Math.max(...checkOuts));

    // 3. 部屋ID一覧
    const rooms = [...new Set(validReservations.map(r => r[8]))].sort(); // I列 (Room ID)
    console.log('📅 対象部屋:', rooms);

    // 4. Availabilityシートを再生成（毎回削除→作成）
    let avail = ss.getSheetByName(availName);
    if (avail) ss.deleteSheet(avail);
    avail = ss.insertSheet(availName);

    // 5. 見出し行
    avail.getRange(1, 1).setValue('Date');
    avail.getRange(1, 2, 1, rooms.length).setValues([rooms]);

    // 6. 日付列生成
    const dates = [];
    for (let d = new Date(firstDate); d <= lastDate; d.setDate(d.getDate() + 1)) {
      dates.push([new Date(d)]);
    }
    avail.getRange(2, 1, dates.length, 1).setValues(dates);

    // 7. 空室/満室判定マトリクス
    const matrix = dates.map(([d]) =>
      rooms.map(room => {
        const booked = validReservations.some(r =>
          r[8] === room &&               // Room ID一致
          r[5] <= d && d < r[6] &&       // Check-in ≤ d < Check-out
          r[10] !== 'Cancelled'          // キャンセル済み除外
        );
        return booked ? 'Booked' : 'Free';
      })
    );
    avail.getRange(2, 2, matrix.length, matrix[0].length).setValues(matrix);

    // 8. 条件付き書式
    const rules = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Booked').setBackground('#ffcccc')
        .setRanges([avail.getDataRange()]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('Free').setBackground('#ccffcc')
        .setRanges([avail.getDataRange()]).build()
    ];
    avail.setConditionalFormatRules(rules);

    console.log('📅 空室カレンダー更新完了:', avail.getLastRow(), '行');

  } catch (error) {
    console.error('❌ 空室カレンダー更新エラー:', error);
    // エラーが発生してもメイン処理には影響しない
  }
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
TEL: 090-3253-0423
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
TEL: 090-3253-0423
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

// === テスト・デバッグ関数 ===
function testSearch() {
  const testData = {
    action: 'search',
    cin: '2025-07-25',
    cout: '2025-07-26',
    guests: '2',
    type: 'twin'
  };
  
  console.log('=== 空室検索テスト ===');
  const result = searchAvailableRooms(testData);
  console.log('結果:', JSON.stringify(result, null, 2));
  return result;
}

// 修正確認用のテスト関数
function testSearchDebug() {
  console.log('=== 修正版空室検索デバッグテスト ===');
  
  // 様々な条件でテスト
  const tests = [
    { cin: '2025-07-22', cout: '2025-07-23', guests: '1', type: 'any', desc: '1名・全部屋タイプ' },
    { cin: '2025-07-22', cout: '2025-07-23', guests: '2', type: 'twin', desc: '2名・ツイン' },
    { cin: '2025-07-22', cout: '2025-07-23', guests: '3', type: 'triple', desc: '3名・トリプル' },
  ];
  
  for (const test of tests) {
    console.log(`\n--- ${test.desc} のテスト ---`);
    const result = searchAvailableRooms(test);
    console.log('結果:', {
      ok: result.ok,
      roomCount: result.rooms ? result.rooms.length : 0,
      rooms: result.rooms ? result.rooms.map(r => `${r.id}(${r.type})`) : [],
      error: result.msg || null
    });
  }
  
  return '全テスト完了';
}

// フロントエンドのリクエスト形式をシミュレート
function testFrontendRequest() {
  console.log('=== フロントエンドリクエストシミュレーション ===');
  
  // フロントエンドが送信する形式と同じデータを作成
  const mockEvent = {
    parameter: {
      data: JSON.stringify({
        action: 'search',
        cin: '2025-07-22',
        cout: '2025-07-23', 
        guests: '2',
        type: 'twin',
        allMinors: 'false'
      })
    }
  };
  
  console.log('模擬リクエスト:', mockEvent);
  const result = doPost(mockEvent);
  console.log('doPost結果:', result);
  
  // レスポンステキストを解析
  const responseText = result.getContent();
  console.log('レスポンステキスト:', responseText);
  
  try {
    const parsedResult = JSON.parse(responseText);
    console.log('解析済みレスポンス:', parsedResult);
    console.log('rooms配列の長さ:', parsedResult.rooms ? parsedResult.rooms.length : 'undefined');
  } catch (e) {
    console.error('JSON解析エラー:', e);
  }
  
  return '完了';
}

// 空室カレンダー更新テスト
function testCalendarUpdate() {
  console.log('=== 空室カレンダー更新テスト ===');
  
  try {
    updateAvailabilityCalendar();
    console.log('✅ 空室カレンダー更新成功');
    return '✅ テスト成功';
  } catch (error) {
    console.error('❌ 空室カレンダー更新失敗:', error);
    return '❌ テスト失敗: ' + error.message;
  }
}

// 手動でカレンダーを更新する関数
function manualUpdateCalendar() {
  console.log('=== 手動カレンダー更新 ===');
  updateAvailabilityCalendar();
  return 'カレンダー更新完了';
}

// お盆料金テスト
function testObonPricing() {
  console.log('=== お盆料金テスト ===');
  
  const testCases = [
    { date: '2025-08-11', desc: 'お盆前日' },
    { date: '2025-08-12', desc: 'お盆開始日' },
    { date: '2025-08-14', desc: 'お盆期間中' },
    { date: '2025-08-16', desc: 'お盆最終日' },
    { date: '2025-08-17', desc: 'お盆終了翌日' }
  ];
  
  testCases.forEach(testCase => {
    const isObon = isObonPeriod(testCase.date);
    const basePrice = 10000;
    const finalPrice = calculateObonPrice(basePrice, testCase.date);
    
    console.log(`${testCase.desc} (${testCase.date}):`, {
      isObonPeriod: isObon,
      basePrice: basePrice,
      finalPrice: finalPrice,
      multiplier: isObon ? '×1.5' : '×1.0'
    });
  });
  
  return 'お盆料金テスト完了';
}

// お盆期間の予約テスト
function testObonReservation() {
  console.log('=== お盆期間予約テスト ===');
  
  const testData = {
    action: 'book',
    name: 'お盆テスト太郎',
    email: 'obon@test.com',
    phone: '090-0000-0000',
    roomId: 'room-A',
    cin: '2025-08-14',
    cout: '2025-08-16',
    guests: '3',
    price: '22500', // 基本15000 × 1.5 = 22500
    allMinors: 'false'
  };
  
  const result = createReservation(testData);
  console.log('結果:', JSON.stringify(result, null, 2));
  return result;
}

function testReservation() {
  const testData = {
    action: 'book',
    name: 'テスト太郎',
    email: 'test@example.com',
    phone: '090-1234-5678',
    roomId: 'room-B',
    cin: '2025-07-25',
    cout: '2025-07-26',
    guests: '2',
    price: '8000',
    allMinors: 'false'
  };
  
  console.log('=== 通常予約テスト ===');
  const result = createReservation(testData);
  console.log('結果:', JSON.stringify(result, null, 2));
  return result;
}

function testAllMinorReservation() {
  const testData = {
    action: 'book',
    name: 'テスト花子（全員未成年）',
    email: 'test@example.com',
    phone: '090-1234-5678',
    roomId: 'room-A',
    cin: '2025-07-25',
    cout: '2025-07-26',
    guests: '2',
    price: '8000',
    allMinors: 'true'  // 文字列のtrue
  };
  
  console.log('=== 全員未成年予約テスト ===');
  console.log('テストデータ:', testData);
  const result = createReservation(testData);
  console.log('結果:', JSON.stringify(result, null, 2));
  return result;
}

// デバッグ用：フロントエンドからのデータ形式テスト
function testAllMinorReservationYesNo() {
  const testData = {
    action: 'book',
    name: 'テスト太郎（yes/no形式）',
    email: 'test@example.com',
    phone: '090-1234-5678',
    roomId: 'room-A',
    cin: '2025-07-25',
    cout: '2025-07-26',
    guests: '2',
    price: '8000',
    allMinors: 'yes'  // yes/no形式
  };
  
  console.log('=== yes/no形式テスト ===');
  console.log('テストデータ:', testData);
  const result = createReservation(testData);
  console.log('結果:', JSON.stringify(result, null, 2));
  return result;
}

// === システム情報取得 ===
function getSystemInfo() {
  return {
    spreadsheetId: SPREADSHEET_ID,
    version: '2.0-simple',
    features: [
      'room_search',
      'reservation', 
      'all_minor_consent_notification',
      'download_link_guidance'
    ],
    consentMethod: 'download_and_checkin',
    timestamp: new Date().toISOString()
  };
}