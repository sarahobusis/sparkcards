/***** STAR CARD STUDENT DASHBOARD API *****/

const SPREADSHEETS_BY_GRADE = {
  "5": "1JVvy7hImPv3-xtwHFdysXJjZoC99z1VODR5OkOYaeHg",
  "6": "1QgjCVDsuMl3RGridk49tfPVqjcIWNDCRndxxMwtJ98w",
  "7": "1PoqqvfmN0g9v7iuCxCqG1OBaNRjIg7f0CHmD3cGXXIY",
  "8": "1ZUBQLvtN-Mq2A06yGKcH_hoI-HG2uBnuRNuEeFY7M7Y"
};

const ALLOWED_SUBJECTS = ["Math", "Science", "History"];

// Spreadsheet layout
const HEADER_ROW = 3;
const FIRST_STUDENT_ROW = 4;
const STAR_CARD_ID_COL = 2; // B
const HOMEROOM_COL = 6; // F

// Card visibility (teacher dashboard)
const CARD_VISIBILITY_SHEET_NAME = "CardVisibility";
const TEACHER_PASSWORD = "sparkstaff";

// Per grade/subject "answer checking" toggle (teacher dashboard)
const SETTINGS_SHEET_NAME = "Settings";

// Global leaderboard on/off toggle, stored as a script property since it
// isn't scoped to any one grade's spreadsheet.
const LEADERBOARD_ENABLED_PROPERTY = "leaderboardEnabled";

// Practice tracking (badges)
const PRACTICE_LOG_SHEET_NAME = "PracticeLog";
const PRACTICE_LOG_HEADERS = [
  "StudentId", "Subject", "CardId", "Attempts", "CorrectCount",
  "CurrentStreak", "BestStreak", "Mastered", "LastResult", "LastPracticedAt"
];
const PRACTICE_STREAK_SHEET_NAME = "PracticeStreak";
const PRACTICE_STREAK_HEADERS = ["StudentId", "LastPracticeDate", "CurrentDayStreak", "BestDayStreak"];
// A card counts as "mastered" for badge purposes once it's been answered
// correctly this many times in a row (separate from the teacher's own
// mastery score on the Math/Science/History tabs).
const MASTERY_STREAK_THRESHOLD = 3;

