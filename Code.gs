/* ------------ Code.gs ------------ */
const SHEET_NAME = 'Sheet1';
const TZ = 'Asia/Bangkok';

/* -------------------------------------------------- */
/*  WEB‑APP ENTRY                                     */
/* -------------------------------------------------- */
function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("ระบบจองห้องประชุม");
}
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// เพิ่ม function สำหรับ compatibility กับ frontend
function loginWithEmailPassword(email, password) {
  try {
    console.log('🔗 LoginWithEmailPassword called with:', {
      email: email,
      passwordProvided: !!password
    });

    if (!email || !password) {
      throw new Error('กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน');
    }

    return loginUser({
      email: email,
      pwd: password
    });

  } catch (err) {
    console.error('❌ LoginWithEmailPassword error:', err);
    throw new Error(err.message || 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ');
  }
}

// เพิ่ม debug function สำหรับทดสอบ hash
function testHash() {
  const testPasswords = ['123456', '1234', 'test123'];

  testPasswords.forEach(pwd => {
    try {
      const hashed = hash(pwd);
      console.log(`Password "${pwd}" -> Hash: ${hashed.substring(0, 20)}...`);
    } catch (err) {
      console.error(`Hash failed for "${pwd}":`, err);
    }
  });
}

/* -------------------------------------------------- */
/*  CALENDAR API  (→ FullCalendar)                    */
/* -------------------------------------------------- */
const ROOM_COLORS = {
  MR1: '#A1CEFF', // ฟ้า
  MR2: '#FFC7A1', // เขียว
  MR3: '#FFA1AA', // ชมพู
  MR4: '#D2A1FF'  // ม่วง
};

function listEvents() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  const rows = sh.getDataRange().getValues();
  const events = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const [
          id,
          date,
          startT,
          endT,
          name,
          department,
          company,
          purpose,
          email,
          timestamp,
          status,
          room        // ✅ เพิ่มตรงนี้
        ] = r;



    const startObj = mergeDateTime(date, startT);
    const endObj = mergeDateTime(date, endT);
    if (!startObj || !endObj) continue;            // skip broken rows

    const start = startObj.toISOString();          // ← FullCalendar expects ISO string
    const end = endObj.toISOString();

    const stat = String(status || '').toLowerCase();
    const color = stat === 'cancelled' ? '#e57373' : '#81c784';
    const roomColor = ROOM_COLORS[room] || '#90a4ae'; // สี default

    events.push({
      id,
      title: `| ${room} | ${(purpose || 'ประชุม').substring(0, 30)}`,
      start,
      end,
      backgroundColor: roomColor,
      borderColor: roomColor,
      textColor: '#37393E',
      extendedProps: {
        room,
        booker: name,
        department,
        company,
        purpose,
        email,
        timestamp: convertTimestamp(timestamp),
        status: status || ''
      }
    });
  }
  return events;               // usable by google.script.run
}

/* -------------------------------------------------- */
/*  BOOKING API                                       */
/* -------------------------------------------------- */
function submitBooking(data) {
  const clash = isDuplicate(data.date, data.start, data.end, data.room);
  if (clash.dup) throw new Error(clash.msg);

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  const id = sh.getLastRow();
  const now = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy, HH:mm:ss');

  sh.appendRow([
    id,
    data.date,
    data.start,
    data.end,
    data.name,
    data.department,
    data.company,
    data.purpose,
    data.email,
    now,
    '',
    data.room
  ]);
  return { status: 'ok' };
}

/* -------------------------------------------------- */
/*  DUPLICATE CHECK                                   */
/* -------------------------------------------------- */
function isDuplicate(dateISO, tStart, tEnd, room) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  const rows = sh.getDataRange().getValues().slice(1);

  const reqStart = new Date(`${dateISO}T${padTime(tStart)}:00`).getTime();
  const reqEnd   = new Date(`${dateISO}T${padTime(tEnd)}:00`).getTime();

  for (const r of rows) {
    const [, d, st, et, booker,,,, status,,, rRoom] = r; // ✅ แกะตัวแปรให้ตรง Column (rRoom คือ Col L)
    
    if (!d || !st || !et || !rRoom || status === 'cancelled') continue;

    // ✅ ตรวจสอบว่าเป็นห้องเดียวกันหรือไม่
    if (String(rRoom).trim() !== String(room).trim()) continue;

    const dISO = (d instanceof Date)
      ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd')
      : Utilities.formatDate(parseDDMMYYYY(d), TZ, 'yyyy-MM-dd');

    if (dISO !== dateISO) continue;

    const slotStart = new Date(`${dISO}T${padTime(st)}:00`).getTime();
    const slotEnd   = new Date(`${dISO}T${padTime(et)}:00`).getTime();

    if (reqStart < slotEnd && reqEnd > slotStart) {
      return {
        dup: true,
        msg: `❌ ห้อง ${room} ถูกจองแล้ว\nช่วง ${padTime(st)}–${padTime(et)} โดย ${booker}`
      };
    }
  }
  return { dup: false };
}