function doGet(e) {
  try {
    const params = e.parameter || {};

    if (params.action === "leaderboard") {
      if (!isLeaderboardEnabled()) {
        return jsonResponse({ found: false, error: "The leaderboard is currently turned off.", leaderboardEnabled: false });
      }

      const grade = cleanGrade(params.grade);       // "" means "all grades"
      const subject = cleanSubject(params.subject);  // "" means "all subjects"
      const result = getLeaderboardData(grade, subject);
      return jsonResponse(result);
    }

    if (params.action === "cardVisibility") {
      const grade = cleanGrade(params.grade);
      const subject = cleanSubject(params.subject);

      if (!grade || !subject) {
        return jsonResponse({ found: false, error: "Missing grade or subject." });
      }

      return jsonResponse({
        found: true,
        hiddenCardIds: getHiddenCardIds(grade, subject),
        checkingEnabled: isCheckingEnabled(grade, subject)
      });
    }

    if (params.action === "settings") {
      return jsonResponse({
        found: true,
        leaderboardEnabled: isLeaderboardEnabled()
      });
    }

    if (params.action === "badges") {
      const starCardId = cleanStudentId(params.starCardId || params.lasid);
      const grade = cleanGrade(params.grade);

      if (!starCardId || !grade) {
        return jsonResponse({ found: false, error: "Missing STAR Card ID or grade." });
      }

      return jsonResponse(getBadgeData(starCardId, grade));
    }

    // New name is starCardId. Keeping lasid as a backup makes old links/tests not totally break.
    const starCardId = cleanStudentId(params.starCardId || params.lasid);
    const grade = cleanGrade(params.grade);
    const subject = cleanSubject(params.subject);

    if (!starCardId || !grade || !subject) {
      return jsonResponse({
        found: false,
        error: "Missing STAR Card ID, grade, or subject."
      });
    }

    const result = getStudentDashboardData(starCardId, grade, subject);
    return jsonResponse(result);

  } catch (err) {
    return jsonResponse({
      found: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

function doPost(e) {
  try {
    const params = JSON.parse((e.postData && e.postData.contents) || "{}");

    if (params.action === "checkTeacherPassword") {
      if (params.password !== TEACHER_PASSWORD) {
        return jsonResponse({ found: false, error: "Incorrect password." });
      }
      return jsonResponse({ found: true });
    }

    if (params.action === "logPracticeAttempt") {
      const starCardId = cleanStudentId(params.starCardId);
      const grade = cleanGrade(params.grade);
      const subject = cleanSubject(params.subject);
      const cardId = normalizeCardId(params.cardId);
      const result = cleanResult(params.result);

      if (!starCardId || !grade || !subject || !cardId || !result) {
        return jsonResponse({ found: false, error: "Missing starCardId, grade, subject, cardId, or result." });
      }

      if (!SPREADSHEETS_BY_GRADE[grade]) {
        return jsonResponse({ found: false, error: "No spreadsheet is connected for grade " + grade + " yet." });
      }

      const stats = logPracticeAttempt(starCardId, grade, subject, cardId, result);
      return jsonResponse({
        found: true,
        attempts: stats.attempts,
        correctCount: stats.correctCount,
        currentStreak: stats.currentStreak,
        bestStreak: stats.bestStreak,
        mastered: stats.mastered,
        dayStreak: stats.dayStreak,
        bestDayStreak: stats.bestDayStreak
      });
    }

    if (params.action === "setCardVisibility") {
      if (params.password !== TEACHER_PASSWORD) {
        return jsonResponse({ found: false, error: "Incorrect password." });
      }

      const grade = cleanGrade(params.grade);
      const subject = cleanSubject(params.subject);
      const cardId = normalizeCardId(params.cardId);
      const hidden = !!params.hidden;

      if (!grade || !subject || !cardId) {
        return jsonResponse({ found: false, error: "Missing grade, subject, or cardId." });
      }

      if (!SPREADSHEETS_BY_GRADE[grade]) {
        return jsonResponse({ found: false, error: "No spreadsheet is connected for grade " + grade + " yet." });
      }

      setCardVisibility(grade, subject, cardId, hidden);
      return jsonResponse({ found: true });
    }

    if (params.action === "setCheckingEnabled") {
      if (params.password !== TEACHER_PASSWORD) {
        return jsonResponse({ found: false, error: "Incorrect password." });
      }

      const grade = cleanGrade(params.grade);
      const subject = cleanSubject(params.subject);
      const enabled = !!params.enabled;

      if (!grade || !subject) {
        return jsonResponse({ found: false, error: "Missing grade or subject." });
      }

      if (!SPREADSHEETS_BY_GRADE[grade]) {
        return jsonResponse({ found: false, error: "No spreadsheet is connected for grade " + grade + " yet." });
      }

      setCheckingEnabled(grade, subject, enabled);
      return jsonResponse({ found: true });
    }

    if (params.action === "setLeaderboardEnabled") {
      if (params.password !== TEACHER_PASSWORD) {
        return jsonResponse({ found: false, error: "Incorrect password." });
      }

      setLeaderboardEnabled(!!params.enabled);
      return jsonResponse({ found: true });
    }

    return jsonResponse({ found: false, error: "Unknown action." });

  } catch (err) {
    return jsonResponse({
      found: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

function getStudentDashboardData(starCardId, grade, subject) {
  const spreadsheetId = SPREADSHEETS_BY_GRADE[grade];

  if (!spreadsheetId) {
    return {
      found: false,
      error: "No spreadsheet is connected for grade " + grade + " yet."
    };
  }

  if (!ALLOWED_SUBJECTS.includes(subject)) {
    return {
      found: false,
      error: "Subject must be Math, Science, or History."
    };
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(subject);

  if (!sheet) {
    return {
      found: false,
      error: "Could not find the " + subject + " tab."
    };
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < FIRST_STUDENT_ROW) {
    return {
      found: false,
      error: "This sheet does not have enough student data yet."
    };
  }

  const headerValues = sheet
    .getRange(HEADER_ROW, 1, 1, lastCol)
    .getValues()[0];

  const percentMasteredCol = findPercentMasteredCol(headerValues);
  const totalMasteredCol = findTotalMasteredCol(headerValues);
  const firstCardCol = findFirstCardCol(headerValues);

  if (!firstCardCol) {
    return {
      found: false,
      error: "Could not find the first card column in row 3."
    };
  }

  const cardHeaders = sheet
    .getRange(HEADER_ROW, firstCardCol, 1, lastCol - firstCardCol + 1)
    .getValues()[0]
    .map(normalizeCardId);

  const studentData = sheet
    .getRange(FIRST_STUDENT_ROW, 1, lastRow - FIRST_STUDENT_ROW + 1, lastCol)
    .getValues();

  const matchingRow = studentData.find(row => {
    return cleanStudentId(row[STAR_CARD_ID_COL - 1]) === starCardId;
  });

  if (!matchingRow) {
    return {
      found: false,
      error: "We could not find that STAR Card ID for this grade and subject."
    };
  }

  const cards = {};

  cardHeaders.forEach((cardId, index) => {
    if (!cardId) return;

    const rawValue = matchingRow[firstCardCol - 1 + index];
    cards[cardId] = normalizeScore(rawValue);
  });

  // Hide cards the teacher has toggled off, without touching the sheet's
  // own columns or scores — a hidden card just doesn't show up here.
  getHiddenCardIds(grade, subject).forEach(hiddenId => {
    delete cards[hiddenId];
  });

  return {
    found: true,
    grade: grade,
    subject: subject,
    percentMastered: percentMasteredCol
      ? normalizePercent(matchingRow[percentMasteredCol - 1])
      : "",
    totalCardsMastered: totalMasteredCol
      ? normalizeNumber(matchingRow[totalMasteredCol - 1])
      : "",
    cards: cards
  };
}

/***** TEACHER DASHBOARD: CARD VISIBILITY *****/
//
// Visibility state lives in its own "CardVisibility" tab per grade
// spreadsheet (columns: Subject, CardId, Hidden), completely separate from
// the Math/Science/History tabs. This is deliberate: every uploaded card
// keeps its own column and scores on the subject tabs whether or not a
// teacher has hidden it from students.

function getOrCreateVisibilitySheet(ss) {
  let sheet = ss.getSheetByName(CARD_VISIBILITY_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CARD_VISIBILITY_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([["Subject", "CardId", "Hidden"]]);
  }

  return sheet;
}

function getHiddenCardIds(grade, subject) {
  const spreadsheetId = SPREADSHEETS_BY_GRADE[grade];
  if (!spreadsheetId) return [];

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(CARD_VISIBILITY_SHEET_NAME);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const hiddenCardIds = [];

  values.forEach(row => {
    const rowSubject = cleanSubject(row[0]);
    const cardId = normalizeCardId(row[1]);
    const isHidden = row[2] === true || String(row[2]).trim().toLowerCase() === "true";

    if (rowSubject === subject && cardId && isHidden) {
      hiddenCardIds.push(cardId);
    }
  });

  return hiddenCardIds;
}

function setCardVisibility(grade, subject, cardId, hidden) {
  const spreadsheetId = SPREADSHEETS_BY_GRADE[grade];
  if (!spreadsheetId) return;

  // The teacher dashboard can toggle a whole unit at once, which fires one
  // request per card in parallel. Without a lock, two concurrent requests
  // could both miss each other's row and append duplicates for different
  // cards at the same time.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = getOrCreateVisibilitySheet(ss);
    const lastRow = sheet.getLastRow();

    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

      for (let i = 0; i < values.length; i++) {
        const rowSubject = cleanSubject(values[i][0]);
        const rowCardId = normalizeCardId(values[i][1]);

        if (rowSubject === subject && rowCardId === cardId) {
          sheet.getRange(i + 2, 3).setValue(hidden);
          return;
        }
      }
    }

    sheet.appendRow([subject, cardId, hidden]);
  } finally {
    lock.releaseLock();
  }
}

/***** TEACHER DASHBOARD: ANSWER CHECKING TOGGLE *****/
//
// Same pattern as card visibility above, but a separate "Settings" tab
// (columns: Subject, CheckingEnabled) since this isn't about individual
// cards. A subject with no row here defaults to checking ON, so existing
// grades/subjects are unaffected until a teacher explicitly turns one off.

function getOrCreateSettingsSheet(ss) {
  let sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
    sheet.getRange(1, 1, 1, 2).setValues([["Subject", "CheckingEnabled"]]);
  }

  return sheet;
}

function isCheckingEnabled(grade, subject) {
  const spreadsheetId = SPREADSHEETS_BY_GRADE[grade];
  if (!spreadsheetId) return true;

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!sheet) return true;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return true;

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

  for (let i = 0; i < values.length; i++) {
    if (cleanSubject(values[i][0]) === subject) {
      const raw = values[i][1];
      return !(raw === false || String(raw).trim().toLowerCase() === "false");
    }
  }

  return true; // no row for this subject yet -> checking stays on
}

function setCheckingEnabled(grade, subject, enabled) {
  const spreadsheetId = SPREADSHEETS_BY_GRADE[grade];
  if (!spreadsheetId) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = getOrCreateSettingsSheet(ss);
    const lastRow = sheet.getLastRow();

    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

      for (let i = 0; i < values.length; i++) {
        if (cleanSubject(values[i][0]) === subject) {
          sheet.getRange(i + 2, 2).setValue(enabled);
          return;
        }
      }
    }

    sheet.appendRow([subject, enabled]);
  } finally {
    lock.releaseLock();
  }
}

/***** TEACHER DASHBOARD: LEADERBOARD TOGGLE *****/
//
// Global, not scoped to a grade or subject, so it lives in script
// properties rather than any one grade's spreadsheet.

function isLeaderboardEnabled() {
  const value = PropertiesService.getScriptProperties().getProperty(LEADERBOARD_ENABLED_PROPERTY);
  return value !== "false"; // unset -> on by default
}

function setLeaderboardEnabled(enabled) {
  PropertiesService.getScriptProperties().setProperty(LEADERBOARD_ENABLED_PROPERTY, enabled ? "true" : "false");
}

/***** CLASS LEADERBOARD *****/

function getLeaderboardData(grade, subject) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "leaderboard:" + (grade || "all") + ":" + (subject || "all");
  const cached = cache.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  const result = buildLeaderboardData(grade, subject);
  cache.put(cacheKey, JSON.stringify(result), 300); // cache for 5 minutes
  return result;
}

function buildLeaderboardData(grade, subject) {
  const grades = grade ? [grade] : Object.keys(SPREADSHEETS_BY_GRADE);
  const subjects = subject ? [subject] : ALLOWED_SUBJECTS;

  // Key: "grade|homeroom" -> running totals
  const homeroomTotals = {};

  grades.forEach(g => {
    const spreadsheetId = SPREADSHEETS_BY_GRADE[g];
    if (!spreadsheetId) return;

    const ss = SpreadsheetApp.openById(spreadsheetId);

    subjects.forEach(subj => {
      const sheet = ss.getSheetByName(subj);
      if (!sheet) return;

      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow < FIRST_STUDENT_ROW) return;

      const headerValues = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
      const firstCardCol = findFirstCardCol(headerValues);
      if (!firstCardCol) return;

      const cardHeaders = sheet
        .getRange(HEADER_ROW, firstCardCol, 1, lastCol - firstCardCol + 1)
        .getValues()[0]
        .map(normalizeCardId);

      const rows = sheet
        .getRange(FIRST_STUDENT_ROW, 1, lastRow - FIRST_STUDENT_ROW + 1, lastCol)
        .getValues();

      rows.forEach(row => {
        const homeroom = String(row[HOMEROOM_COL - 1] || "").trim();
        if (!homeroom) return;

        const studentPercent = computeStudentPercent(row, cardHeaders, firstCardCol);
        if (studentPercent === null) return; // student hasn't attempted anything yet

        const key = g + "|" + homeroom;

        if (!homeroomTotals[key]) {
          homeroomTotals[key] = { grade: g, homeroom: homeroom, sumPercent: 0, studentCount: 0 };
        }

        homeroomTotals[key].sumPercent += studentPercent;
        homeroomTotals[key].studentCount += 1;
      });
    });
  });

  const homerooms = Object.values(homeroomTotals).map(entry => ({
    grade: entry.grade,
    homeroom: entry.homeroom,
    studentCount: entry.studentCount,
    percentCorrect: Math.round(entry.sumPercent / entry.studentCount)
  }));

  homerooms.sort((a, b) => b.percentCorrect - a.percentCorrect);

  return {
    found: true,
    scope: {
      grade: grade ? gradeLabel(grade) : "All Grades",
      subject: subject || "All Subjects"
    },
    generatedAt: new Date().toISOString(),
    homerooms: homerooms,
    grades: buildGradeComparisonData(subject) // always spans all grades, regardless of the grade filter
  };
}

function computeStudentPercent(row, cardHeaders, firstCardCol) {
  let points = 0;
  let counted = 0;

  cardHeaders.forEach((cardId, index) => {
    if (!cardId) return;
    const score = normalizeScore(row[firstCardCol - 1 + index]);
    if (score === "") return; // blank cards don't count toward the average
    points += score;
    counted += 1;
  });

  if (counted === 0) return null;
  return (points / counted) * 100;
}

function buildGradeComparisonData(subject) {
  const subjects = subject ? [subject] : ALLOWED_SUBJECTS;
  const gradeTotals = {};

  Object.keys(SPREADSHEETS_BY_GRADE).forEach(g => {
    const spreadsheetId = SPREADSHEETS_BY_GRADE[g];
    if (!spreadsheetId) return;

    const ss = SpreadsheetApp.openById(spreadsheetId);

    subjects.forEach(subj => {
      const sheet = ss.getSheetByName(subj);
      if (!sheet) return;

      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow < FIRST_STUDENT_ROW) return;

      const headerValues = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
      const firstCardCol = findFirstCardCol(headerValues);
      if (!firstCardCol) return;

      const cardHeaders = sheet
        .getRange(HEADER_ROW, firstCardCol, 1, lastCol - firstCardCol + 1)
        .getValues()[0]
        .map(normalizeCardId);

      const rows = sheet
        .getRange(FIRST_STUDENT_ROW, 1, lastRow - FIRST_STUDENT_ROW + 1, lastCol)
        .getValues();

      rows.forEach(row => {
        const studentPercent = computeStudentPercent(row, cardHeaders, firstCardCol);
        if (studentPercent === null) return;

        if (!gradeTotals[g]) {
          gradeTotals[g] = { grade: g, sumPercent: 0, studentCount: 0 };
        }

        gradeTotals[g].sumPercent += studentPercent;
        gradeTotals[g].studentCount += 1;
      });
    });
  });

  const gradeAverages = Object.values(gradeTotals).map(entry => ({
    grade: entry.grade,
    studentCount: entry.studentCount,
    percentCorrect: Math.round(entry.sumPercent / entry.studentCount)
  }));

  gradeAverages.sort((a, b) => b.percentCorrect - a.percentCorrect);

  return gradeAverages;
}

function gradeLabel(grade) {
  const map = { "5": "5th Grade", "6": "6th Grade", "7": "7th Grade", "8": "8th Grade" };
  return map[grade] || grade;
}

function findPercentMasteredCol(headers) {
  for (let i = 0; i < headers.length; i++) {
    const text = String(headers[i] || "").toLowerCase();
    if (
      text.includes("%") ||
      text.includes("percent") ||
      text.includes("cards mastered to date")
    ) {
      return i + 1;
    }
  }

  return null;
}

function findTotalMasteredCol(headers) {
  for (let i = 0; i < headers.length; i++) {
    const text = String(headers[i] || "").toLowerCase();
    if (text.includes("total cards mastered")) {
      return i + 1;
    }
  }

  return null;
}

function findFirstCardCol(headers) {
  for (let i = 0; i < headers.length; i++) {
    const cardId = normalizeCardId(headers[i]);

    // Matches card IDs like 0A, 1A, 1B, 2C, 10D, etc.
    if (/^\d+[A-Z]+$/.test(cardId)) {
      return i + 1;
    }
  }

  return null;
}

function cleanStudentId(value) {
  return String(value || "").trim();
}

function cleanGrade(value) {
  const text = String(value || "").trim();

  if (text === "5th Grade") return "5";
  if (text === "6th Grade") return "6";
  if (text === "7th Grade") return "7";
  if (text === "8th Grade") return "8";

  return text.replace(/\D/g, "");
}