function padTime(t) {
  if (t instanceof Date) return t.toTimeString().slice(0, 5);
  if (typeof t === 'number') {
    const mins = Math.round(t * 1440); return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const s = String(t).trim();
  if (s.includes(':')) {
    const [h, m = '00'] = s.split(':'); return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  }
  return `${s.padStart(2, '0')}:00`;
}

/* -------------------------------------------------- */
/*  DATE‑TIME HELPERS                                 */
/* -------------------------------------------------- */
function mergeDateTime(dateVal, timeVal) {
  if (!dateVal || !timeVal) return null;
  const dObj = (dateVal instanceof Date)
    ? new Date(dateVal)
    : (String(dateVal).includes('-') ? new Date(dateVal) : parseDDMMYYYY(dateVal));
  if (isNaN(dObj)) return null;
  const [h, m] = padTime(timeVal).split(':').map(Number);
  dObj.setHours(h, m, 0, 0);
  return dObj;                   //  ← คืน Date object (ไป toISOString ภายหลัง)
}
function parseDDMMYYYY(s) {
  const [dd, mm, yy] = String(s).split('/');
  const yyyy = (+yy > 2500) ? +yy - 543 : +yy;
  return new Date(`${yyyy}-${mm}-${dd}`);
}
function convertTimestamp(ts) {
  if (!ts) return '';
  if (ts instanceof Date) return Utilities.formatDate(ts, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  const [dPart, tPart = '00:00:00'] = String(ts).split(', ');
  const d = parseDDMMYYYY(dPart);
  if (isNaN(d)) return '';
  const [h = '00', m = '00', s = '00'] = tPart.split(':');
  d.setHours(+h, +m, +s);
  return Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

/* ========== AUTH CONFIG ========== */
const USER_SHEET = 'Users';

/* แปลง plain password → hash (SHA-256 → base64) */
function hash(pwd) {
  try {
    if (!pwd) {
      console.error('❌ Hash: Password is empty or null');
      return '';
    }

    const pwdStr = String(pwd);
    console.log('🔐 Hashing password length:', pwdStr.length);

    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pwdStr);
    const hashed = Utilities.base64Encode(digest);

    console.log('✅ Hash generated successfully');
    return hashed;

  } catch (err) {
    console.error('❌ Hash error:', err);
    return '';
  }
}

/* ดึงข้อมูลผู้ใช้จาก email */
// แก้ไข findUser function - เพิ่ม safety checks
function findUser(email) {
  try {
    console.log('🔍 Finding user for email:', email);

    if (!email) {
      console.log('❌ Email is empty');
      return null;
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    if (!sheet) {
      console.log('❌ Users sheet not found');
      return null;
    }

    const data = sheet.getDataRange().getValues();
    console.log('📊 Sheet data rows:', data.length);

    // ข้าม header row (row 0)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];

      // ตรวจสอบว่า row มีข้อมูลครบ
      if (!row || row.length < 8) {
        console.log(`⚠️ Row ${i} incomplete:`, row);
        continue;
      }

      // ตรวจสอบ email (column D = index 3)
      const userEmail = row[3];
      if (!userEmail) {
        console.log(`⚠️ Row ${i} has no email`);
        continue;
      }

      // แปลงเป็น string และ toLowerCase safely
      const emailStr = String(userEmail).toLowerCase().trim();
      const searchEmailStr = String(email).toLowerCase().trim();

      console.log(`🔍 Comparing: "${emailStr}" vs "${searchEmailStr}"`);

      if (emailStr === searchEmailStr) {
        console.log('✅ User found at row:', i + 1);

        return {
          row: i + 1,
          id: row[0] || '',        // A: id
          name: row[1] || '',      // B: name
          nickname: row[2] || '',  // C: nickname  
          email: row[3] || '',     // D: email
          hash: row[4] || '',      // E: password (hashed)
          phone: row[5] || '',     // F: phone
          role: row[6] || 'user',  // G: role
          created: row[7] || ''    // H: created_date
        };
      }
    }

    console.log('❌ User not found');
    return null;

  } catch (err) {
    console.error('❌ FindUser error:', err);
    return null;
  }
}


/* เข้าสู่ระบบ */
// แก้ไข loginUser function
function loginUser(obj) {
  try {
    console.log('🔍 Login attempt starting...');
    console.log('📧 Email:', obj?.email);
    console.log('🔑 Password provided:', !!obj?.pwd);

    // ตรวจสอบ input
    if (!obj || !obj.email || !obj.pwd) {
      console.log('❌ Invalid login data');
      throw new Error('กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน');
    }

    // หา user
    const user = findUser(obj.email);
    if (!user) {
      console.log('❌ User not found:', obj.email);
      throw new Error('ไม่พบบัญชีนี้ในระบบ');
    }

    console.log('👤 User found:', user.name);
    console.log('🔐 Stored hash length:', user.hash?.length || 0);

    // ตรวจสอบ password
    if (!user.hash) {
      console.log('❌ User has no password hash');
      throw new Error('ข้อมูลบัญชีไม่ถูกต้อง กรุณาติดต่อผู้ดูแล');
    }

    const providedHash = hash(obj.pwd);
    if (!providedHash) {
      console.log('❌ Failed to hash provided password');
      throw new Error('เกิดข้อผิดพลาดในการตรวจสอบรหัสผ่าน');
    }

    console.log('🔐 Password hash comparison:', {
      provided: providedHash.substring(0, 10) + '...',
      stored: user.hash.substring(0, 10) + '...',
      match: user.hash === providedHash
    });

    if (user.hash !== providedHash) {
      console.log('❌ Password mismatch for:', obj.email);
      throw new Error('รหัสผ่านไม่ถูกต้อง');
    }

    // ✅ สร้าง session token
    const sessionToken = Utilities.getUuid();
    const sessionData = {
      email: user.email,
      name: user.name,
      role: user.role,
      expiry: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString()
    };

    const prop = PropertiesService.getScriptProperties();
    prop.setProperty(`session_${sessionToken}`, JSON.stringify(sessionData));

    console.log('✅ Login successful for:', obj.email);

    const result = {
      email: user.email,
      name: user.name,
      role: user.role,
      sessionToken: sessionToken
    };

    console.log('✅ Returning user data:', result);
    return result;

  } catch (err) {
    console.error('❌ Login error:', err);
    throw new Error(err.message || 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ');
  }
}

// REGISTER USER
// แก้ไข registerUser function ให้ตรงกับ sheet structure
function registerUser(data) {
  try {
    console.log('📝 Register attempt with data:', JSON.stringify(data, null, 2));

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    if (!sheet) {
      throw new Error('ไม่พบ Users sheet');
    }

    // ตรวจสอบข้อมูลที่ส่งมา
    if (!data || !data.email || !data.password || !data.name) {
      throw new Error('ข้อมูลไม่ครบถ้วน กรุณากรอกข้อมูลที่จำเป็น');
    }

    // ตรวจสอบว่ามี user นี้แล้วหรือไม่ - ใช้ findUser ที่แก้ไขแล้ว
    const existingUser = findUser(data.email);
    if (existingUser) {
      console.log('❌ Email already exists:', data.email);
      throw new Error(`อีเมล ${data.email} มีผู้ใช้งานแล้ว กรุณาใช้อีเมลอื่น`);
    }

    // หา ID ใหม่
    const lastRow = sheet.getLastRow();
    const newId = lastRow < 2 ? 1 : (sheet.getRange(lastRow, 1).getValue() || 0) + 1;

    // สร้าง timestamp
    const now = Utilities.formatDate(new Date(), TZ, 'd/M/yyyy, HH:mm:ss');

    // Hash password
    const hashedPassword = hash(data.password);
    if (!hashedPassword) {
      throw new Error('เกิดข้อผิดพลาดในการเข้ารหัสรหัสผ่าน');
    }

    // เพิ่มข้อมูลใหม่ - ตาม column order ใน sheet
    const newRow = [
      newId,                        // A: id
      data.name || '',             // B: name  
      data.nickname || '',         // C: nickname
      data.email,                  // D: email
      hashedPassword,              // E: password (hashed)
      data.phone || '',            // F: phone
      'user',                      // G: role
      now                          // H: created_date
    ];

    sheet.appendRow(newRow);

    console.log('✅ User registered successfully:', {
      id: newId,
      email: data.email,
      name: data.name
    });

    return {
      status: 'success',
      message: 'สมัครสมาชิกสำเร็จ',
      user: {
        id: newId,
        email: data.email,
        name: data.name
      }
    };

  } catch (err) {
    console.error('❌ Register error:', err);
    throw new Error(err.message || 'เกิดข้อผิดพลาดระหว่างสมัครสมาชิก');
  }
}

/* ดึง session ปัจจุบัน */
function getSessionUser(sessionToken) {
  if (!sessionToken) return null;

  const prop = PropertiesService.getScriptProperties();
  const sessionData = prop.getProperty(`session_${sessionToken}`);

  if (!sessionData) return null;

  const session = JSON.parse(sessionData);

  // ตรวจสอบ expiry
  if (new Date() > new Date(session.expiry)) {
    prop.deleteProperty(`session_${sessionToken}`);
    return null;
  }

  return {
    email: session.email,
    name: session.name,
    role: session.role
  };
}

/* ลบ session */
function logoutUser(sessionToken) {
  if (sessionToken) {
    const prop = PropertiesService.getScriptProperties();
    prop.deleteProperty(`session_${sessionToken}`);
  }
  return { success: true };
}

function cleanupExpiredSessions() {
  try {
    const prop = PropertiesService.getScriptProperties();
    const allProperties = prop.getProperties();
    const now = new Date();
    let cleanedCount = 0;

    Object.keys(allProperties).forEach(key => {
      if (key.startsWith('session_')) {
        try {
          const sessionData = JSON.parse(allProperties[key]);
          if (new Date(sessionData.expiry) < now) {
            prop.deleteProperty(key);
            cleanedCount++;
          }
        } catch (e) {
          // ลบ session ที่ corrupt
          prop.deleteProperty(key);
          cleanedCount++;
        }
      }
    });

    console.log(`✅ Cleaned ${cleanedCount} expired sessions`);
    return { cleanedCount };
  } catch (err) {
    console.error('❌ Cleanup sessions error:', err);
    return { cleanedCount: 0 };
  }
}

// ===== 4. เพิ่ม function สำหรับ clean up duplicate emails =====
function cleanupDuplicateEmails() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const data = sheet.getDataRange().getValues();

    const emails = new Set();
    const rowsToDelete = [];

    // เริ่มจาก row 2 (skip header)
    for (let i = 1; i < data.length; i++) {
      const email = data[i][3]; // Column D

      if (emails.has(email)) {
        rowsToDelete.push(i + 1); // Sheet rows are 1-indexed
      } else {
        emails.add(email);
      }
    }

    // ลบ rows ที่ซ้ำ (เริ่มจากล่างขึ้นบน)
    rowsToDelete.reverse().forEach(rowNum => {
      sheet.deleteRow(rowNum);
      console.log('🗑️ Deleted duplicate row:', rowNum);
    });

    console.log(`✅ Cleanup complete. Removed ${rowsToDelete.length} duplicate rows.`);
    return { removedRows: rowsToDelete.length };

  } catch (err) {
    console.error('❌ Cleanup error:', err);
    throw new Error('เกิดข้อผิดพลาดในการทำความสะอาดข้อมูล');
  }
}

function resetPassword(data) {
  try {
    console.log('🔐 Reset password attempt for:', data.email);
    
    if (!data || !data.email || !data.password) {
      throw new Error('กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน');
    }
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    if (!sheet) {
      throw new Error('ไม่พบ Users sheet');
    }
    
    // หาผู้ใช้จาก email
    const user = findUser(data.email);
    if (!user) {
      throw new Error('ไม่พบอีเมลนี้ในระบบ');
    }
    
    console.log('👤 User found:', user.name);
    
    // Hash รหัสผ่านใหม่
    const newHash = hash(data.password);
    if (!newHash) {
      throw new Error('เกิดข้อผิดพลาดในการเข้ารหัสรหัสผ่าน');
    }
    
    // อัปเดตรหัสผ่านในแถวที่พบ
    sheet.getRange(user.row, 5).setValue(newHash); // Column E (password hash)
    
    console.log('✅ Password updated successfully for:', data.email);
    
    return {
      status: 'success',
      message: 'เปลี่ยนรหัสผ่านสำเร็จ'
    };
    
  } catch (err) {
    console.error('❌ Reset password error:', err);
    throw new Error(err.message || 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน');
  }
}


/* ---------- DEV TEST ---------- */
// ใน Apps Script Editor, รันฟังก์ชันนี้
function testResetPassword() {
  try {
    const result = resetPassword({
      email: 'jom.trwkm@gmail.com', // เปลี่ยนเป็น email ที่มีในระบบ
      password: 'newpassword123'
    });
    console.log('✅ Test result:', result);
  } catch (err) {
    console.error('❌ Test failed:', err);
  }
}
function testListEvents() {
  const ev = listEvents();
  Logger.log(`👉 events=${ev.length}`);
  Logger.log(JSON.stringify(ev.slice(0, 3), null, 2));
}

// เพิ่ม debug function
function testRegister() {
  const testData = {
    name: 'ทดสอบ ระบบ',
    nickname: 'ทดสอบ',
    email: 'test@example.com',
    password: '123456',
    phone: '0812345678'
  };

  try {
    const result = registerUser(testData);
    console.log('✅ Test register result:', result);
  } catch (err) {
    console.error('❌ Test register error:', err);
  }
}

// เพิ่ม debug function สำหรับ login
function testLogin() {
  try {
    const result = loginUser({
      email: 'test@example.com',
      pwd: '123456'
    });
    console.log('✅ Test login result:', result);
  } catch (err) {
    console.error('❌ Test login error:', err);
  }
}

function testFindUser() {
  const testEmails = ['test@example.com', 'theerawat.it@waterpog.com'];

  testEmails.forEach(email => {
    try {
      const user = findUser(email);
      console.log(`Email "${email}" ->`, user ? `Found: ${user.name}` : 'Not found');
    } catch (err) {
      console.error(`FindUser failed for "${email}":`, err);
    }
  });
}

function debugSheet() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const data = sheet.getDataRange().getValues();

    console.log('📊 Sheet debug:');
    console.log('Total rows:', data.length);
    console.log('Headers:', data[0]);

    for (let i = 1; i < Math.min(data.length, 5); i++) {
      console.log(`Row ${i}:`, data[i]);
    }

  } catch (err) {
    console.error('❌ Sheet debug error:', err);
  }
}