function cleanSubject(value) {
  const text = String(value || "").trim().toLowerCase();

  if (text === "math") return "Math";
  if (text === "science") return "Science";
  if (text === "history") return "History";

  return "";
}

function normalizeCardId(value) {
  return String(value || "")
    .trim()
    .replace(/\)/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeScore(value) {
  if (value === "" || value === null || typeof value === "undefined") {
    return "";
  }

  const text = String(value)
    .trim()
    .replace("%", "")
    .replace("½", "0.5");

  if (text === "1" || text === "1.0") return 1;
  if (text === "0.5" || text === ".5") return 0.5;
  if (text === "0" || text === "0.0") return 0;

  const num = Number(text);

  if (Math.abs(num - 1) < 0.00001) return 1;
  if (Math.abs(num - 0.5) < 0.00001) return 0.5;
  if (Math.abs(num - 0) < 0.00001) return 0;

  return "";
}

function normalizePercent(value) {
  if (value === "" || value === null || typeof value === "undefined") {
    return "";
  }

  if (typeof value === "number") {
    if (value <= 1) return Math.round(value * 100);
    return Math.round(value);
  }

  const text = String(value).replace("%", "").trim();
  const num = Number(text);

  if (isNaN(num)) return "";

  if (num <= 1) return Math.round(num * 100);
  return Math.round(num);
}

function normalizeNumber(value) {
  const num = Number(value);
  if (isNaN(num)) return "";
  return num;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/***** PRACTICE TRACKING (badges) *****/
//
// Every typed-answer check a student submits is logged here so a badge
// system can reward practice volume and repeated correct answers on the
// same card — not just the one-time mastery score the teacher's own sheet
// tracks. Two tabs per grade spreadsheet:
//   - PracticeLog: one row per (StudentId, Subject, CardId) with running
//     attempt/correct counts and a same-card correct streak.
//   - PracticeStreak: one row per StudentId tracking a daily practice streak
//     (any subject/card counts once per calendar day).
// This endpoint only returns raw counters; which named badges those earn
// (thresholds, art, copy) is presentation logic and lives client-side so it
// can change without redeploying the script.

function getOrCreatePracticeLogSheet(ss) {
  let sheet = ss.getSheetByName(PRACTICE_LOG_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PRACTICE_LOG_SHEET_NAME);
    sheet.getRange(1, 1, 1, PRACTICE_LOG_HEADERS.length).setValues([PRACTICE_LOG_HEADERS]);
  }

  return sheet;
}

function getOrCreatePracticeStreakSheet(ss) {
  let sheet = ss.getSheetByName(PRACTICE_STREAK_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PRACTICE_STREAK_SHEET_NAME);
    sheet.getRange(1, 1, 1, PRACTICE_STREAK_HEADERS.length).setValues([PRACTICE_STREAK_HEADERS]);
  }

  return sheet;
}

function logPracticeAttempt(starCardId, grade, subject, cardId, result) {
  const spreadsheetId = SPREADSHEETS_BY_GRADE[grade];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = getOrCreatePracticeLogSheet(ss);
    const lastRow = sheet.getLastRow();
    const now = new Date();

    let rowIndex = -1; // 1-based sheet row; -1 means "not found yet"
    let attempts = 0;
    let correctCount = 0;
    let currentStreak = 0;
    let bestStreak = 0;
    let mastered = false;

    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, PRACTICE_LOG_HEADERS.length).getValues();

      for (let i = 0; i < values.length; i++) {
        if (
          cleanStudentId(values[i][0]) === starCardId &&
          cleanSubject(values[i][1]) === subject &&
          normalizeCardId(values[i][2]) === cardId
        ) {
          rowIndex = i + 2;
          attempts = Number(values[i][3]) || 0;
          correctCount = Number(values[i][4]) || 0;
          currentStreak = Number(values[i][5]) || 0;
          bestStreak = Number(values[i][6]) || 0;
          mastered = values[i][7] === true || String(values[i][7]).trim().toLowerCase() === "true";
          break;
        }
      }
    }

    attempts += 1;

    if (result === "correct") {
      correctCount += 1;
      currentStreak += 1;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
      // Sticky once earned — a later miss shouldn't take a mastery badge away.
      if (currentStreak >= MASTERY_STREAK_THRESHOLD) mastered = true;
    } else {
      currentStreak = 0;
    }

    const rowValues = [
      starCardId, subject, cardId, attempts, correctCount,
      currentStreak, bestStreak, mastered, result, now
    ];

    if (rowIndex === -1) {
      sheet.appendRow(rowValues);
    } else {
      sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
    }

    const dayStreakInfo = recordDailyPractice(ss, starCardId, now);

    return {
      attempts: attempts,
      correctCount: correctCount,
      currentStreak: currentStreak,
      bestStreak: bestStreak,
      mastered: mastered,
      dayStreak: dayStreakInfo.currentDayStreak,
      bestDayStreak: dayStreakInfo.bestDayStreak
    };
  } finally {
    lock.releaseLock();
  }
}