// ทดสอบ login กับข้อมูลที่มีอยู่
function testExistingLogin() {
  try {
    // ใช้ข้อมูลจาก sheet
    const result = loginUser({
      email: 'test@example.com',
      pwd: '123456'  // password ที่ใช้ตอน register
    });
    console.log('✅ Existing login test result:', result);
  } catch (err) {
    console.error('❌ Existing login test failed:', err);
  }
}

function testFrontendInput(email, password) {
  console.log('🧪 Testing frontend input:');
  console.log('Email:', email, '(type:', typeof email, ')');
  console.log('Password:', password, '(type:', typeof password, ')');
  console.log('Email empty?', !email);
  console.log('Password empty?', !password);

  if (!email || !password) {
    console.log('❌ Input validation failed');
    return { error: 'Invalid input' };
  }

  try {
    const result = loginUser({ email: email, pwd: password });
    console.log('✅ Login test successful');
    return result;
  } catch (err) {
    console.log('❌ Login test failed:', err.message);
    return { error: err.message };
  }
}

function createTestUser() {
  const timestamp = new Date().getTime();
  const testUser = {
    name: 'ผู้ทดสอบ ระบบ',
    nickname: 'ทดสอบ',
    email: `test${timestamp}@example.com`,
    password: '123456',
    phone: '0812345678'
  };

  try {
    const result = registerUser(testUser);
    console.log('✅ Test user created:', result);
    return result;
  } catch (err) {
    console.error('❌ Test user creation failed:', err);
    return { error: err.message };
  }
}

function forgotPasswordWithNew(email, newPassword) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Users');
  const data = sheet.getDataRange().getValues();
  const emailCol = 4; // คอลัมน์ E
  const passCol = 3;  // คอลัมน์ D

  for (let i = 1; i < data.length; i++) {
    if (data[i][emailCol - 1] === email) {
      const hash = Utilities.base64Encode(
        Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, newPassword)
      );
      sheet.getRange(i + 1, passCol).setValue(hash); // ✅ อัปเดตรหัสผ่านแบบ Hash
      return;
    }
  }

  throw new Error("ไม่พบอีเมลในระบบ");
}

function getRooms() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Room');
  const data = sheet.getDataRange().getValues();

  // กรองเฉพาะห้องที่ status = TRUE (มีติ๊กถูก)
  return data
    .slice(1) // ข้าม header row
    .filter(r => String(r[2]).toUpperCase() === 'TRUE') // Column C (status)
    .map(r => ({
      id: r[0],          // Column A (room)
      name: r[1]         // Column B (description)
    }));
}