function recordDailyPractice(ss, starCardId, now) {
  const sheet = getOrCreatePracticeStreakSheet(ss);
  const lastRow = sheet.getLastRow();
  const today = formatDateKey(ss, now);
  const yesterday = formatDateKey(ss, addDays(now, -1));

  let rowIndex = -1;
  let lastDate = "";
  let currentDayStreak = 0;
  let bestDayStreak = 0;

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, PRACTICE_STREAK_HEADERS.length).getValues();

    for (let i = 0; i < values.length; i++) {
      if (cleanStudentId(values[i][0]) === starCardId) {
        rowIndex = i + 2;
        lastDate = formatDateKey(ss, values[i][1]);
        currentDayStreak = Number(values[i][2]) || 0;
        bestDayStreak = Number(values[i][3]) || 0;
        break;
      }
    }
  }

  if (lastDate === today) {
    // Already logged practice today; the streak doesn't change again.
  } else if (lastDate === yesterday) {
    currentDayStreak += 1;
  } else {
    currentDayStreak = 1;
  }

  if (currentDayStreak > bestDayStreak) bestDayStreak = currentDayStreak;

  const rowValues = [starCardId, today, currentDayStreak, bestDayStreak];

  if (rowIndex === -1) {
    sheet.appendRow(rowValues);
  } else {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  }

  return { currentDayStreak: currentDayStreak, bestDayStreak: bestDayStreak };
}

function getBadgeData(starCardId, grade) {
  const spreadsheetId = SPREADSHEETS_BY_GRADE[grade];

  if (!spreadsheetId) {
    return { found: false, error: "No spreadsheet is connected for grade " + grade + " yet." };
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(PRACTICE_LOG_SHEET_NAME);

  const bySubject = {};
  ALLOWED_SUBJECTS.forEach(subj => {
    bySubject[subj] = { attempts: 0, correctCount: 0, masteredCount: 0 };
  });

  let totalAttempts = 0;
  let totalCorrect = 0;
  const masteredCardIds = [];

  if (sheet) {
    const lastRow = sheet.getLastRow();

    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, PRACTICE_LOG_HEADERS.length).getValues();

      values.forEach(row => {
        if (cleanStudentId(row[0]) !== starCardId) return;

        const subject = cleanSubject(row[1]);
        if (!bySubject[subject]) return;

        const cardId = normalizeCardId(row[2]);
        const attempts = Number(row[3]) || 0;
        const correctCount = Number(row[4]) || 0;
        const mastered = row[7] === true || String(row[7]).trim().toLowerCase() === "true";

        bySubject[subject].attempts += attempts;
        bySubject[subject].correctCount += correctCount;
        totalAttempts += attempts;
        totalCorrect += correctCount;

        if (mastered) {
          bySubject[subject].masteredCount += 1;
          masteredCardIds.push(subject + ":" + cardId);
        }
      });
    }
  }

  let dayStreak = 0;
  let bestDayStreak = 0;
  const streakSheet = ss.getSheetByName(PRACTICE_STREAK_SHEET_NAME);

  if (streakSheet) {
    const lastRow = streakSheet.getLastRow();

    if (lastRow >= 2) {
      const values = streakSheet.getRange(2, 1, lastRow - 1, PRACTICE_STREAK_HEADERS.length).getValues();
      const now = new Date();
      const today = formatDateKey(ss, now);
      const yesterday = formatDateKey(ss, addDays(now, -1));

      for (let i = 0; i < values.length; i++) {
        if (cleanStudentId(values[i][0]) === starCardId) {
          const lastDate = formatDateKey(ss, values[i][1]);
          // A streak still "counts" if they practiced today or yesterday
          // (they may just not have gotten to it yet today); older than
          // that, it's lapsed even though we keep the historical best.
          dayStreak = (lastDate === today || lastDate === yesterday) ? (Number(values[i][2]) || 0) : 0;
          bestDayStreak = Number(values[i][3]) || 0;
          break;
        }
      }
    }
  }

  return {
    found: true,
    grade: grade,
    totalAttempts: totalAttempts,
    totalCorrect: totalCorrect,
    masteredCount: masteredCardIds.length,
    masteredCardIds: masteredCardIds,
    dayStreak: dayStreak,
    bestDayStreak: bestDayStreak,
    bySubject: bySubject
  };
}

function formatDateKey(ss, dateValue) {
  if (!dateValue) return "";
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (isNaN(date.getTime())) return "";
  return Utilities.formatDate(date, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function cleanResult(value) {
  const text = String(value || "").trim().toLowerCase();
  return (text === "correct" || text === "partial" || text === "incorrect") ? text : "";
}

/***** QUICK TEST *****/

function testLookup() {
  // Replace TEST123 with a STAR Card ID from column B.
  const result = getStudentDashboardData("TEST123", "5", "Math");
  Logger.log(JSON.stringify(result, null, 2));
}

function testLeaderboard() {
  const result = getLeaderboardData("", ""); // all grades, all subjects
  Logger.log(JSON.stringify(result, null, 2));
}

function testPracticeLog() {
  // Replace TEST123 with a STAR Card ID from column B.
  const result = logPracticeAttempt("TEST123", "5", "Math", "1A", "correct");
  Logger.log(JSON.stringify(result, null, 2));
}

function testBadges() {
  const result = getBadgeData("TEST123", "5");
  Logger.log(JSON.stringify(result, null, 2));
}

/***** OPTIONAL: CHECK FOR DUPLICATE CARD HEADERS *****/

function checkDuplicateCardHeaders() {
  const grades = Object.keys(SPREADSHEETS_BY_GRADE);
  const subjects = ["Math", "Science", "History"];

  grades.forEach(grade => {
    const ss = SpreadsheetApp.openById(SPREADSHEETS_BY_GRADE[grade]);

    subjects.forEach(subject => {
      const sheet = ss.getSheetByName(subject);
      if (!sheet) {
        Logger.log("Grade " + grade + " " + subject + ": tab not found");
        return;
      }

      const lastCol = sheet.getLastColumn();
      const headers = sheet
        .getRange(HEADER_ROW, 1, 1, lastCol)
        .getValues()[0]
        .map(normalizeCardId)
        .filter(id => /^\d+[A-Z]+$/.test(id));

      const seen = {};
      const duplicates = [];

      headers.forEach(id => {
        if (seen[id]) duplicates.push(id);
        seen[id] = true;
      });

      if (duplicates.length === 0) {
        Logger.log("Grade " + grade + " " + subject + ": no duplicate card headers");
      } else {
        Logger.log("Grade " + grade + " " + subject + ": duplicate card headers → " + duplicates.join(", "));
      }
    });
  });
}
